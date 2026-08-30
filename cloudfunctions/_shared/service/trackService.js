/**
 * 埋点上报（M1-13）。把 M1-04 的两块纯逻辑（事件字典、A/B 分桶）接到真实链路上。
 *
 * 两条铁律：
 *   1. **字典外的事件名一律拒绝** —— 否则事件名会野生增长成一团没人认识的字符串
 *   2. **埋点绝不能阻断主流程** —— 服务端内部上报一律走 `reportSafely`，失败只记日志
 *
 * M1 不读实验配置（D-31）：桶号只是一个稳定随机标识，先埋着，实验运营留 M5。
 */

const eventsDao = require('../dao/events')
const usersDao = require('../dao/users')
const { validateEvent, EVENT_COMMON_FIELDS } = require('../constants/events')
const { ERROR, fail, ok } = require('../constants/errors')
const { bucketOf, DEFAULT_EXPERIMENT_KEY } = require('./bucketing')

/** 事件校验失败的原因码 → 给端侧的解释 */
const REASON_MESSAGE = Object.freeze({
  UNKNOWN_EVENT: '事件名不在字典里，请先在 _shared/constants/events.js 登记',
  EVENT_NOT_ACTIVE: '这个事件还是 planned 占位状态，对应里程碑没到，不接受上报',
  MISSING_PARAMS: '缺必填参数'
})

/**
 * 取用户桶号：首次计算后缓存到 `users.bucket`，避免每次上报重算哈希。
 * 缓存写失败不影响上报 —— 桶号是可重算的纯函数结果，丢了下次再算一遍即可。
 */
const resolveBucket = async openid => {
  const user = await usersDao.findByOpenid(openid)
  if (user && Number.isInteger(user.bucket)) return user.bucket

  const bucket = bucketOf(openid, DEFAULT_EXPERIMENT_KEY)
  if (user && Number.isInteger(bucket)) {
    try {
      await usersDao.updateByOpenid(openid, { bucket })
    } catch (err) {
      console.warn('[track] 桶号缓存写入失败，不影响上报', err && err.message)
    }
  }
  return bucket
}

/**
 * 上报一条事件。
 * @param {string} openid
 * @param {string} name       事件名，必须在字典里且为 active
 * @param {object} [params]   业务参数
 * @param {number} [clientTime] 端侧上报时间戳（端侧时钟不可信，只作参考）
 * @param {boolean} [isTest]
 */
const report = async ({ openid, name, params = {}, clientTime = null, isTest = false }) => {
  const check = validateEvent(name, params)
  if (!check.valid) {
    fail(
      ERROR.BAD_PARAMS,
      `${REASON_MESSAGE[check.reason] || '事件校验失败'}${check.missing.length ? '：' + check.missing.join('、') : ''}`,
      { detail: { name, reason: check.reason, missing: check.missing } }
    )
  }

  const bucket = await resolveBucket(openid)
  const doc = Object.assign({}, params, {
    name,
    openid,
    bucket,
    clientTime: Number.isFinite(clientTime) ? clientTime : null,
    serverTime: Date.now()
  })

  const eventId = await eventsDao.insert(doc, isTest)
  return ok({ eventId, name, bucket, commonFields: EVENT_COMMON_FIELDS })
}

/**
 * 服务端内部上报：**永不抛错**。
 * 状态变更这类事件由服务端直接上报（不依赖端侧触发），但它绝不能让业务动作失败 ——
 * 数据少一条可以接受，状态改到一半失败不可接受。
 */
const reportSafely = async payload => {
  try {
    return await report(payload)
  } catch (err) {
    console.warn(`[track] 内部上报失败（已忽略）：${payload && payload.name}`, err && err.message)
    return null
  }
}

module.exports = {
  report,
  reportSafely,
  resolveBucket
}
