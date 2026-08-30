/**
 * 全项目枚举的权威副本（云侧）。
 *
 * 端侧副本在 `miniprogram/models/enums.js`，两份必须键值完全一致 —— 小程序端无法
 * require 目录外文件，双份不可避免，靠 tests/enumsParity.test.js 的断言锁住漂移（D-27）。
 * 任何改动都要同时改两处。
 *
 * 业务代码禁止写状态、品类等字符串字面量，一律从这里取（tech-stack 第 1 节）。
 * 例外：`ACTOR_ROLE` 是云侧独有（鉴权概念，端侧不需要），不参与 parity 断言。
 */

/** 需求单状态（PRD 4.1 状态机） */
const REQUEST_STATUS = {
  DRAFT: 'draft',           // 草稿
  OPEN: 'open',             // 招募中
  RESPONDED: 'responded',   // 待选定（已有响应）
  MATCHED: 'matched',       // 已确定（已选定响应者）
  DONE: 'done',             // 已完成（双方均确认）
  RATED: 'rated',           // 已评价 —— 登记但 M1 不使用，评价属 M3
  EXPIRED: 'expired',       // 已过期
  CANCELLED: 'cancelled',   // 已取消
  REMOVED: 'removed'        // 已下架（违规）
}

/**
 * 品类白名单（PRD 4.1）。**只有这 8 类**，没有"交友""同城""聊天"。
 * 无法归入这 8 类的需求不允许发布 —— 这是 D-09 从数据结构层面消灭擦边交友的防线，
 * 增加品类前必须先看 D-09。
 */
const REQUEST_CATEGORY = {
  COMPANION: 'companion',           // 搭子同行
  PAID_GUIDE: 'paid_guide',         // 付费地陪
  BARTER: 'barter',                 // 借物易物
  ACCOMMODATION: 'accommodation',   // 住宿
  INQUIRY: 'inquiry',               // 打听咨询
  ERRAND: 'errand',                 // 代购跑腿
  TRANSLATION: 'translation',       // 翻译陪同
  EMERGENCY: 'emergency'            // 应急求助
}

/** 品类的中文展示名（UI 与 AI prompt 共用，避免两处各写一套） */
const REQUEST_CATEGORY_LABEL = {
  [REQUEST_CATEGORY.COMPANION]: '搭子同行',
  [REQUEST_CATEGORY.PAID_GUIDE]: '付费地陪',
  [REQUEST_CATEGORY.BARTER]: '借物易物',
  [REQUEST_CATEGORY.ACCOMMODATION]: '住宿',
  [REQUEST_CATEGORY.INQUIRY]: '打听咨询',
  [REQUEST_CATEGORY.ERRAND]: '代购跑腿',
  [REQUEST_CATEGORY.TRANSLATION]: '翻译陪同',
  [REQUEST_CATEGORY.EMERGENCY]: '应急求助'
}

/** 时效类型（PRD 4.1）：需求单必然会终结，没有第三种 */
const TIMING_TYPE = {
  SCHEDULED: 'scheduled',   // 预约型：含期望时间，期望时间后 24h 过期
  INSTANT: 'instant'        // 即时型：含有效时长
}

/** 即时型的有效时长档位 */
const INSTANT_DURATION = {
  H1: '1h',
  H3: '3h',
  TODAY: 'today'            // 今天内，以需求单所属城市的当地日期为界
}

/** 报酬类型（PRD 4.1）。平台不碰资金，付费仅作线下协商参考（D-04） */
const REWARD_TYPE = {
  FREE: 'free',             // 免费互助
  MEAL: 'meal',             // 请一顿
  PAID: 'paid',             // 付费（金额区间，线下结算）
  GOODS: 'goods'            // 以物换物
}

/** 可见范围（PRD 4.1） */
const VISIBILITY = {
  CITY: 'city',             // 城市社区公开
  GROUP: 'group',           // 指定小组
  INVITE: 'invite'          // 仅定向邀请
}

/**
 * 性别（D-26）。**唯一用途是支撑「仅同性响应」安全开关**，自填、可留空。
 * 不参与任何排序、推荐或筛选。
 */
const GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  UNSET: 'unset'            // 未填：不能响应设了「仅同性响应」的需求单
}

/**
 * 偏好开关（PRD 4.1）。**只有"仅同性响应"，永远不提供任何异性偏好选项**（D-09）：
 * 让擦边需求在数据结构上无法被表达，比事后审核有效。往这里加键前先看 D-09。
 */
const PREFERENCE_FLAG = {
  SAME_GENDER_ONLY: 'sameGenderOnly',       // 仅同性可响应（安全用途）
  REQUIRE_VERIFIED: 'requireVerified'       // 需已完成 L2 自证的响应者
}

/**
 * 响应的来源归因（PRD 5.3 的四条分发路径）。
 * 用途是回答"哪条分发路径真的带来了响应"，进而决定 L2 自动分发值不值得做（M5）。
 */
const RESPONSE_SOURCE = {
  PUSH: 'push',              // 定向推送触达
  COMMUNITY: 'community',    // 城市社区 / 需求广场浏览
  INVITE: 'invite',          // 定向邀请
  BROADCAST: 'broadcast'     // 广播（小组、群等）
}

/**
 * 状态转移的发起方角色（tech-stack 第 3 节）。**云侧独有**。
 * 判断"是谁在做这次转移"，与"这次转移本身是否合法"是两件事，分别由权限矩阵与转移表负责。
 */
const ACTOR_ROLE = {
  OWNER: 'owner',           // 需求方（发单人）
  RESPONDER: 'responder',   // 被选定的响应者
  SYSTEM: 'system',         // 系统：定时任务与由其他动作连带触发的状态变更
  ADMIN: 'admin'            // 管理员（openid 白名单，云函数侧独立校验）
}

const freeze = Object.freeze
const valuesOf = obj => freeze(Object.values(obj))

module.exports = {
  REQUEST_STATUS: freeze(REQUEST_STATUS),
  REQUEST_STATUS_VALUES: valuesOf(REQUEST_STATUS),
  REQUEST_CATEGORY: freeze(REQUEST_CATEGORY),
  REQUEST_CATEGORY_VALUES: valuesOf(REQUEST_CATEGORY),
  REQUEST_CATEGORY_LABEL: freeze(REQUEST_CATEGORY_LABEL),
  TIMING_TYPE: freeze(TIMING_TYPE),
  TIMING_TYPE_VALUES: valuesOf(TIMING_TYPE),
  INSTANT_DURATION: freeze(INSTANT_DURATION),
  INSTANT_DURATION_VALUES: valuesOf(INSTANT_DURATION),
  REWARD_TYPE: freeze(REWARD_TYPE),
  REWARD_TYPE_VALUES: valuesOf(REWARD_TYPE),
  VISIBILITY: freeze(VISIBILITY),
  VISIBILITY_VALUES: valuesOf(VISIBILITY),
  GENDER: freeze(GENDER),
  GENDER_VALUES: valuesOf(GENDER),
  PREFERENCE_FLAG: freeze(PREFERENCE_FLAG),
  PREFERENCE_FLAG_VALUES: valuesOf(PREFERENCE_FLAG),
  RESPONSE_SOURCE: freeze(RESPONSE_SOURCE),
  RESPONSE_SOURCE_VALUES: valuesOf(RESPONSE_SOURCE),
  ACTOR_ROLE: freeze(ACTOR_ROLE),
  ACTOR_ROLE_VALUES: valuesOf(ACTOR_ROLE)
}
