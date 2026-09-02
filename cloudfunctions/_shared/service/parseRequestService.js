/**
 * parseRequest 能力的编排（M2-06）。
 *
 * 分层上它在 `aiService`（网关八步）之上、handler 之下：
 *   handler → parseRequestService → aiService.invoke → modelClient
 * **不允许跳过 `aiService` 直接调模型**（tech-stack 6.1 的单一出口铁律）——
 * 跳过就绕开了额度、缓存、降级与记账四件事，而这四件事恰恰是 AI 能上线的前提。
 *
 * 本文件只做两件事：把入参整理成能力契约要的形状，把模型输出交给 `parseDraft` 规范化。
 * 规范化规则全在纯函数里，因为那些规则（四类字段抹空、品类白名单）是产品红线，必须可测。
 */

const { ok } = require('../constants/errors')
const { AI_CAPABILITY } = require('../constants/aiCapabilities')
const { normalizeDraft } = require('../ai/parseDraft')
const aiService = require('./aiService')

const TEXT_MAX = 500

/**
 * 一句话转需求单草稿。
 *
 * @param {object} input
 * @param {string} input.openid
 * @param {object} input.params `{ text, city }`
 * @returns {object} 成功时 `{ ok: true, draft, fieldSources, confidence, unclassified, hint, meta }`；
 *          失败时**原样透传** `aiService` 的降级 / 额度返回 —— 端侧只需要认一套形状（D-15）。
 */
const parse = async ({ openid, params = {} }) => {
  const text = String(params.text || '').trim().slice(0, TEXT_MAX)
  const city = params.city

  const res = await aiService.invoke({
    openid,
    capability: AI_CAPABILITY.PARSE_REQUEST,
    params: { text, city }
  })

  // 降级、额度耗尽、成本护栏：原样返回，不在这里翻译第二遍
  if (!res.ok) return res

  const normalized = normalizeDraft(res.data)

  return ok({
    capability: AI_CAPABILITY.PARSE_REQUEST,
    draft: normalized.draft,
    fieldSources: normalized.fieldSources,
    confidence: normalized.confidence,
    unclassified: normalized.unclassified,
    hint: normalized.hint,
    aiFilledFields: normalized.aiFilledFields,
    // meta 里带着 logId：M2-08 要用它回填"这次解析有没有被采纳"
    meta: res.meta
  })
}

module.exports = {
  TEXT_MAX,
  parse
}
