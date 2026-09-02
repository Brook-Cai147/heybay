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
 *
 * **M2-10 起不再传 snippets**：语料检索移到服务端 —— 端侧能塞语料，就等于能给答案伪造来源。
 */
const searchKnowledge = async (question, city) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'searchKnowledge', { question, city })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('searchKnowledge', err)
  }
}

/**
 * 落地清单（M2-12）。长输出、每日限免 1 次，失败一律软失败。
 * @param {object} input `{ city, arriveAt, travelType }`
 */
const generateChecklist = async ({ city, arriveAt, travelType }) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'generateChecklist', { city, arriveAt, travelType })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('generateChecklist', err)
  }
}

/**
 * 给自己的需求单找可能帮得上的人（M2-11）。只拿名单与理由，不发送任何东西。
 * @param {string} requestId
 */
const matchResponders = async requestId => {
  try {
    const res = await callAction(FUNCTION_NAME, 'matchResponders', { requestId })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('matchResponders', err)
  }
}

/**
 * 小螺对话一轮（M2-13）。
 *
 * **会话状态由端侧持有**：`clarifyCount` 与 `pendingDraft` 都由调用方带上来。
 * 服务端存一份会话就要考虑过期、并发与清理，而这轮对话的全部上下文本来就在页面手里。
 *
 * @param {object} input `{ text, city, clarifyCount, pendingDraft, confirmed, forcedIntent, arriveAt, travelType }`
 * @returns {Promise<object>} `{ ok: true, reply: { kind, text, ... }, intent, tool }` 或软失败
 */
const assistantChat = async (input = {}) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'assistantChat', input)
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('assistantChat', err)
  }
}

/** 首屏身份声明。取不到就用端侧兜底文案，不能让首屏空着（PRD 5.4 身份明示） */
const assistantGreeting = async () => {
  try {
    const res = await callAction(FUNCTION_NAME, 'assistantGreeting', {})
    return res.greeting || ''
  } catch (err) {
    return '我是 AI 助手小螺。签证、医疗、法律、移民这四类问题我不给判断。'
  }
}

module.exports = {
  SOFT_FAIL_CODES,
  parseRequest,
  searchKnowledge,
  generateChecklist,
  matchResponders,
  assistantChat,
  assistantGreeting
}
