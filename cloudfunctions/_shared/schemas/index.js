/**
 * AI 输出 Schema 的汇总表（M2-02）。能力名 → Schema。
 *
 * M2-03 的注册表通过能力名到这里取 Schema；网关不直接 require 单个 Schema 文件，
 * 这样"某能力的 Schema 不存在"能在注册表单测里被发现，而不是等到线上调用才炸。
 */

const { AI_CAPABILITY } = require('../constants/aiCapabilities')
const { parseRequestSchema, USER_ONLY_FIELDS } = require('./parseRequest')
const { searchKnowledgeSchema, REFUSAL_REASON } = require('./searchKnowledge')

/** 已实现的 Schema。M2-02 只做两个，其余能力随各自里程碑补 */
const AI_SCHEMAS = Object.freeze({
  [AI_CAPABILITY.PARSE_REQUEST]: parseRequestSchema,
  [AI_CAPABILITY.SEARCH_KNOWLEDGE]: searchKnowledgeSchema
})

const schemaOf = capability => AI_SCHEMAS[capability] || null

module.exports = {
  AI_SCHEMAS,
  USER_ONLY_FIELDS,
  REFUSAL_REASON,
  schemaOf
}
