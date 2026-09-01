/**
 * 需求单字段的**服务端**校验（M1-09）。
 *
 * 端侧 `miniprogram/models/schema.js` 已经校验过一遍，这里仍然独立再校验一遍 ——
 * 前端不可信是本项目的铁律（tech-stack 第 3 节）。两份代码故意不共享：
 * 端侧那份为体验（一次列出所有问题、允许提示不拦截），这份为安全（只回答能不能写库）。
 *
 * 额外承担一件端侧没有的职责：拦住 PRD 5.4 的四类字段被 AI 代填。
 */

const {
  REQUEST_CATEGORY,
  REQUEST_CATEGORY_VALUES,
  TIMING_TYPE,
  TIMING_TYPE_VALUES,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE,
  REWARD_TYPE_VALUES,
  VISIBILITY_VALUES,
  PREFERENCE_FLAG_VALUES,
  FIELD_SOURCE
} = require('../constants/enums')
const { ERROR, fail } = require('../constants/errors')

const LIMIT = Object.freeze({
  TITLE_MAX_CHARS: 20,
  DETAIL_MAX_CHARS: 500,
  IMAGE_MAX_COUNT: 9,
  HEADCOUNT_MIN: 1,
  HEADCOUNT_MAX: 20
})

/**
 * PRD 5.4：这四类字段**永远只能由用户本人填**，AI 不得代填。
 * 金额与时间填错会造成真实损失，地点与联系方式填错会造成安全风险。
 * M1 还没有 AI，这道校验先立住 —— M2 接入解析时就不用回头改服务端了。
 */
const USER_ONLY_FIELDS = Object.freeze(['amount', 'expectTime', 'area', 'contact'])

const isBlank = value =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

const charLength = text => Array.from(String(text)).length

const toPositiveNumber = value => {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * 校验并归一化需求单入参。任何一条不过就抛业务错误（VALIDATION_FAILED），
 * detail 里带上字段级明细，便于端侧定位到具体输入框。
 * @returns {object} 只包含白名单字段的干净对象，可直接进 dao
 */
const validateAndNormalize = draft => {
  if (!draft || typeof draft !== 'object') {
    fail(ERROR.BAD_PARAMS, '没有拿到需求单内容')
  }

  assertNoAiFilledFields(draft)

  const errors = []
  const bad = (field, message) => errors.push({ field, message })

  for (const [field, message] of [
    ['category', '缺品类'],
    ['city', '缺城市'],
    ['title', '缺标题'],
    ['detail', '缺具体需求'],
    ['timing', '缺时效类型'],
    ['rewardType', '缺报酬类型'],
    ['visibility', '缺可见范围']
  ]) {
    if (isBlank(draft[field])) bad(field, message)
  }

  for (const [field, values] of [
    ['category', REQUEST_CATEGORY_VALUES],
    ['timing', TIMING_TYPE_VALUES],
    ['rewardType', REWARD_TYPE_VALUES],
    ['visibility', VISIBILITY_VALUES]
  ]) {
    if (!isBlank(draft[field]) && !values.includes(draft[field])) {
      bad(field, `取值不在枚举内：${draft[field]}`)
    }
  }

  if (!isBlank(draft.title) && charLength(draft.title) > LIMIT.TITLE_MAX_CHARS) {
    bad('title', `标题不超过 ${LIMIT.TITLE_MAX_CHARS} 字`)
  }
  if (!isBlank(draft.detail) && charLength(draft.detail) > LIMIT.DETAIL_MAX_CHARS) {
    bad('detail', `具体需求不超过 ${LIMIT.DETAIL_MAX_CHARS} 字`)
  }

  const images = Array.isArray(draft.images) ? draft.images.filter(url => typeof url === 'string') : []
  if (images.length > LIMIT.IMAGE_MAX_COUNT) {
    bad('images', `图片最多 ${LIMIT.IMAGE_MAX_COUNT} 张`)
  }

  if (draft.timing === TIMING_TYPE.SCHEDULED && isBlank(draft.expectTime)) {
    bad('expectTime', '预约型必须有期望时间')
  }
  if (draft.timing === TIMING_TYPE.INSTANT) {
    if (isBlank(draft.instantDuration)) {
      bad('instantDuration', '即时型必须有有效时长')
    } else if (!INSTANT_DURATION_VALUES.includes(draft.instantDuration)) {
      bad('instantDuration', `有效时长档位不对：${draft.instantDuration}`)
    }
  }

  let amount = null
  if (draft.rewardType === REWARD_TYPE.PAID) {
    amount = toPositiveNumber(draft.amount)
    if (amount === null) bad('amount', '付费类必须有大于 0 的参考金额')
  }

  let headcount = null
  if (draft.category === REQUEST_CATEGORY.COMPANION) {
    headcount = toPositiveNumber(draft.headcount)
    if (headcount === null || !Number.isInteger(headcount) ||
        headcount < LIMIT.HEADCOUNT_MIN || headcount > LIMIT.HEADCOUNT_MAX) {
      bad('headcount', `人数要是 ${LIMIT.HEADCOUNT_MIN}~${LIMIT.HEADCOUNT_MAX} 的整数`)
    }
  }

  const preference = normalizePreference(draft.preference, bad)

  if (errors.length) {
    fail(ERROR.VALIDATION_FAILED, `需求单有 ${errors.length} 处不合规，无法发布`, { detail: errors })
  }

  return {
    category: draft.category,
    city: String(draft.city).trim(),
    title: String(draft.title).trim(),
    detail: String(draft.detail).trim(),
    timing: draft.timing,
    expectTime: isBlank(draft.expectTime) ? null : draft.expectTime,
    instantDuration: isBlank(draft.instantDuration) ? null : draft.instantDuration,
    rewardType: draft.rewardType,
    amount,
    visibility: draft.visibility,
    headcount,
    area: isBlank(draft.area) ? '' : String(draft.area).trim(),
    images,
    preference
  }
}

/** 偏好开关只认白名单键；任何异性偏好一律拒（D-09 的数据结构防线） */
const normalizePreference = (raw, bad) => {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    bad('preference', '偏好字段格式不对')
    return {}
  }
  const clean = {}
  for (const key of Object.keys(raw)) {
    if (PREFERENCE_FLAG_VALUES.includes(key)) {
      clean[key] = raw[key] === true
    } else {
      bad(`preference.${key}`, '不认识这个偏好开关（本产品没有异性偏好选项）')
    }
  }
  return clean
}

/**
 * 拦住被标记为 AI 生成的四类字段。
 * 约定：端侧传 `fieldSources: { amount: 'user' | 'ai' | 'empty', ... }`。
 * 标了 `ai` 而字段又有值 → 直接拒绝写入，不做"清空后继续"的宽容处理 ——
 * 宽容会掩盖端侧 bug，而这四个字段填错的代价是钱、时间与人身安全。
 */
const assertNoAiFilledFields = draft => {
  const sources = draft.fieldSources
  if (!sources || typeof sources !== 'object') return

  const offenders = USER_ONLY_FIELDS.filter(
    field => sources[field] === FIELD_SOURCE.AI && !isBlank(draft[field])
  )
  if (offenders.length) {
    fail(
      ERROR.AI_FIELD_FORBIDDEN,
      `金额、见面时间、见面地点、联系方式必须由本人填写，不接受 AI 代填（本次涉及：${offenders.join('、')}）`,
      { detail: offenders.map(field => ({ field, message: 'source 标记为 ai' })) }
    )
  }
}

module.exports = {
  LIMIT,
  USER_ONLY_FIELDS,
  validateAndNormalize
}
