/**
 * 过期扫描（M1-18）。让 PRD 4.1 规则 1「需求单必然会终结」真的发生，
 * 而不只是状态机里有一条 open→expired 的边。
 *
 * 三条纪律：
 *   1. 单次处理条数有上限，处理不完下一轮继续 —— 一次异常扫描吃光免费额度比晚十分钟过期严重
 *   2. 过期的 actor 必须是 `system`（权限矩阵里只有 system 能做这次转移），走 `applyTransition`
 *   3. 天然幂等：查询只选在架单，已过期的选不出来；单条失败不影响同批其余单子
 */

const requestsDao = require('../dao/requests')
const { REQUEST_STATUS, ACTOR_ROLE } = require('../constants/enums')
const { applyTransition } = require('./requestService')
const trackService = require('./trackService')

/** 单轮最多处理多少条。免费环境下这个数字宁可小 */
const SCAN_BATCH_LIMIT = 50

/** 定时任务的发起者不是某个用户，日志与事件里统一用这个标识 */
const SYSTEM_OPENID = 'system:cron'

/**
 * 扫一轮并把到期的单子置为 expired。
 * @param {string} [timing] 只扫某种时效类型；空表示全部
 * @param {number} [nowMs]  当前时间，默认服务端时间（定时任务里没有端侧时钟可用）
 * @param {number} [limit]
 */
const scanExpired = async ({ timing = '', nowMs = Date.now(), limit = SCAN_BATCH_LIMIT } = {}) => {
  const candidates = await requestsDao.listExpiredCandidates({ timing, nowMs, limit })

  const expired = []
  const failed = []

  for (const request of candidates) {
    try {
      await applyTransition({
        requestId: request._id,
        to: REQUEST_STATUS.EXPIRED,
        actorRole: ACTOR_ROLE.SYSTEM,
        actorOpenid: SYSTEM_OPENID,
        reason: 'cron_expire',
        isTest: request._isTest === true
      })
      await trackService.reportSafely({
        openid: request.ownerOpenid,
        name: 'request_expired',
        params: { requestId: request._id, timing: request.timing },
        isTest: request._isTest === true
      })
      expired.push(request._id)
    } catch (err) {
      // 单条失败（例如刚被取消，状态已变）不该中断整批
      failed.push({ requestId: request._id, code: err && err.code, message: err && err.message })
    }
  }

  // M1 不做「过期后 AI 兜底作答」（M2-10）与「归档进知识库」（M2-09）。
  // 调用点就在上面那个 for 循环里：每条成功过期的单子可以顺手扔给兜底与归档。
  return {
    timing: timing || 'all',
    scanned: candidates.length,
    expiredCount: expired.length,
    expired,
    failed,
    // 取到的条数等于上限，说明可能还有剩余，下一轮继续
    mayHaveMore: candidates.length === limit,
    nowMs
  }
}

module.exports = {
  SCAN_BATCH_LIMIT,
  SYSTEM_OPENID,
  scanExpired
}
