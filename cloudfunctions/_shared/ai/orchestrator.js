/**
 * 小螺的工具编排规则（M2-13）。**纯函数：只决定"这句话该走哪个工具"，不执行。**
 * 执行在 `service/assistantService.js`。
 *
 * 为什么路由不交给模型的 function calling 自己发挥（计划 M2-13 第 2 条：编排规则要显式可读）：
 * 让模型选工具，选错时没有任何报错，只表现成"助手今天有点笨"，而且同一句话今天走 A 明天走 B，
 * 没法复现、没法测。规则写成代码后，"为什么走了这个工具"永远能被解释和单测。
 *
 * 代价是规则覆盖不到的说法会落到 UNKNOWN —— 这是刻意的：**识别不了就澄清一次，
 * 仍不清楚就给三个按钮让用户选，不硬猜**（计划第 2 条）。硬猜一次错误的建单比问一句更贵。
 */

const { AI_CAPABILITY } = require('../constants/aiCapabilities')

/** 用户意图。**只有这四种 + 认不出来**，与 PRD 5.2 的对话入口一轨对应 */
const INTENT = Object.freeze({
  /** 我要找人做某事 → 解析成需求单草稿 */
  PUBLISH: 'publish',
  /** 打听某事 → 站内语料兜底作答 */
  ASK: 'ask',
  /** 帮我列清单 → 落地清单 */
  CHECKLIST: 'checklist',
  /** 谁能帮我 → 可解释匹配 */
  MATCH: 'match',
  UNKNOWN: 'unknown'
})

/** 助手可用的五个工具，**契约直接复用注册表**，这里只登记工具名（计划第 1 条） */
const TOOL = Object.freeze({
  PARSE_REQUEST: AI_CAPABILITY.PARSE_REQUEST,
  CREATE_REQUEST: AI_CAPABILITY.CREATE_REQUEST,
  SEARCH_KNOWLEDGE: AI_CAPABILITY.SEARCH_KNOWLEDGE,
  GENERATE_CHECKLIST: AI_CAPABILITY.GENERATE_CHECKLIST,
  MATCH_RESPONDERS: AI_CAPABILITY.MATCH_RESPONDERS
})

const TOOL_VALUES = Object.freeze(Object.values(TOOL))

/** 意图 → 工具。一对一，没有"一个意图可能走两个工具"这种模糊地带 */
const INTENT_TOOL = Object.freeze({
  [INTENT.PUBLISH]: TOOL.PARSE_REQUEST,
  [INTENT.ASK]: TOOL.SEARCH_KNOWLEDGE,
  [INTENT.CHECKLIST]: TOOL.GENERATE_CHECKLIST,
  [INTENT.MATCH]: TOOL.MATCH_RESPONDERS
})

/**
 * **唯一有副作用的工具**（计划第 3 条）。它必须二次确认才执行，
 * 且执行仍走 `requestService.create`（内部经 `transitionRequest` 单一入口）——不给助手开后门。
 */
const SIDE_EFFECT_TOOLS = Object.freeze([TOOL.CREATE_REQUEST])

/**
 * 追问上限 2 轮（PRD 5.4 / 计划第 5 条）。第 3 次还认不出来就不再问，直接给按钮 ——
 * 反复追问比给三个按钮更让人烦，而且每次追问都是一次真实的模型调用。
 */
const MAX_CLARIFY = 2

/**
 * 意图关键词。**顺序即优先级**，因为一句话常常同时命中多组：
 *   「谁能帮我买菜」既有"谁能帮我"也有"帮我"，必须先判 MATCH
 *   「落地第一周要办什么」既有"要办什么"也有疑问词，必须先判 CHECKLIST
 * 把优先级写成数组顺序，比写一串 if-else 更容易看出"为什么是这个意图"。
 */
const INTENT_RULES = Object.freeze([
  {
    intent: INTENT.MATCH,
    keywords: ['谁能帮我', '谁可以帮', '谁能来', '找谁', '推荐谁', '有人响应', '谁会来', '谁合适']
  },
  {
    intent: INTENT.CHECKLIST,
    keywords: ['清单', '要办什么', '要做什么', '落地', '第一周', '刚到要', '准备什么', 'checklist']
  },
  {
    intent: INTENT.PUBLISH,
    keywords: [
      '找人', '找个', '找位', '找伴', '搭子', '陪我', '陪同', '帮我带', '帮我买', '代购',
      '求个', '求人', '有没有人愿意', '想找', '招人', '发个需求', '发一条'
    ]
  },
  {
    intent: INTENT.ASK,
    keywords: ['怎么', '如何', '哪里', '哪个', '多少', '贵不贵', '需不需要', '要不要', '是不是', '吗', '?', '？']
  }
])

