/**
 * 埋点事件字典（PRD 7.3）。
 *
 * **事件名一旦上报过就视为冻结**：改名会让历史数据断成两截，而这些数据是用来判断产品该不该
 * 继续投入的（PRD 5.5、7.1）。要改语义就加新事件、把旧的标 deprecated，不要原地改名。
 *
 * 六类分组对齐 PRD 7.3。`status: 'planned'` 的是占位登记（对应里程碑还没到），
 * `track` 云函数（M1-13）只接受 status 为 active 的事件名，字典外的名字一律拒绝 ——
 * 防止事件名野生增长成一团没人认识的字符串。
 *
 * 分桶标识不是事件，而是每条事件的公共字段（见 EVENT_COMMON_FIELDS）。
 */

/** 六类分组（PRD 7.3） */
const EVENT_GROUP = {
  REQUEST_LIFECYCLE: 'request_lifecycle',   // ① 需求单全生命周期状态变更
  AI_CALL: 'ai_call',                       // ② AI 每次调用
  DISTRIBUTION: 'distribution',             // ③ 分发触达与响应归因
  TRUST_FUNNEL: 'trust_funnel',             // ④ 增信任务完成漏斗
  SAFETY: 'safety',                         // ⑤ 安全功能使用率
  EXPERIMENT: 'experiment'                  // ⑥ 分桶与实验（M1 只作为公共字段）
}

/** 每条事件由上报层自动附加的公共字段，业务侧不用传（M1-13 实现） */
const EVENT_COMMON_FIELDS = Object.freeze([
  'openid',
  'bucket',       // 来自 bucketing.bucketOf，可能为 null（未入桶）
  'clientTime',   // 端侧上报时间
  'serverTime',   // 云函数落库时间
  'isTest'        // 联调数据标记，正式统计里排除
])

const ACTIVE = 'active'
const PLANNED = 'planned'

/**
 * 事件定义。params 只列**必填**参数，可选参数不登记（避免字典变成文档垃圾场）。
 */
