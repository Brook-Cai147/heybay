/**
 * 全项目枚举的端侧副本。
 *
 * **权威副本在 `cloudfunctions/_shared/constants/enums.js`。** 小程序端无法 require 目录外
 * 文件，所以这里存一份手抄副本；两份的键与值必须完全一致，由 tests/enumsParity.test.js
 * 的断言锁住（D-27）。**改这里就要同时改云侧，反之亦然。**
 *
 * 页面与组件禁止写枚举字符串字面量，一律从这里取（tech-stack 第 1 节）。
 * 云侧的 ACTOR_ROLE 是鉴权概念，端侧不需要，故不在本文件内。
 */

/** 需求单状态（PRD 4.1 状态机） */
const REQUEST_STATUS = {
  DRAFT: 'draft',
  OPEN: 'open',
  RESPONDED: 'responded',
  MATCHED: 'matched',
  DONE: 'done',
  RATED: 'rated',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  REMOVED: 'removed'
}

/** 品类白名单（PRD 4.1）。只有这 8 类，增加前先看 D-09 */
const REQUEST_CATEGORY = {
  COMPANION: 'companion',
  PAID_GUIDE: 'paid_guide',
  BARTER: 'barter',
  ACCOMMODATION: 'accommodation',
  INQUIRY: 'inquiry',
  ERRAND: 'errand',
  TRANSLATION: 'translation',
  EMERGENCY: 'emergency'
}

/** 品类的中文展示名 */
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

/** 时效类型（PRD 4.1） */
const TIMING_TYPE = {
  SCHEDULED: 'scheduled',
  INSTANT: 'instant'
}

/** 即时型的有效时长档位 */
const INSTANT_DURATION = {
  H1: '1h',
  H3: '3h',
  TODAY: 'today'
}

/** 报酬类型（PRD 4.1）。付费仅作线下协商参考，平台不碰资金（D-04） */
const REWARD_TYPE = {
  FREE: 'free',
  MEAL: 'meal',
  PAID: 'paid',
  GOODS: 'goods'
}

/** 可见范围（PRD 4.1） */
const VISIBILITY = {
  CITY: 'city',
  GROUP: 'group',
  INVITE: 'invite'
}

/** 性别（D-26）。唯一用途是支撑「仅同性响应」，自填可留空 */
const GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  UNSET: 'unset'
}

/** 偏好开关。只有"仅同性响应"，永远不提供异性偏好选项（D-09） */
const PREFERENCE_FLAG = {
  SAME_GENDER_ONLY: 'sameGenderOnly',
  REQUIRE_VERIFIED: 'requireVerified'
}

/** 响应的来源归因（PRD 5.3 的四条分发路径） */
const RESPONSE_SOURCE = {
  PUSH: 'push',
  COMMUNITY: 'community',
  INVITE: 'invite',
  BROADCAST: 'broadcast'
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
  RESPONSE_SOURCE_VALUES: valuesOf(RESPONSE_SOURCE)
}
