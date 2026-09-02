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
  renderSnippets
}
