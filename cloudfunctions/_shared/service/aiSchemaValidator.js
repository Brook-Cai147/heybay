/**
 * AI 输出校验器与降级判定（M2-02）。**零依赖手写**，不引 ajv。
 *
 * 为什么不引库：本项目只用到 JSON Schema 的极小子集（类型、枚举、必填、长度、嵌套），
 * 引一个通用校验库会带来一份需要跟着云函数上传的依赖，收益是用不上的 99% 功能。
 *
 * 两个刻意的取舍：
 *   1. **未声明的多余字段不算错**，只记 warning 并从结果里剥掉。模型爱多加键，
 *      为此把整条解析判死会白白触发降级，而降级的代价（用户回到空表单）比忽略一个多余键大得多。
 *   2. **校验失败返回字段级错误列表**，不是一句"格式不对"。网关要据此决定重试还是降级，
 *      而重试的 Prompt 里要能告诉模型具体哪个字段错了。
 */

const { FIELD_SOURCE } = require('../constants/enums')

/** 字段级错误码 */
const VALIDATION_CODE = Object.freeze({
  TYPE: 'type',
  ENUM: 'enum',
  REQUIRED: 'required',
  TOO_SHORT: 'too_short',
  TOO_LONG: 'too_long',
  TOO_MANY: 'too_many',
  BELOW_MIN: 'below_min',
  ABOVE_MAX: 'above_max',
  AI_FIELD_FORBIDDEN: 'ai_field_forbidden',
  NOT_AN_OBJECT: 'not_an_object'
})

/** 降级判定的三种决策（tech-stack 6.1 第 6~7 步） */
const FALLBACK_DECISION = Object.freeze({
  PASS: 'pass',
  RETRY: 'retry',
  FALLBACK: 'fallback'
})

/** 校验失败后最多重试一次（PRD 5.4「追问上限」的同一克制原则：不做死循环） */
const MAX_RETRIES = 1

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const charLength = text => Array.from(String(text)).length
const isBlank = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** 类型判定。`integer` 单独处理，`nullable` 允许 null 与 undefined */
const typeMatches = (type, value) => {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return false
  }
}

/**
 * 校验单个值。返回 `{ errors, value }`，`value` 是剥掉未声明字段后的干净值。
 * 递归实现，`path` 用点号连接，便于错误列表直接指向 `sources[0].refId` 这种位置。
 */
