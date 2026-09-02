/**
 * 兜底作答的编排（M2-10）。落地 D-13 最核心的主张：**AI 是供给的兜底层** ——
 * 站里没有真人回答时，先用站内语料给一个有出处的答案，而不是让用户对着空页面。
 *
 * 顺序不能换：
 *   1 拒答前置拦截（不调模型）  2 语料检索  3 调模型（唯一出口仍是 aiService）
 *   4 来源白名单校验            5 语料不足或来源不可信时退回关键词兜底
 *
 * 红线判断都在 `ai/answerGuard.js`（纯函数、有单测），本文件只负责按顺序把它们串起来。
 */

const { ok } = require('../constants/errors')
const { AI_CAPABILITY } = require('../constants/aiCapabilities')
const { guard, sanitizeSources, attributionOf, isFabricated } = require('../ai/answerGuard')
const { search } = require('./knowledgeSearch')
const aiService = require('./aiService')
const aiLogsDao = require('../dao/aiLogs')
const trackService = require('./trackService')

const QUESTION_MAX = 300

/** 与 aiService 一致：联调期的 AI 记录都打测试标记，便于一次性清理 */
const INCLUDE_TEST_DATA = true

/** M1 只开伦敦，城市中文名先按 code 映射；M3 迁往 cities 集合后从配置取（D-34） */
const cityNameOf = cityCode => (cityCode === 'london' ? '伦敦' : cityCode)

/** 关键词兜底：模型不可用或输出不可信时，至少把检索到的原文给出去（注册表的 KEYWORD_ONLY 策略） */
const keywordOnly = ({ snippets, cityName, reasonCode }) =>
  ok({
    capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
    answer: snippets.length
      ? '这个问题我没法总结得更好，下面是站里能找到的原话，你自己判断：'
      : '这个问题站里还没有人聊过，我不编。你可以直接发一条需求单问问本地的人。',
    sources: snippets.map(item => ({
      refId: item.refId,
      kind: item.kind,
      excerpt: String(item.text || '').slice(0, 120),
      sourceRef: item.sourceRef || ''
    })),
    attribution: attributionOf(cityName, snippets.length),
    refused: false,
    refusalReason: null,
    confidence: snippets.length ? 'low' : null,
    degraded: true,
    reasonCode: reasonCode || 'keyword_only',
    meta: { fromCache: false, cost: 0 }
  })

/** 拒答留痕。写失败只打日志 —— 拒答本身已经生效了，不该因为记账失败而报错 */
const logRefusal = async ({ openid, reason }) => {
  try {
    await aiLogsDao.insert(
      {
        openid,
        capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
        // 没调模型：不计额度、不计成本
        quotaCounted: false,
        result: aiService.AI_RESULT.REFUSED,
        errorCode: reason,
        attempts: 0
      },
      INCLUDE_TEST_DATA
    )
  } catch (err) {
    console.error('[fallbackAnswer] 拒答留痕失败（不影响返回）', err && err.message)
  }
}

/**
 * 兜底作答。
 *
 * @param {object} input
 * @param {string} input.openid
 * @param {object} input.params `{ question, city }`
 * @returns {object} 拒答与"没查到"都是 `ok: true` 的**正常结果**；只有模型链路失败才带 `degraded: true`。
 *          额度耗尽如实透传 `aiService` 的返回，不伪装成"没查到"。
 */
const answer = async ({ openid, params = {} }) => {
  const question = String(params.question || '').trim().slice(0, QUESTION_MAX)
  const cityCode = params.city || 'london'
  const cityName = cityNameOf(cityCode)

  // 第 1 步：拒答前置拦截。**不调模型**，所以不花钱、不占额度
  const gate = guard(question)
  if (gate.refused) {
    await logRefusal({ openid, reason: gate.reason })
    return ok({
      capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
      answer: gate.answer,
      sources: [],
      attribution: '',
      refused: true,
      refusalReason: gate.reason,
      confidence: null,
      guarded: true,
      meta: { fromCache: false, cost: 0, guardHit: gate.hit }
    })
  }

  // 第 2 步：检索。语料为空也照样往下走 —— 让模型明确说"没查到"比服务端替它说更一致
  const found = await search({ city: cityCode, question })

  // 第 3 步：模型调用。仍然只走 aiService（额度、缓存、降级、记账都在那一层）
  const res = await aiService.invoke({
    openid,
    capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
    params: { question, city: cityCode, snippets: found.snippets }
  })

  if (!res.ok) {
    if (!res.fallback) return res
    return keywordOnly({ snippets: found.snippets, cityName, reasonCode: res.fallback.reasonCode })
  }

  // 第 4 步：来源白名单
  const data = res.data || {}
  const { kept, dropped } = sanitizeSources(data.sources, found.snippets)
  if (dropped.length) {
    console.error('[fallbackAnswer] 模型给了不存在的来源，已丢弃：', dropped.join(', '))
  }

  // 第 5 步：给了具体答案却没有一条来源站得住 —— 按编造处理，改走关键词兜底
  if (isFabricated({ data, snippetCount: found.snippets.length, keptCount: kept.length })) {
    trackService.reportSafely({
      openid,
      name: 'ai_fallback_triggered',
      params: { capability: AI_CAPABILITY.SEARCH_KNOWLEDGE, reason: 'sources_unverifiable' },
      isTest: INCLUDE_TEST_DATA
    })
    return keywordOnly({ snippets: found.snippets, cityName, reasonCode: 'sources_unverifiable' })
  }

  return ok({
    capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
    answer: data.answer,
    sources: kept,
    attribution: attributionOf(cityName, kept.length),
    refused: data.refused === true,
    refusalReason: data.refusalReason || null,
    confidence: data.confidence || null,
    // 检索侧的观测量：命中了哪些标签、候选多少条。验证"命中是否合理"时看它
    retrieval: { tags: found.tags, candidateCount: found.candidateCount, hitCount: found.snippets.length },
    droppedSources: dropped,
    meta: res.meta
  })
}

module.exports = {
  QUESTION_MAX,
  cityNameOf,
  answer
}