/**
 * 识别意图。
 *
 * @param {string} text
 * @param {object} [context]
 * @param {boolean} [context.hasActiveRequest] 有没有在架需求单（决定 MATCH 是否可执行）
 * @returns {{intent: string, matchedBy: string}} `matchedBy` 是命中的那个词，用来解释"为什么这么判"
 */
const detectIntent = (text, context = {}) => {
  const raw = String(text || '').toLowerCase()
  if (!raw.trim()) return { intent: INTENT.UNKNOWN, matchedBy: '' }

  for (const rule of INTENT_RULES) {
    const hit = rule.keywords.find(word => raw.includes(word))
    if (!hit) continue
    // 想找人响应，但手上一条在架的单都没有 —— 这不是 MATCH，是"你得先有一条单"
    if (rule.intent === INTENT.MATCH && context.hasActiveRequest !== true) {
      return { intent: INTENT.UNKNOWN, matchedBy: hit, reason: 'no_active_request' }
    }
    return { intent: rule.intent, matchedBy: hit }
  }
  return { intent: INTENT.UNKNOWN, matchedBy: '' }
}

/** 认不出来时给的三个按钮（计划第 2 条：不硬猜） */
const FALLBACK_OPTIONS = Object.freeze([
  { intent: INTENT.PUBLISH, label: '我想找人帮我做件事' },
  { intent: INTENT.ASK, label: '我想打听点事' },
  { intent: INTENT.CHECKLIST, label: '帮我列个落地清单' }
])

const CLARIFY_QUESTION = '我没太确定你想做哪件事 —— 是想找人帮忙、打听点什么，还是要一份落地清单？'

const NO_ACTIVE_REQUEST_HINT = '你现在没有在架的需求单，所以还没法找人。先说一句你想找什么，我帮你整理成一条需求单？'

/**
 * 规划下一步。
 *
 * @param {object} input
 * @param {string} input.text                用户这句话
 * @param {number} [input.clarifyCount]      已经澄清过几轮
 * @param {boolean} [input.hasActiveRequest]
 * @param {object} [input.pendingDraft]      上一轮解析出来、等用户确认的草稿
 * @param {boolean} [input.confirmed]        用户是不是刚点了"确认发布"
 * @param {string} [input.forcedIntent]      用户点了三个按钮之一时直接指定意图
 * @returns {object} `{ action, tool, intent, ... }`。`action` 只有三种：
 *          `call_tool`（执行某个工具）、`clarify`（追问一次）、`offer_options`（给按钮）
 */
const plan = ({
  text = '',
  clarifyCount = 0,
  hasActiveRequest = false,
  pendingDraft = null,
  confirmed = false,
  forcedIntent = ''
} = {}) => {
  // 用户确认了草稿 → 唯一的有副作用工具，且只有走到这里才允许执行
  if (confirmed === true && pendingDraft) {
    return {
      action: 'call_tool',
      intent: INTENT.PUBLISH,
      tool: TOOL.CREATE_REQUEST,
      needsConfirm: false,
      confirmedAt: 'user',
      draft: pendingDraft
    }
  }

  const forced = forcedIntent && INTENT_TOOL[forcedIntent] ? { intent: forcedIntent, matchedBy: 'user_choice' } : null
  const detected = forced || detectIntent(text, { hasActiveRequest })

  if (detected.intent === INTENT.UNKNOWN) {
    // 追问上限之内先问一次；问过了就给按钮，不再反复追问
    if (detected.reason === 'no_active_request') {
      return { action: 'clarify', intent: INTENT.UNKNOWN, question: NO_ACTIVE_REQUEST_HINT, clarifyCount: clarifyCount + 1 }
    }
    if (clarifyCount < MAX_CLARIFY - 1) {
      return { action: 'clarify', intent: INTENT.UNKNOWN, question: CLARIFY_QUESTION, clarifyCount: clarifyCount + 1 }
    }
    return { action: 'offer_options', intent: INTENT.UNKNOWN, options: FALLBACK_OPTIONS }
  }

  const tool = INTENT_TOOL[detected.intent]
  return {
    action: 'call_tool',
    intent: detected.intent,
    tool,
    matchedBy: detected.matchedBy,
    // 解析出草稿之后还要用户确认一次才建单，所以解析这一步就要告诉端侧"后面有个确认"
    needsConfirm: tool === TOOL.PARSE_REQUEST
  }
}

module.exports = {
  INTENT,
  TOOL,
  TOOL_VALUES,
  INTENT_TOOL,
  SIDE_EFFECT_TOOLS,
  MAX_CLARIFY,
  INTENT_RULES,
  FALLBACK_OPTIONS,
  CLARIFY_QUESTION,
  NO_ACTIVE_REQUEST_HINT,
  detectIntent,
  plan
}
