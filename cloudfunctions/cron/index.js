/**
 * cron —— 定时任务（M1-18）。M1 只做过期扫描；日报周报与小组健康分属 M3。
 *
 * 两个触发器（见 config.json，频率来自 tech-stack 第 8 节）：
 *   scanInstant   每 10 分钟扫即时型（1h / 3h / 今天内，时效敏感）
 *   scanScheduled 每小时扫预约型（期望时间 +24h 才过期，不用扫那么密）
 *
 * 本函数**没有 openid**（不是端侧调用），因此不走 `createHandler` 那套身份校验；
 * 也正因如此，它做的状态转移 actor 一律是 `system`。
 *
 * 手动触发（云函数控制台的"云端测试"）时可传：
 *   `{ "timing": "instant" }` 只扫即时型；`{}` 扫全部
 *   `{ "action": "seedConfigs", "adminOpenids": ["..."] }` 重建初始配置（M1-19 从 `ping` 搬来）
 *
 * `_shared` 是 `npm run sync` 复制进来的副本，改共享代码后必须重新 sync 再上传。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { TIMING_TYPE } = require('./_shared/constants/enums')
const { scanExpired, SCAN_BATCH_LIMIT } = require('./_shared/service/expiryScan')
const { seedConfigs } = require('./_shared/service/setupService')

/** 触发器名 → 扫描哪种时效类型 */
const TRIGGER_TIMING = {
  scanInstant: TIMING_TYPE.INSTANT,
  scanScheduled: TIMING_TYPE.SCHEDULED
}

exports.main = async (event = {}) => {
  /**
   * 运维动作走 action 分支，定时触发不会带 action。
   * 放在 `cron` 是因为它没有客户端入口 —— 写配置这种特权动作不该挂在端侧可调的函数上。
   */
  if (event.action === 'seedConfigs') {
    try {
      const results = await seedConfigs({ adminOpenids: event.adminOpenids })
      console.log('[cron] 初始配置写入完成', JSON.stringify(results))
      return { ok: true, action: 'seedConfigs', results }
    } catch (err) {
      console.error('[cron] 初始配置写入失败', err)
      return { ok: false, action: 'seedConfigs', message: String(err && err.message).slice(0, 200) }
    }
  }

  // 定时触发时事件里带 TriggerName；手动测试时可以直接传 timing
  const timing = event.timing || TRIGGER_TIMING[event.TriggerName] || ''
  const limit = Number.isInteger(event.limit) && event.limit > 0 ? event.limit : SCAN_BATCH_LIMIT

  try {
    const result = await scanExpired({ timing, limit })
    // 定时任务没人看返回值，日志是唯一的观测手段
    console.log('[cron] 过期扫描完成', JSON.stringify(result))
    return Object.assign({ ok: true, trigger: event.TriggerName || 'manual' }, result)
  } catch (err) {
    console.error('[cron] 过期扫描失败', err)
    return {
      ok: false,
      trigger: event.TriggerName || 'manual',
      message: String(err && err.message).slice(0, 200)
    }
  }
}
