/**
 * 环境初始化（M1-19 从临时的 `ping` 函数搬过来）。
 *
 * 为什么这段逻辑不能跟 `ping` 一起删掉：`configs` 的权限是「所有用户不可读写」，
 * 云函数是唯一合法写入方；这两条配置又是主干的前置条件（开城判断、时区、在架上限）。
 * 换环境时得能一键重建，不能依赖人记得当初在控制台敲了哪些字段。
 *
 * 为什么挂在 `cron` 而不是任何端侧可调的函数上：`cron` 只能由定时触发器或云端测试触发，
 * 没有客户端入口。把"写配置"这种特权动作放在端侧可调的函数里，就得先有管理员白名单，
 * 而白名单本身就是这里要写的配置之一 —— 会绕成一个环。
 *
 * 幂等：按 key 有则更新无则新建，可反复跑。
 */

const configsDao = require('../dao/configs')

/** M1 的两条初始配置。value 的字段含义见 D-34 */
const CONFIG_SEEDS = adminOpenids => [
  {
    key: 'admin_openids',
    value: adminOpenids,
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
  },
  {
    key: 'ai_daily_cost_limit',
    value: { limitCny: 5, enabled: true },
    desc: 'AI 当日全局成本上限（元）。超过后非免费档能力降级，免费档（解析/机审等）不受限，避免伤主转化路径（M2-05）'
  }
]

/**
 * 写入初始配置。
 *
 * @param {object} [options]
 * @param {string[]} [options.adminOpenids] 管理员 openid 列表。**留空则不动 `admin_openids`** ——
 *        这个函数没有调用者身份（`cron` 没有 openid），猜一个错的白名单比不写更糟。
 * @returns {object} 每个 key 的处理结果
 */
const seedConfigs = async ({ adminOpenids } = {}) => {
  const results = {}

  for (const seed of CONFIG_SEEDS(adminOpenids)) {
    if (seed.key === 'admin_openids') {
      const valid = Array.isArray(adminOpenids) && adminOpenids.length
      if (!valid) {
        const existing = await configsDao.findByKey(seed.key)
        results[seed.key] = {
          ok: true,
          action: 'skipped',
          reason: existing
            ? '未传 adminOpenids，保留现有白名单不动'
            : '未传 adminOpenids，且当前没有白名单 —— 需要显式传入才会写'
        }
        continue
      }
    }

    try {
      const res = await configsDao.upsertByKey(seed.key, { value: seed.value, desc: seed.desc })
      results[seed.key] = Object.assign({ ok: true }, res)
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

module.exports = {
  CONFIG_SEEDS,
  seedConfigs
}
