/**
 * 需求单状态机 —— 转移合法性判定（纯逻辑，不接触数据库）。
 *
 * 本文件是全产品最容易出隐蔽 bug 的地方：状态错乱会直接导致用户纠纷（例如已被选定
 * 的单又被别人接走），所以转移表必须显式、必须有单测（tech-stack 第 3 节 / D-20）。
 *
 * 唯一的写入口是云函数侧的 transitionRequest，它在写库前必须先过这里：
 * 先判转移是否合法（转移表），再判发起方是否有权（权限矩阵）。两者是独立的两道门。
 */

const {
  REQUEST_STATUS,
  REQUEST_STATUS_VALUES,
  ACTOR_ROLE,
  ACTOR_ROLE_VALUES
} = require('../constants/enums')

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

/** 错误码，供上层区分处理 */
const TRANSITION_ERROR = Object.freeze({
  UNKNOWN_STATUS: 'UNKNOWN_STATUS',
  UNKNOWN_ACTOR: 'UNKNOWN_ACTOR',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  TRANSITION_FORBIDDEN: 'TRANSITION_FORBIDDEN'
})

/** 转移的唯一键，形如 `open>responded` */
const edgeKey = (from, to) => `${from}>${to}`

/**
 * 权限矩阵：每条合法转移允许哪些角色发起。
 *
 * 设计要点（PRD 4.1 / 4.5，比转移表更严）：
 *   - 发布、选定只能由需求方本人做，选定不可逆
 *   - 被响应与过期只能由系统触发：前者是响应动作的连带结果，后者是定时任务
 *   - 取消分两段：未选定前只有需求方能取消；已选定后双方都能取消（须记录取消方，计入信用）
 *   - 下架只有管理员能做（违规处置）
 *   - 完成与评价双方都能做（完成需双方各自确认，计数逻辑在 M1-12）
 *
 * 这张表的键必须与转移表的边一一对应，加了边忘了配权限会被单测拦下。
 */
const PERMISSIONS = Object.freeze({
  [edgeKey(REQUEST_STATUS.DRAFT, REQUEST_STATUS.OPEN)]: Object.freeze([ACTOR_ROLE.OWNER]),

  [edgeKey(REQUEST_STATUS.OPEN, REQUEST_STATUS.RESPONDED)]: Object.freeze([ACTOR_ROLE.SYSTEM]),
  [edgeKey(REQUEST_STATUS.OPEN, REQUEST_STATUS.EXPIRED)]: Object.freeze([ACTOR_ROLE.SYSTEM]),
  [edgeKey(REQUEST_STATUS.OPEN, REQUEST_STATUS.CANCELLED)]: Object.freeze([ACTOR_ROLE.OWNER]),
  [edgeKey(REQUEST_STATUS.OPEN, REQUEST_STATUS.REMOVED)]: Object.freeze([ACTOR_ROLE.ADMIN]),

  [edgeKey(REQUEST_STATUS.RESPONDED, REQUEST_STATUS.MATCHED)]: Object.freeze([ACTOR_ROLE.OWNER]),
  [edgeKey(REQUEST_STATUS.RESPONDED, REQUEST_STATUS.EXPIRED)]: Object.freeze([ACTOR_ROLE.SYSTEM]),
  [edgeKey(REQUEST_STATUS.RESPONDED, REQUEST_STATUS.CANCELLED)]: Object.freeze([ACTOR_ROLE.OWNER]),
  [edgeKey(REQUEST_STATUS.RESPONDED, REQUEST_STATUS.REMOVED)]: Object.freeze([ACTOR_ROLE.ADMIN]),

  [edgeKey(REQUEST_STATUS.MATCHED, REQUEST_STATUS.DONE)]: Object.freeze([
    ACTOR_ROLE.OWNER,
    ACTOR_ROLE.RESPONDER
  ]),
  [edgeKey(REQUEST_STATUS.MATCHED, REQUEST_STATUS.CANCELLED)]: Object.freeze([
    ACTOR_ROLE.OWNER,
    ACTOR_ROLE.RESPONDER
  ]),

  // done → rated 属 M3（评价），此处先登记权限，M1 不会调用
  [edgeKey(REQUEST_STATUS.DONE, REQUEST_STATUS.RATED)]: Object.freeze([
    ACTOR_ROLE.OWNER,
    ACTOR_ROLE.RESPONDER
  ])
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

/** 是否为已登记的角色 */
const isKnownActor = actor => ACTOR_ROLE_VALUES.includes(actor)

/** 某条转移允许的角色列表；转移非法或未配权限时返回空数组 */
const allowedActors = (from, to) => PERMISSIONS[edgeKey(from, to)] || []

/**
 * 判断 actor 是否有权把 from 推到 to。转移非法也返回 false —— 需要区分两种失败原因时用
 * assertTransitionByActor，它的错误码会告诉你是"转移非法"还是"你没权限"。
 * @returns {boolean}
 */
const canActorTransition = (from, to, actor) => {
  if (!canTransition(from, to)) return false
  if (!isKnownActor(actor)) return false
  return allowedActors(from, to).includes(actor)
}

/**
 * 断言 actor 有权做这次转移。写库前调这个。
 *
 * 失败时的错误码分三种，前端要据此给不同提示：
 *   UNKNOWN_STATUS / ILLEGAL_TRANSITION —— 转移本身不成立（"这个单子当前状态不能这么改"）
 *   UNKNOWN_ACTOR                       —— 角色值本身不合法（调用方 bug）
 *   TRANSITION_FORBIDDEN                —— 转移合法但你没资格（"只有需求方能选定"）
 *
 * @throws {Error} err.code / err.from / err.to / err.actor
 */
const assertTransitionByActor = (from, to, actor) => {
  // 先判转移，再判权限：报错原因要指向根本问题，而不是笼统说"没权限"
  assertTransition(from, to)

  const fail = (code, message) => {
    const err = new Error(message)
    err.code = code
    err.from = from
    err.to = to
    err.actor = actor
    throw err
  }

  if (!isKnownActor(actor)) {
    fail(TRANSITION_ERROR.UNKNOWN_ACTOR, `未知的转移发起方角色：${actor}`)
  }

  const actors = allowedActors(from, to)
  if (!actors.includes(actor)) {
    fail(
      TRANSITION_ERROR.TRANSITION_FORBIDDEN,
      `角色 ${actor} 无权执行状态转移 ${from} → ${to}。该转移只允许 ${actors.join(' / ')} 发起`
    )
  }
  return true
}

module.exports = {
  TRANSITIONS,
  PERMISSIONS,
  TRANSITION_ERROR,
  edgeKey,
  isKnownStatus,
  isKnownActor,
  isTerminalStatus,
  allowedTargets,
  allowedActors,
  canTransition,
  canActorTransition,
  assertTransition,
  assertTransitionByActor
}
