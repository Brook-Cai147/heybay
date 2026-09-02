/**
 * AI 结果缓存的**键与有效期计算**（M2-05）。纯逻辑，不碰数据库 —— 存取在 `dao/aiCache.js`。
 *
 * 键 = 城市 + 能力 + 输入归一化后的哈希（计划 M2-05 第 1 条）。
 * 三段都必要：
 *   城市 —— 同一个问题在伦敦和其他城市的答案不该互相污染（D-10 的开城边界）
 *   能力 —— 同一段文本喂给不同能力，输出完全不同
 *   哈希 —— 原文可能很长且含个人信息，不适合当键存在库里
 *
 * **归一化只做安全的那部分**：大小写、空白、首尾标点。不做同义词归并、不去停用词 ——
 * 那会让两个问法不同、答案也该不同的问题撞成一条缓存，命中率的收益远小于答错的代价。
 */

const crypto = require('crypto')

const { AI_CAPABILITY } = require('../constants/aiCapabilities')

const DEFAULT_CITY = 'unknown'

/** 归一化：小写 + 空白折叠 + 去首尾标点 */
const normalizeInput = text =>
  String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。、？！,.?!]+|[\s，。、？！,.?!]+$/g, '')

const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)

/**
 * 各能力参与哈希的输入。
 * `searchKnowledge` 必须把语料的 refId 一起算进去 —— 语料变了答案就该变，
 * 只用问题做键会让"补了新语料还回旧答案"变成一个查不出来的 bug。
 */
const CACHE_INPUT = Object.freeze({
  [AI_CAPABILITY.SEARCH_KNOWLEDGE]: (params = {}) => {
    const refIds = (Array.isArray(params.snippets) ? params.snippets : [])
      .map(item => String((item && item.refId) || ''))
      .filter(Boolean)
      .sort()
      .join(',')
    return `${normalizeInput(params.question)}|${refIds}`
  },

  /**
   * 落地清单（M2-12）：**只按出行类型缓存，不含到达时间**（计划 M2-12 第 2 条：
   * 同城市同出行类型可复用）。代价是同一份清单会被不同日期的用户共用，
   * 所以 Prompt 里明确要求"不要写具体日期，写成落地当天" —— 少了这条约束，缓存就会串日期。
   */
  [AI_CAPABILITY.GENERATE_CHECKLIST]: (params = {}) => normalizeInput(params.travelType)
})

/** 该能力可缓存吗：注册表说了算，且必须有一个能算键的输入 */
const isCacheable = record =>
  !!record && record.cacheable === true && !!CACHE_INPUT[record.capability]

const cacheKeyOf = ({ capability, city, params = {} }) => {
  const builder = CACHE_INPUT[capability]
  if (!builder) return null
  const input = builder(params)
  if (!normalizeInput(input.split('|')[0])) return null
  const cityCode = String(city || DEFAULT_CITY).toLowerCase()
  return `${cityCode}:${capability}:${hash(input)}`
}

const expireAtMsOf = (record, nowMs) => nowMs + Number(record.cacheTtlSeconds || 0) * 1000

module.exports = {
  DEFAULT_CITY,
  normalizeInput,
  isCacheable,
  cacheKeyOf,
  expireAtMsOf
}