const EVENTS = {
  // ① 需求单全生命周期 —— M1 的主力数据
  request_publish_submitted: {
    group: EVENT_GROUP.REQUEST_LIFECYCLE,
    status: ACTIVE,
    params: ['category', 'city', 'timing', 'rewardType'],
    desc: '发布页点了发布（不论成功失败）'
  },
  request_status_changed: {
    group: EVENT_GROUP.REQUEST_LIFECYCLE,
    status: ACTIVE,
    params: ['requestId', 'from', 'to', 'actor'],
    desc: '服务端每次状态转移都上报，由 requestService 直接调用，不依赖端侧'
  },
  request_expired: {
    group: EVENT_GROUP.REQUEST_LIFECYCLE,
    status: ACTIVE,
    params: ['requestId', 'timing'],
    desc: '定时任务把单子置为过期（M1-18）'
  },
  request_done_confirmed: {
    group: EVENT_GROUP.REQUEST_LIFECYCLE,
    status: ACTIVE,
    params: ['requestId', 'byRole'],
    desc: '单方确认完成；双方都确认后才会有 request_status_changed 到 done'
  },
  request_rated: {
    group: EVENT_GROUP.REQUEST_LIFECYCLE,
    status: PLANNED,
    params: ['requestId', 'byRole'],
    desc: '双向评价（M3）'
  },

  // ② AI 调用 —— M2-04 起由 aiGateway 与发布页填满
  ai_capability_called: {
    group: EVENT_GROUP.AI_CALL,
    status: ACTIVE,
    params: ['capability', 'durationMs', 'tokenIn', 'tokenOut', 'fromCache'],
    desc: 'aiGateway 每次调用（M2-08 起启用）'
  },
  ai_field_modified: {
    group: EVENT_GROUP.AI_CALL,
    status: ACTIVE,
    params: ['capability', 'field'],
    desc: '用户改掉了 AI 给的建议值，PRD 5.5 字段修改率的数据源（M2-08 起启用）'
  },
  ai_fallback_triggered: {
    group: EVENT_GROUP.AI_CALL,
    status: ACTIVE,
    params: ['capability', 'reason'],
    desc: 'AI 失败后降级为普通表单（M2-08 起启用，D-15 护栏的观测点）'
  },
  ai_answer_feedback: {
    group: EVENT_GROUP.AI_CALL,
    status: ACTIVE,
    params: ['capability', 'helpful'],
    desc: '兜底答案的「有用 / 没用」反馈，PRD 5.5「兜底采纳率 ≥50%」的唯一数据源（M2-10 登记，按钮在 M2-13 的对话页）'
  },

  // ③ 分发触达与响应归因
  request_card_clicked: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'position', 'source'],
    desc: '需求广场或城市页点开一张需求卡片'
  },
  response_submitted: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'source'],
    desc: '提交一条响应；source 记归因来源：list / push / invite / broadcast'
  },
  responder_selected: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'responseId'],
    desc: '需求方选定了某位响应者'
  },
  distribution_reached: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: PLANNED,
    params: ['requestId', 'channel'],
    desc: 'L2 自动分发触达（M5）'
  },
  autonomy_level_set: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['level', 'from'],
    desc: '用户切换自主性档位（M2-14）。档位分布是 D-14 那条主张唯一的量化依据'
  },
  invite_drafted: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'count'],
    desc: 'L1 生成了 N 条邀请文案（还没发）。与 invite_sent 的差值就是"起草了但用户没选"的比例'
  },
  invite_sent: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'count'],
    desc: '用户勾选后实际发出的邀请数（M2-14）'
  },
  invite_responded: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'inviteId'],
    desc: '定向邀请换来了一次响应 —— 这一刻正是 L1→L2 询问的触发点（D-14）'
  },
  l2_prompt_answered: {
    group: EVENT_GROUP.DISTRIBUTION,
    status: ACTIVE,
    params: ['requestId', 'accepted'],
    desc: 'L1→L2 的一次性询问被接受还是拒绝（M2-14 只埋触发点，L2 实现属 M5）'
  },

  // ④ 增信任务漏斗 —— 占位，M3 信任体系时填满
  trust_task_completed: {
    group: EVENT_GROUP.TRUST_FUNNEL,
    status: PLANNED,
    params: ['task'],
    desc: '完成一项增信任务：邮箱验证 / 社媒绑定 / 完善介绍（M3）'
  },

  // ⑤ 安全功能使用率
  same_gender_only_enabled: {
    group: EVENT_GROUP.SAFETY,
    status: ACTIVE,
    params: ['requestId'],
    desc: '发单时打开了「仅同性响应」（PRD 4.5）'
  },
  gender_missing_blocked: {
    group: EVENT_GROUP.SAFETY,
    status: ACTIVE,
    params: ['requestId'],
    desc: '因未填性别而无法响应「仅同性」单（D-26），观察这条约束拦掉了多少人'
  },
  safety_tip_shown: {
    group: EVENT_GROUP.SAFETY,
    status: ACTIVE,
    params: ['requestId'],
    desc: '选定后强制展示安全提示卡（PRD 4.5）'
  },
  subscribe_authorized: {
    group: EVENT_GROUP.SAFETY,
    status: PLANNED,
    params: ['scene', 'accepted'],
    desc: '订阅消息授权结果（M4，D-30）'
  }
}

const EVENT_NAMES = Object.freeze(Object.keys(EVENTS))
const ACTIVE_EVENT_NAMES = Object.freeze(EVENT_NAMES.filter(name => EVENTS[name].status === ACTIVE))

const isKnownEvent = name => Object.prototype.hasOwnProperty.call(EVENTS, name)
const isActiveEvent = name => isKnownEvent(name) && EVENTS[name].status === ACTIVE

/**
 * 校验一条待上报事件。只返回结构化结果，不抛错 —— 埋点不能阻断主流程。
 * @returns {{valid: boolean, reason: string|null, missing: string[]}}
 */
const validateEvent = (name, params) => {
  if (!isKnownEvent(name)) {
    return { valid: false, reason: 'UNKNOWN_EVENT', missing: [] }
  }
  if (!isActiveEvent(name)) {
    return { valid: false, reason: 'EVENT_NOT_ACTIVE', missing: [] }
  }
  const payload = params && typeof params === 'object' ? params : {}
  const missing = EVENTS[name].params.filter(
    field => payload[field] === undefined || payload[field] === null || payload[field] === ''
  )
  return {
    valid: missing.length === 0,
    reason: missing.length === 0 ? null : 'MISSING_PARAMS',
    missing
  }
}

module.exports = {
  EVENT_GROUP: Object.freeze(EVENT_GROUP),
  EVENT_COMMON_FIELDS,
  EVENT_STATUS: Object.freeze({ ACTIVE, PLANNED }),
  EVENTS: Object.freeze(EVENTS),
  EVENT_NAMES,
  ACTIVE_EVENT_NAMES,
  isKnownEvent,
  isActiveEvent,
  validateEvent
}
