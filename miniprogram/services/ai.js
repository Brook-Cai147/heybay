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

/**
 * 用户点了草稿里的一个选项（报酬类型 / 有效时长 / 人数）。不调模型，纯逻辑。
 *
 * 为什么不在端侧直接改草稿：「还差什么、接下来问哪一项、能不能确认发布」的规则
 * 必须和服务端的 `requestValidator` 一致，只能有一处算。端侧自己判断迟早漂移。
 */
const assistantFill = async ({ draft, fieldSources, field, value }) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'assistantFill', { draft, fieldSources, field, value })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('assistantFill', err)
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

/**
 * 自主性档位（M2-14 / D-14）。
 *
 * **档位由服务端算**：端侧只负责显示与提交用户的选择。
 * 取不到就返回 `ok: false`，页面把档位区块整块隐藏 —— 显示一个错的档位比不显示更糟，
 * 用户会据此判断"AI 会不会替我发东西"。
 */
const autonomyInfo = async () => {
  try {
    const res = await callAction(FUNCTION_NAME, 'autonomyInfo', {})
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('autonomyInfo', err)
  }
}

/** 切换档位。**可回退**是 PRD 5.4 的明确要求，所以 L0 ⇄ L1 双向都走这一个方法 */
const setAutonomy = async level => {
  try {
    const res = await callAction(FUNCTION_NAME, 'setAutonomy', { level })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('setAutonomy', err)
  }
}

/** 起草定向邀请（不发送）。L0 档也能拿到草稿，只是 `canSend` 为 false */
const draftInvite = async requestId => {
  try {
    const res = await callAction(FUNCTION_NAME, 'draftInvite', { requestId })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('draftInvite', err)
  }
}

/**
 * 发出邀请。
 * @param {string} requestId
 * @param {Array<object>} targets 用户**勾选后**的名单 `[{ openid, text, textSource }]`
 *
 * 这里不做"没勾就全发"的兜底：那等于把勾选这一步偷偷跳过（D-14）。
 */
const sendInvites = async (requestId, targets) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'sendInvites', { requestId, targets })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('sendInvites', err)
  }
}

/** L1→L2 一次性询问的答案。答"要"也不会改档位，只是记下来（L2 属 M5） */
const answerL2Prompt = async (requestId, accepted) => {
  try {
    const res = await callAction(FUNCTION_NAME, 'answerL2Prompt', { requestId, accepted })
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('answerL2Prompt', err)
  }
}

/** 我收到的邀请（消息 Tab） */
const myInvites = async () => {
  try {
    const res = await callAction(FUNCTION_NAME, 'myInvites', {})
    return Object.assign({ ok: true }, res)
  } catch (err) {
    return softFail('myInvites', err)
  }
}

module.exports = {
  SOFT_FAIL_CODES,
  parseRequest,
  searchKnowledge,
  generateChecklist,
  matchResponders,
  assistantChat,
  assistantFill,
  assistantGreeting,
  autonomyInfo,
  setAutonomy,
  draftInvite,
  sendInvites,
  answerL2Prompt,
  myInvites
}
