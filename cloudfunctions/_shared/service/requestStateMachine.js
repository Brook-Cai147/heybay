/**
 * 需求单状态机 —— 转移合法性判定（纯逻辑，不接触数据库）。
 *
 * 本文件是全产品最容易出隐蔽 bug 的地方：状态错乱会直接导致用户纠纷（例如已被选定
 * 的单又被别人接走），所以转移表必须显式、必须有单测（tech-stack 第 3 节 / D-20）。
 *
 * 唯一的写入口是云函数侧的 transitionRequest，它在写库前必须先过这里。
 * 角色权限矩阵（谁有资格做这次转移）在 M1-02 补，本步只判断转移本身是否合法。
 */

const { REQUEST_STATUS, REQUEST_STATUS_VALUES } = require('../constants/enums')

/**
 * 显式转移表：key 为当前状态，value 为允许转移到的状态列表。
 * 空数组即终态。改这张表前先读 PRD 4.1。
 */
const TRANSITIONS = Object.freeze({
  [REQUEST_STATUS.DRAFT]: Object.freeze([REQUEST_STATUS.OPEN]),
  [REQUEST_STATUS.OPEN]: Object.freeze([
    REQUEST_STATUS.RESPONDED,
    REQUEST_STATUS.EXPIRED,
    REQUEST_STATUS.CANCELLED,
    REQUEST_STATUS.REMOVED
  ]),
  [REQUEST_STATUS.RESPONDED]: Object.freeze([
    REQUEST_STATUS.MATCHED,
    REQUEST_STATUS.EXPIRED,
    REQUEST_STATUS.CANCELLED,
    REQUEST_STATUS.REMOVED
  ]),
  [REQUEST_STATUS.MATCHED]: Object.freeze([REQUEST_STATUS.DONE, REQUEST_STATUS.CANCELLED]),
  [REQUEST_STATUS.DONE]: Object.freeze([REQUEST_STATUS.RATED]),
  [REQUEST_STATUS.RATED]: Object.freeze([]),
  [REQUEST_STATUS.EXPIRED]: Object.freeze([]),
  [REQUEST_STATUS.CANCELLED]: Object.freeze([]),
  [REQUEST_STATUS.REMOVED]: Object.freeze([])
})

/** 错误码，供上层区分处理；M1-02 会补 TRANSITION_FORBIDDEN（转移合法但越权） */
const TRANSITION_ERROR = Object.freeze({
  UNKNOWN_STATUS: 'UNKNOWN_STATUS',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION'
})

/** 是否为已登记的状态 */
const isKnownStatus = status => REQUEST_STATUS_VALUES.includes(status)

/** 是否为终态（无任何出边） */
const isTerminalStatus = status => isKnownStatus(status) && TRANSITIONS[status].length === 0

/** 某状态允许转移到的状态列表；未知状态返回空数组 */
const allowedTargets = from => (isKnownStatus(from) ? TRANSITIONS[from] : [])

/**
 * 判断 from → to 是否合法。只回答"合法与否"，不判断权限。
 * @returns {boolean}
 */
const canTransition = (from, to) => {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return false
  return TRANSITIONS[from].includes(to)
}

/**
 * 断言 from → to 合法，非法直接抛错。写库前必须调用这个而不是 canTransition，
 * 这样任何漏判都会变成异常而不是静默写坏数据。
 * @throws {Error} err.code 为 TRANSITION_ERROR 之一，err.from / err.to 带上下文
 */
const assertTransition = (from, to) => {
  const fail = (code, message) => {
    const err = new Error(message)
    err.code = code
    err.from = from
    err.to = to
    throw err
  }

  if (!isKnownStatus(from)) {
    fail(TRANSITION_ERROR.UNKNOWN_STATUS, `未知的需求单当前状态：${from}`)
  }
  if (!isKnownStatus(to)) {
    fail(TRANSITION_ERROR.UNKNOWN_STATUS, `未知的需求单目标状态：${to}`)
  }
  if (!TRANSITIONS[from].includes(to)) {
    const targets = TRANSITIONS[from].length ? TRANSITIONS[from].join(' / ') : '（终态，无出边）'
    fail(
      TRANSITION_ERROR.ILLEGAL_TRANSITION,
      `非法的状态转移：${from} → ${to}。${from} 允许转移到 ${targets}`
    )
  }
  return true
}

module.exports = {
  TRANSITIONS,
  TRANSITION_ERROR,
  isKnownStatus,
  isTerminalStatus,
  allowedTargets,
  canTransition,
  assertTransition
}
