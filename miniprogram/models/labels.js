/**
 * UI 展示文案（端侧专用）。
 *
 * 为什么单独一个文件、而不是放进 `models/enums.js`：枚举是端云双份、靠 parity 单测锁住的
 * 契约（D-27），改一个字就得两边同步；展示文案只影响界面，改文案不该牵动云侧。
 * 所以**键取自枚举、文案放这里**，页面与组件都从这里取，避免每个页面各写一套。
 */

const {
  REQUEST_CATEGORY_LABEL,
  REQUEST_STATUS,
  TIMING_TYPE,
  INSTANT_DURATION,
  REWARD_TYPE,
  VISIBILITY,
  GENDER,
  CONTACT_TYPE
} = require('./enums')

/** 品类中文名在枚举里已有（AI prompt 也要用），这里直接复用，不再抄一份 */
const CATEGORY_LABEL = REQUEST_CATEGORY_LABEL

const STATUS_LABEL = {
  [REQUEST_STATUS.DRAFT]: '草稿',
  [REQUEST_STATUS.OPEN]: '招募中',
  [REQUEST_STATUS.RESPONDED]: '待选定',
  [REQUEST_STATUS.MATCHED]: '已确定',
  [REQUEST_STATUS.DONE]: '已完成',
  [REQUEST_STATUS.RATED]: '已评价',
  [REQUEST_STATUS.EXPIRED]: '已过期',
  [REQUEST_STATUS.CANCELLED]: '已取消',
  [REQUEST_STATUS.REMOVED]: '已下架'
}

const TIMING_LABEL = {
  [TIMING_TYPE.INSTANT]: '即时型（马上要）',
  [TIMING_TYPE.SCHEDULED]: '预约型（约好时间）'
}

const INSTANT_DURATION_LABEL = {
  [INSTANT_DURATION.H1]: '1 小时内',
  [INSTANT_DURATION.H3]: '3 小时内',
  [INSTANT_DURATION.TODAY]: '今天内'
}

const REWARD_LABEL = {
  [REWARD_TYPE.FREE]: '免费互助',
  [REWARD_TYPE.MEAL]: '请一顿',
  [REWARD_TYPE.PAID]: '付费',
  [REWARD_TYPE.GOODS]: '以物换物'
}

const VISIBILITY_LABEL = {
  [VISIBILITY.CITY]: '城市公开',
  [VISIBILITY.GROUP]: '指定小组',
  [VISIBILITY.INVITE]: '仅定向邀请'
}

const GENDER_LABEL = {
  [GENDER.MALE]: '男',
  [GENDER.FEMALE]: '女',
  [GENDER.UNSET]: '未填'
}

/** 信任档位。**M1 一律显示「新面孔」**，信任分算法属 M2 */
const TRUST_LEVEL_LABEL = {
  newcomer: '新面孔'
}

/** 城市展示名。M1 只开伦敦（D-10），M3 起从 configs / cities 下发 */
const CITY_LABEL = {
  london: '伦敦'
}

/** 联系方式类型展示名（D-36） */
const CONTACT_TYPE_LABEL = {
  [CONTACT_TYPE.WECHAT]: '微信号',
  [CONTACT_TYPE.PHONE]: '电话',
  [CONTACT_TYPE.OTHER]: '联系方式'
}

const freeze = Object.freeze

module.exports = {
  CATEGORY_LABEL: freeze(CATEGORY_LABEL),
  STATUS_LABEL: freeze(STATUS_LABEL),
  TIMING_LABEL: freeze(TIMING_LABEL),
  INSTANT_DURATION_LABEL: freeze(INSTANT_DURATION_LABEL),
  REWARD_LABEL: freeze(REWARD_LABEL),
  VISIBILITY_LABEL: freeze(VISIBILITY_LABEL),
  GENDER_LABEL: freeze(GENDER_LABEL),
  TRUST_LEVEL_LABEL: freeze(TRUST_LEVEL_LABEL),
  CITY_LABEL: freeze(CITY_LABEL),
  CONTACT_TYPE_LABEL: freeze(CONTACT_TYPE_LABEL)
}
