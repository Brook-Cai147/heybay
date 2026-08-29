/**
 * 需求单字段校验（端侧）。
 *
 * **只为体验，不为安全。** 服务端会独立再校验一遍（M1-09），任何"前端校验过了"都不构成
 * 服务端可以放松的理由 —— 前端不可信是本项目的铁律（tech-stack 第 3 节）。
 *
 * 约定：只返回结构化的字段级错误，**不抛异常**，让页面能一次性把所有问题标出来。
 * 枚举一律从 models/enums.js 取，本文件不写枚举字面量。
 */

const {
  REQUEST_CATEGORY_VALUES,
  REQUEST_CATEGORY,
  TIMING_TYPE,
  TIMING_TYPE_VALUES,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE,
  REWARD_TYPE_VALUES,
  VISIBILITY_VALUES,
  PREFERENCE_FLAG_VALUES
} = require('./enums')

/** 错误码：页面据此决定提示语与聚焦哪个字段 */
const ERROR_CODE = Object.freeze({
  REQUIRED: 'REQUIRED',                   // 必填项为空
  INVALID_ENUM: 'INVALID_ENUM',           // 取值不在枚举内
  TOO_LONG: 'TOO_LONG',                   // 超长
  TOO_MANY_IMAGES: 'TOO_MANY_IMAGES',     // 图片超过 9 张
  INVALID_NUMBER: 'INVALID_NUMBER',       // 数字非法
  FORBIDDEN_FIELD: 'FORBIDDEN_FIELD'      // 禁止出现的字段（如异性偏好，D-09）
})

const LIMIT = Object.freeze({
  TITLE_MAX_CHARS: 20,
  IMAGE_MAX_COUNT: 9,
  HEADCOUNT_MIN: 1,
  HEADCOUNT_MAX: 20
})

/** 疑似详细地址：门牌号、房号、英国邮编。命中只提示，不拦截（PRD 4.5 地点模糊化） */
const DETAILED_ADDRESS_PATTERNS = [
  /\d+\s*号/,
  /\b(flat|room|apt|apartment|unit)\s*\.?\s*\d+/i,
  /\b\d+[a-z]?\s+[a-z]+\s+(street|st|road|rd|avenue|ave|lane|ln)\b/i,
  /\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i
]

const isBlank = value =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

const charLength = text => Array.from(String(text)).length

/** 转成正数；非数字或 ≤0 返回 null */
const toPositiveNumber = value => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

/**
 * 校验发布中的需求单草稿。
 * @param {object} draft 页面收集到的字段
 * @returns {{valid: boolean, errors: Array<{field: string, code: string, message: string}>, hints: Array<{field: string, message: string}>}}
 */
