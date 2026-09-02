/**
 * Prompt 变量组装（M2-04）。**枚举在这里注入，模板里一个字面量都不写。**
 *
 * 分成独立文件而不是塞进 `aiService`：模板与它需要的变量是一对，改模板时要同时看这两个文件，
 * 放在一起比散在编排逻辑里更难写漏。每新增一个能力，这里加一个 builder。
 *
 * builder 的返回值必须**填满模板里的每个占位符** —— `registry.renderPrompt` 少一个就抛错，
 * 所以这里漏了会在单测或第一次调用时立刻暴露，不会带着 `{{city}}` 字面量发给模型。
 */

const {
  AI_CAPABILITY
} = require('../constants/aiCapabilities')
const {
  REQUEST_CATEGORY_VALUES,
  REQUEST_CATEGORY_LABEL,
  TIMING_TYPE_VALUES,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE_VALUES,
  FIELD_SOURCE_VALUES
} = require('../constants/enums')
const { PARSE_OUTPUT_FIELDS } = require('../schemas/parseRequest')
const { REASON_MAX } = require('../schemas/matchResponders')
const {
  CHECKLIST_GROUP_VALUES,
  CHECKLIST_GROUP_LABEL,
  ITEMS_PER_GROUP_MAX,
  TEXT_MAX,
  NOTE_MAX,
  REMINDER_MAX
} = require('../schemas/generateChecklist')

/** `companion（搭子同行）、paid_guide（付费地陪）…`：值给机器、中文给模型理解 */
const categoryList = () =>
  REQUEST_CATEGORY_VALUES.map(value => `${value}（${REQUEST_CATEGORY_LABEL[value]}）`).join('、')

/** 语料条目渲染成给模型看的编号列表；没有语料时明确说"没有"，而不是给个空白 */
const renderSnippets = snippets => {
  if (!Array.isArray(snippets) || !snippets.length) {
    return '（没有检索到任何语料）'
  }
  return snippets
    .map((item, index) => {
      const refId = item && item.refId ? item.refId : `unknown-${index + 1}`
      const kind = item && item.kind ? item.kind : 'preset'
      const text = String((item && item.text) || '').slice(0, 300)
      return `（${index + 1}）refId=${refId} kind=${kind}：${text}`
    })
    .join('\n')
}

/**
 * 候选与依据渲染成编号列表。**只给依据文本，不给 openid、不给分数** ——
 * 身份标识没有任何理由进模型上下文（D-33）；分数给了模型就会开始比较谁更好，
 * 而"谁更好"不是它该说的（排序已经由代码定了）。
 */
const renderCandidates = candidates => {
  if (!Array.isArray(candidates) || !candidates.length) return '（没有候选）'
  return candidates
    .map((item, index) => {
      const evidence = Array.isArray(item && item.evidence) ? item.evidence : []
      const facts = evidence.map(fact => fact.text).join('；') || '（无依据）'
      return `（${index + 1}）依据：${facts}`
    })
    .join('\n')
}

/** 核实过的事实（紧急号码、使领馆等）。渲染成"键：值"，让模型只能照抄 */
const renderFacts = facts => {
  if (!facts || typeof facts !== 'object') return '（没有可用的预置事实）'
  const lines = Object.entries(facts)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `- ${key}：${Array.isArray(value) ? value.join('、') : value}`)
  return lines.length ? lines.join('\n') : '（没有可用的预置事实）'
}

const BUILDERS = Object.freeze({
  [AI_CAPABILITY.PARSE_REQUEST]: ({ params = {}, city = {} }) => ({
    city: city.nameZh || params.city || '',
    // 字段名从 Schema 取，模板里不手抄 —— Schema 改了 Prompt 自动跟着变
    outputFields: PARSE_OUTPUT_FIELDS,
    categories: categoryList(),
    timingTypes: TIMING_TYPE_VALUES,
    instantDurations: INSTANT_DURATION_VALUES,
    rewardTypes: REWARD_TYPE_VALUES,
    fieldSources: FIELD_SOURCE_VALUES,
    userText: String(params.text || '').slice(0, 500)
  }),

  [AI_CAPABILITY.SEARCH_KNOWLEDGE]: ({ params = {}, city = {} }) => ({
    city: city.nameZh || params.city || '',
    question: String(params.question || '').slice(0, 300),
    snippets: renderSnippets(params.snippets)
  }),

  [AI_CAPABILITY.MATCH_RESPONDERS]: ({ params = {}, city = {} }) => ({
    city: city.nameZh || params.city || '',
    category: REQUEST_CATEGORY_LABEL[params.category] || params.category || '',
    title: String(params.title || '').slice(0, 60),
    // 字数上限从 Schema 取，模板里不手抄 —— 两处各写一个数就会漂移
    reasonMax: REASON_MAX,
    candidates: renderCandidates(params.candidates)
  }),

  [AI_CAPABILITY.GENERATE_CHECKLIST]: ({ params = {}, city = {} }) => ({
    city: city.nameZh || params.city || '',
    arriveAt: String(params.arriveAt || '').slice(0, 40),
    travelType: String(params.travelType || '').slice(0, 40),
    groups: CHECKLIST_GROUP_VALUES.map(value => `${value}（${CHECKLIST_GROUP_LABEL[value]}）`).join('、'),
    itemsPerGroupMax: ITEMS_PER_GROUP_MAX,
    textMax: TEXT_MAX,
    noteMax: NOTE_MAX,
    reminderMax: REMINDER_MAX,
    facts: renderFacts(params.facts),
    snippets: renderSnippets(params.snippets)
  })
})

const buildVars = (capability, context = {}) => {
  const builder = BUILDERS[capability]
  if (!builder) {
    const err = new Error(`能力 ${capability} 还没有 Prompt 变量组装器`)
    err.code = 'PROMPT_VARS_BUILDER_MISSING'
    throw err
  }
  return builder(context)
}

module.exports = {
  BUILDERS,
  buildVars,
  categoryList,
  renderSnippets,
  renderCandidates,
  renderFacts
}
