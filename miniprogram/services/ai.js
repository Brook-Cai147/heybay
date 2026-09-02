/**
 * AI 能力的端侧服务（M2-07）。**全项目端侧唯一调 `aiGateway` 的地方。**
 *
 * 和 `services/request.js` 有一个关键区别：**这里的方法永不抛错。**
 *
 * 原因是 D-15：AI 失败不能伤主流程。`callAction` 会把 `ok: false` 转成 Error，
 * 但对 AI 来说"这次用不了"是**预期结果**而不是异常 —— 额度用完、成本护栏、模型抽风、
 * 网络不通，四种情况页面要做的事完全一样：展开纯表单，让用户自己填。
 * 如果这里抛错，每个调用点都得写一遍 try-catch，迟早有一个漏掉，那次就会变成一个红色报错弹窗。
 *
 * 所以统一返回 `{ ok, ... }`，页面只判 `ok`，失败时拿 `message` 当一行说明展示。
 */

const { callAction, CLIENT_ERROR } = require('./cloud')
const { track } = require('../utils/track')

const FUNCTION_NAME = 'aiGateway'

/** 这些码代表"AI 这次帮不上忙"，页面按降级处理，不当成故障 */
const SOFT_FAIL_CODES = ['AI_FALLBACK', 'AI_QUOTA_EXCEEDED', 'AI_NOT_AVAILABLE']

/** 端侧就失败的（网络、云能力没起来）：服务端根本没收到请求，降级事件得由端侧补报 */
const CLIENT_SIDE_CODES = [CLIENT_ERROR.NETWORK_ERROR, CLIENT_ERROR.CLOUD_NOT_READY]

const softFail = (capability, err) => {
  const code = err.code || 'UNKNOWN'
  if (CLIENT_SIDE_CODES.includes(code)) {
    // 服务端没跑到，aiService 那边不会有降级记录，这条得端侧报，否则降级率会被低估
    track('ai_fallback_triggered', { capability, reason: code })
  }
  return {
    ok: false,
    code,
    message: err.message || '这次没能帮上忙，你直接填表单也一样',
    soft: SOFT_FAIL_CODES.includes(code) || CLIENT_SIDE_CODES.includes(code),
    fallback: err.fallback || null
  }
}

/**
 * 一句话 → 需求单草稿。
 * @param {string} text 用户的原话
 * @param {string} city 当前城市
 * @returns {Promise<object>} `{ ok: true, draft, fieldSources, confidence, unclassified, hint, meta }`
 *          或 `{ ok: false, code, message, soft }`
 */
const parseRequest = async (text, city) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'parseRequest', { text, city })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('parseRequest', err)
  }
}

/**
 * 基于站内语料的兜底作答。
 * @param {string} question
 * @param {string} city
 * @param {Array} [snippets] 关键词检索命中的语料（M2-09 起有值）
 */
const searchKnowledge = async (question, city, snippets = []) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'searchKnowledge', { question, city, snippets })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('searchKnowledge', err)
  }
}

module.exports = {
  SOFT_FAIL_CODES,
  parseRequest,
  searchKnowledge
}
