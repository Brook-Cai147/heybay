/**
 * ping —— 临时探针云函数（M1-06）。
 *
 * 只做一件事：证明「小程序端 → 云函数」这条链路是通的，并把环境事实带回来。
 * 不碰数据库、不依赖 _shared（云函数间的共享方式在 M1-08 才定）。
 * M1-19 收尾时删除本函数。
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

exports.main = async () => {
  const { OPENID, APPID, ENV, UNIONID } = cloud.getWXContext()

  return {
    ok: true,
    // 这三项是本步真正要确认的：身份可信、环境正确、云函数在跑
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
}