const validateRequestDraft = draft => {
  const errors = []
  const hints = []
  const fail = (field, code, message) => errors.push({ field, code, message })

  if (!draft || typeof draft !== 'object') {
    fail('draft', ERROR_CODE.REQUIRED, '没有拿到需求单内容')
    return { valid: false, errors, hints }
  }

  const required = [
    ['category', '请选择一个品类'],
    ['city', '请选择城市'],
    ['title', '请填写标题'],
    ['detail', '请说明具体需求'],
    ['timing', '请选择时效类型'],
    ['rewardType', '请选择报酬类型'],
    ['visibility', '请选择谁能看到这条需求']
  ]
  for (const [field, message] of required) {
    if (isBlank(draft[field])) fail(field, ERROR_CODE.REQUIRED, message)
  }

  // 枚举取值：只在字段有值时判，避免同一字段报两条
  const enumChecks = [
    ['category', REQUEST_CATEGORY_VALUES, '这个品类不在 8 类白名单内'],
    ['timing', TIMING_TYPE_VALUES, '时效类型只能是预约型或即时型'],
    ['rewardType', REWARD_TYPE_VALUES, '报酬类型取值不对'],
    ['visibility', VISIBILITY_VALUES, '可见范围取值不对']
  ]
  for (const [field, values, message] of enumChecks) {
    if (!isBlank(draft[field]) && !values.includes(draft[field])) {
      fail(field, ERROR_CODE.INVALID_ENUM, message)
    }
  }

  if (!isBlank(draft.title) && charLength(draft.title) > LIMIT.TITLE_MAX_CHARS) {
    fail('title', ERROR_CODE.TOO_LONG, `标题不超过 ${LIMIT.TITLE_MAX_CHARS} 字`)
  }

  if (draft.images !== undefined && draft.images !== null) {
    if (!Array.isArray(draft.images)) {
      fail('images', ERROR_CODE.INVALID_ENUM, '图片字段格式不对')
    } else if (draft.images.length > LIMIT.IMAGE_MAX_COUNT) {
      fail('images', ERROR_CODE.TOO_MANY_IMAGES, `图片最多 ${LIMIT.IMAGE_MAX_COUNT} 张`)
    }
  }

  // 时效的条件必填
  if (draft.timing === TIMING_TYPE.SCHEDULED && isBlank(draft.expectTime)) {
    fail('expectTime', ERROR_CODE.REQUIRED, '预约型需要填期望时间')
  }
  if (draft.timing === TIMING_TYPE.INSTANT) {
    if (isBlank(draft.instantDuration)) {
      fail('instantDuration', ERROR_CODE.REQUIRED, '即时型需要选有效时长')
    } else if (!INSTANT_DURATION_VALUES.includes(draft.instantDuration)) {
      fail('instantDuration', ERROR_CODE.INVALID_ENUM, '有效时长只能是 1 小时 / 3 小时 / 今天内')
    }
  }

  // 付费单必须有参考金额（仅供线下协商参考，平台不代收，D-04）
  if (draft.rewardType === REWARD_TYPE.PAID) {
    if (isBlank(draft.amount)) {
      fail('amount', ERROR_CODE.REQUIRED, '付费类需要填一个参考金额')
    } else if (toPositiveNumber(draft.amount) === null) {
      fail('amount', ERROR_CODE.INVALID_NUMBER, '参考金额要是大于 0 的数字')
    }
  }

  // 搭子类要说明人数
  if (draft.category === REQUEST_CATEGORY.COMPANION) {
    const headcount = toPositiveNumber(draft.headcount)
    if (isBlank(draft.headcount)) {
      fail('headcount', ERROR_CODE.REQUIRED, '搭子类需要填需要几个人')
    } else if (
      headcount === null ||
      !Number.isInteger(headcount) ||
      headcount < LIMIT.HEADCOUNT_MIN ||
      headcount > LIMIT.HEADCOUNT_MAX
    ) {
      fail(
        'headcount',
        ERROR_CODE.INVALID_NUMBER,
        `人数要是 ${LIMIT.HEADCOUNT_MIN}~${LIMIT.HEADCOUNT_MAX} 之间的整数`
      )
    }
  }

  // 偏好开关：只认白名单里的键；任何异性偏好一律拒绝（D-09 的数据结构防线）
  if (draft.preference !== undefined && draft.preference !== null) {
    if (typeof draft.preference !== 'object' || Array.isArray(draft.preference)) {
      fail('preference', ERROR_CODE.INVALID_ENUM, '偏好字段格式不对')
    } else {
      for (const key of Object.keys(draft.preference)) {
        if (PREFERENCE_FLAG_VALUES.includes(key)) continue
        if (/opposite|异性/i.test(key)) {
          fail(
            `preference.${key}`,
            ERROR_CODE.FORBIDDEN_FIELD,
            '本产品不提供异性偏好选项，只有「仅同性响应」这个安全开关'
          )
        } else {
          fail(`preference.${key}`, ERROR_CODE.INVALID_ENUM, '不认识这个偏好开关')
        }
      }
    }
  }

  // 地点只提示不拦截：模糊到街区级是安全设计，但用户写细了也不阻断发布
  if (!isBlank(draft.area) && DETAILED_ADDRESS_PATTERNS.some(re => re.test(draft.area))) {
    hints.push({
      field: 'area',
      message: '地点建议只写到街区或地铁站，不用写门牌号'
    })
  }

  return { valid: errors.length === 0, errors, hints }
}

module.exports = {
  ERROR_CODE,
  LIMIT,
  validateRequestDraft
}
