/**
 * ping —— 临时探针云函数（M1-06 建立，M1-07 扩展）。
 *
 * 两个用途：
 *   1. 证明「小程序端 → 云函数」这条链路是通的，并把环境事实带回来（M1-06）
 *   2. 逐个集合验证「云函数能写、端侧不能写」这条边界真的生效（M1-07 的 dbProbe）
 *
 * 不依赖 `_shared`（云函数间的共享方式在 M1-08 才定）。M1-19 收尾时删除本函数。
 */

const cloud = require('wx-server-sdk')

// DYNAMIC_CURRENT_ENV：跟随函数所在环境，避免把环境 ID 写死在云函数里
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 核实运行时是否真的支持 IANA 时区。
 *
 * 为什么要在这里查：M1-05 的「今天内」过期判定依赖 `Intl` 的 timeZone。缺完整 ICU 时
 * `Intl` 不会报错，只会静默回落到运行时本地时区 —— 那样过期时间会悄悄算错。
 * 用一个已知答案自检：2026-07-01 的伦敦处于 BST，偏移必须是 +60 分钟。
 */
const probeIcu = () => {
  try {
    const probeMs = Date.UTC(2026, 6, 1, 12, 0, 0)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/London',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date(probeMs))
    const pick = type => Number(parts.find(part => part.type === type).value)
    const wallAsUtc = Date.UTC(
      pick('year'),
      pick('month') - 1,
      pick('day'),
      pick('hour') % 24,
      pick('minute'),
      pick('second')
    )
    const offsetMinutes = (wallAsUtc - probeMs) / 60000
    return { supported: offsetMinutes === 60, londonSummerOffsetMinutes: offsetMinutes }
  } catch (err) {
    return { supported: false, error: String(err && err.message) }
  }
}

/** M1 需要的六个集合。dbProbe 默认逐个探一遍 */
const M1_COLLECTIONS = ['users', 'requests', 'responses', 'statusLogs', 'events', 'configs']

/**
 * 逐个集合验证云函数侧的读写权限：写一条探针文档 → 读回 → 删除。
 *
 * 探针文档带 `_isTest: true`（tech-stack 第 2 节的单环境纪律），并额外塞了 `openid` 与 `key`
 * 两个字段，避免撞上 `users.openid` / `configs.key` 的唯一索引（缺字段会被当成 null）。
 * 写完立即删除，不留垃圾数据。
 */
const dbProbe = async collections => {
  const db = cloud.database()
  const results = {}

  for (const name of collections) {
    const stamp = Date.now()
    const probeDoc = {
      _isTest: true,
      _probe: 'M1-07',
      openid: `_probe_${stamp}`,
      key: `_probe_${stamp}`,
      createdAt: db.serverDate()
    }

    try {
      const added = await db.collection(name).add({ data: probeDoc })
      const readBack = await db.collection(name).doc(added._id).get()
      const removed = await db.collection(name).doc(added._id).remove()
      results[name] = {
        ok: true,
        writable: true,
        addedId: added._id,
        readBack: Boolean(readBack.data && readBack.data._probe === 'M1-07'),
        removed: removed.stats ? removed.stats.removed : null
      }
    } catch (err) {
      // 集合不存在、索引冲突、权限异常都会落到这里；把原始信息带回去便于排查
      results[name] = {
        ok: false,
        writable: false,
        errCode: err && err.errCode,
        message: String(err && err.message).slice(0, 200)
      }
    }
  }

  return results
}

/**
 * 写入 M1-07 的两条初始配置（幂等：已存在则更新，不存在则新建）。
 *
 * 为什么放云函数而不是手工敲控制台：
 *   1. `configs` 权限已收成端侧不可写，云函数是唯一合法写入方，手工写属于绕过纪律
 *   2. 换环境（将来的正式环境）能一键复现，不依赖人记得敲了哪些字段
 *   3. 管理员 openid 直接取调用上下文，不需要人肉复制粘贴，不会填错
 *
 * 这两条是真实配置，**不带 `_isTest`** —— 带了会在清理联调数据时被误删。
 */
const seedConfigs = async adminOpenid => {
  const db = cloud.database()

  const seeds = [
    {
      key: 'admin_openids',
      value: [adminOpenid],
      desc: '管理员白名单，仅云函数校验使用'
    },
    {
      key: 'city_london',
      value: {
        code: 'london',
        nameZh: '伦敦',
        // timeZone 必须入库：M1-05 的「今天内」过期判定要拿它喂 Intl，不能硬编码
        timeZone: 'Europe/London',
        isOpen: true,
        activeLimitFree: 3,
        activeLimitMember: 10
      },
      desc: '开城配置：M1 只开伦敦，在架上限对所有人按 3 条（D-34：M3 迁往 cities 集合）'
    }
  ]

  const results = {}

  for (const seed of seeds) {
    try {
      const existing = await db.collection('configs').where({ key: seed.key }).get()

      if (existing.data.length) {
        await db.collection('configs').doc(existing.data[0]._id).update({
          data: { value: seed.value, desc: seed.desc, updatedAt: db.serverDate() }
        })
        results[seed.key] = { ok: true, action: 'updated', _id: existing.data[0]._id }
      } else {
        const added = await db.collection('configs').add({
          data: Object.assign({}, seed, { createdAt: db.serverDate(), updatedAt: db.serverDate() })
        })
        results[seed.key] = { ok: true, action: 'created', _id: added._id }
      }
    } catch (err) {
      results[seed.key] = {
        ok: false,
        errCode: err && err.errCode,
        message: String(err && err.message).slice(0, 200)
      }
    }
  }

  return results
}

exports.main = async (event = {}) => {

  const { OPENID, APPID, ENV, UNIONID } = cloud.getWXContext()

  const result = {
    ok: true,
    // 这三项是 M1-06 真正要确认的：身份可信、环境正确、云函数在跑
    openid: OPENID,
    appid: APPID,
    env: ENV,
    hasUnionid: Boolean(UNIONID),
    serverTime: new Date().toISOString(),
    serverTimeMs: Date.now(),
    runtime: {
      node: process.version,
      tz: process.env.TZ || null,
      icu: probeIcu()
    }
  }

  if (event.action === 'dbProbe') {
    const collections = Array.isArray(event.collections) && event.collections.length
      ? event.collections
      : M1_COLLECTIONS
    result.dbProbe = await dbProbe(collections)
  }

  if (event.action === 'seedConfigs') {
    result.seedConfigs = await seedConfigs(OPENID)
  }

  return result
}