const validateValue = (schema, value, path) => {
  const errors = []
  const at = (code, message) => errors.push({ path, code, message })

  if (value === undefined || value === null) {
    // 到得了这里说明字段不在 required 里；nullable 显式允许空，未标 nullable 的也按缺省处理
    return { errors, value: null }
  }

  /**
   * 「留空」在 JSON 里有三种写法：字段缺失、`null`、空字符串。Prompt 明确要求"判断不了就留空"，
   * 模型回一个 `""` 是完全合理的响应，不该被判成"枚举值不在白名单"——第一次真实调用就栽在这儿。
   * 只对 `nullable` 字段生效：`title` 这类有 minLength 的字段，空串仍然要报错。
   */
  if (schema.nullable && typeof value === 'string' && value.trim() === '') {
    return { errors, value: null }
  }

  if (!typeMatches(schema.type, value)) {
    at(VALIDATION_CODE.TYPE, `应为 ${schema.type}，实际是 ${Array.isArray(value) ? 'array' : typeof value}`)
    return { errors, value: null }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    at(VALIDATION_CODE.ENUM, `取值不在白名单内：${value}`)
    return { errors, value: null }
  }

  if (schema.type === 'string') {
    const len = charLength(value)
    if (schema.minLength !== undefined && len < schema.minLength) {
      at(VALIDATION_CODE.TOO_SHORT, `至少 ${schema.minLength} 个字符`)
    }
    if (schema.maxLength !== undefined && len > schema.maxLength) {
      at(VALIDATION_CODE.TOO_LONG, `最多 ${schema.maxLength} 个字符`)
    }
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      at(VALIDATION_CODE.BELOW_MIN, `不能小于 ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      at(VALIDATION_CODE.ABOVE_MAX, `不能大于 ${schema.maximum}`)
    }
  }

  if (schema.type === 'array') {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      at(VALIDATION_CODE.TOO_MANY, `最多 ${schema.maxItems} 项`)
    }
    const cleaned = []
    value.slice(0, schema.maxItems === undefined ? value.length : schema.maxItems).forEach((item, i) => {
      const res = validateValue(schema.items || {}, item, `${path}[${i}]`)
      errors.push(...res.errors)
      cleaned.push(res.value)
    })
    return { errors, value: cleaned }
  }

  if (schema.type === 'object') return validateObject(schema, value, path, errors)

  return { errors, value }
}

/**
 * 对象校验。两种形态：
 *   - `properties`：逐字段声明（多余字段剥掉并记 warning）
 *   - `valueSchema`：当作映射表，所有值用同一个子 Schema（`fieldSources` 就是这种）
 */
const validateObject = (schema, value, path, errors) => {
  const warnings = []
  const cleaned = {}

  for (const field of schema.required || []) {
    if (isBlank(value[field]) && value[field] !== false && value[field] !== 0) {
      errors.push({
        path: path ? `${path}.${field}` : field,
        code: VALIDATION_CODE.REQUIRED,
        message: '必填字段缺失或为空'
      })
    }
  }

  if (schema.valueSchema) {
    for (const [key, item] of Object.entries(value)) {
      // 声明了键白名单时，白名单外的键剥掉并记 warning（不算错，理由同"多余字段"）
      if (Array.isArray(schema.keyWhitelist) && !schema.keyWhitelist.includes(key)) {
        warnings.push({
          path: path ? `${path}.${key}` : key,
          message: '不在字段白名单内的来源标记，已忽略'
        })
        continue
      }
      const res = validateValue(schema.valueSchema, item, path ? `${path}.${key}` : key)
      errors.push(...res.errors)
      cleaned[key] = res.value
    }
    return { errors, warnings, value: cleaned }
  }

  const declared = schema.properties || {}
  for (const [field, sub] of Object.entries(declared)) {
    if (value[field] === undefined) {
      // 声明了 nullable 却没给：显式补 null，让「缺字段 / null / 空串」三种留空写法在结果里长得一样。
      // 否则端侧要同时判 undefined 和 null，而写进云数据库时 undefined 会被直接丢掉、null 会存下来。
      if (sub.nullable) cleaned[field] = null
      continue
    }
    const res = validateValue(sub, value[field], path ? `${path}.${field}` : field)
    errors.push(...res.errors)
    // 嵌套对象里的 warning 也要冒上来：只在最外层收集会让 fieldSources 内部被剥掉的键悄无声息
    if (Array.isArray(res.warnings)) warnings.push(...res.warnings)
    if (res.value !== null || sub.nullable) cleaned[field] = res.value
  }
  for (const field of Object.keys(value)) {
    if (!(field in declared)) warnings.push({ path: path ? `${path}.${field}` : field, message: '未声明的字段，已忽略' })
  }

  return { errors, warnings, value: cleaned }
}

/**
 * PRD 5.4 在 Schema 层的兜底：标了 `source: 'ai'` 的四类字段不许有值。
 *
 * 服务端 `requestValidator.assertNoAiFilledFields` 已经拦了一道，这里再拦一道 ——
 * 前者拦的是"端侧提交上来的需求单"，这里拦的是"模型刚吐出来的解析结果"，
 * 让违规在**进入端侧之前**就被发现，用户根本不会看到一个被 AI 填了金额的表单。
 */
const checkUserOnlyFields = (userOnlyFields, value) => {
  const errors = []
  const sources = isPlainObject(value.fieldSources) ? value.fieldSources : {}
  for (const field of userOnlyFields || []) {
    if (sources[field] === FIELD_SOURCE.AI && !isBlank(value[field])) {
      errors.push({
        path: field,
        code: VALIDATION_CODE.AI_FIELD_FORBIDDEN,
        message: '金额、见面时间、见面地点、联系方式只能由用户本人填写，AI 必须留空'
      })
    }
  }
  return errors
}

/**
 * 校验一次模型输出。
 *
 * @param {object} schema  `schemas/` 里的 Schema
 * @param {*} value        模型输出（已 JSON.parse 过）
 * @returns {{valid: boolean, errors: Array, warnings: Array, value: object|null}}
 */
const validate = (schema, value) => {
  if (!isPlainObject(schema)) {
    return {
      valid: false,
      errors: [{ path: '', code: VALIDATION_CODE.NOT_AN_OBJECT, message: '没有拿到 Schema' }],
      warnings: [],
      value: null
    }
  }
  if (!isPlainObject(value)) {
    return {
      valid: false,
      errors: [{ path: '', code: VALIDATION_CODE.NOT_AN_OBJECT, message: '模型输出不是一个对象' }],
      warnings: [],
      value: null
    }
  }

  const res = validateObject(schema, value, '', [])
  const errors = res.errors.concat(checkUserOnlyFields(schema.userOnlyFields, value))

  return {
    valid: errors.length === 0,
    errors,
    warnings: res.warnings || [],
    value: errors.length === 0 ? res.value : null
  }
}

/**
 * 降级判定（tech-stack 6.1 第 6~7 步）。
 *
 * 规则很短但很关键：**校验通过就过；没过且还有重试机会就重试一次；再没过就降级。**
 * 绝不第三次尝试 —— 模型连续两次给不出合规结构，多试一次的期望收益远低于让用户多等 8 秒。
 *
 * @param {object} input
 * @param {boolean} input.valid       本次校验是否通过
 * @param {number} input.attempt      本次是第几次尝试（从 1 开始）
 * @param {number} [input.maxRetries] 允许的重试次数，默认 1
 * @param {Array} [input.errors]      字段级错误，重试时要塞进 Prompt 告诉模型哪里错了
 */
const decideFallback = ({ valid, attempt = 1, maxRetries = MAX_RETRIES, errors = [] } = {}) => {
  if (valid) return { decision: FALLBACK_DECISION.PASS, attempt }

  if (attempt <= maxRetries) {
    return {
      decision: FALLBACK_DECISION.RETRY,
      attempt,
      nextAttempt: attempt + 1,
      // 重试时把字段级错误回喂给模型，比原样重发一遍有效得多
      retryHint: errors.map(e => `${e.path || '(根)'}: ${e.message}`).join('；')
    }
  }

  return {
    decision: FALLBACK_DECISION.FALLBACK,
    attempt,
    reasonCode: 'schema_invalid_after_retry',
    // 降级信号是给端侧看的，必须是人话且给出下一步动作（D-15：AI 失败不能伤主流程）
    message: '这次没能自动整理好，你可以直接用表单填，一样能发出去',
    errors
  }
}

module.exports = {
  VALIDATION_CODE,
  FALLBACK_DECISION,
  MAX_RETRIES,
  validate,
  decideFallback
}
