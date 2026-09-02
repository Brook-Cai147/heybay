/**
 * 拒答边界与来源校验（M2-10 的纯逻辑部分）。不碰数据库、不调模型，因此可单测。
 *
 * **对计划的一处拆分**：M2-10 只列了 `service/fallbackAnswerService.js`。但这两条是产品红线，
 * 必须有单测；而 service 一旦 require dao 就连带 require `wx-server-sdk`，本地跑不起来。
 * 同 `ai/knowledgeRank.js` 的处理方式。
 *
 * 两条红线：
 *   拒答（PRD 5.4）—— 签证、医疗、法律、移民不给判断，**在服务端用关键词前置拦截**，
 *   不依赖模型自觉。模型偶尔会"好心"回答签证问题，而这类回答错了，代价是用户的签证。
 *   误拦一些无害问题可以接受，反方向不行。
 *
 *   来源白名单 —— Prompt 已经要求"只依据语料作答"，但模型可以编一个看起来很像的 refId。
 *   凡是不在本次检索结果里的来源一律丢掉。
 */

const { REFUSAL_REASON } = require('../schemas/searchKnowledge')

/**
 * 拒答词表。
 *
 * **医疗一类只拦"求医疗判断"，不拦"求就医流程"**：问「怎么注册 GP」「急诊打哪个号」
 * 是本地生活常识，恰恰是这个产品该回答的；问「我该吃什么药」「这个症状严重吗」才是医疗建议。
 * 语料库里那两条 health 词条属于前者，与这份词表不冲突（见 data/londonKnowledge.js 头注释）。
 */
const REFUSAL_KEYWORDS = Object.freeze({
  [REFUSAL_REASON.VISA]: [
    '签证', 'visa', '拒签', '续签', '工签', '学签', '陪读签', '探亲签', '滞留'
  ],
  [REFUSAL_REASON.IMMIGRATION]: [
    '移民', '永居', '入籍', '国籍', 'ilr', '难民', '庇护', '居留权', '身份转换'
  ],
  [REFUSAL_REASON.MEDICAL]: [
    '吃什么药', '该吃', '用什么药', '剂量', '副作用', '症状', '诊断', '严重吗', '是不是得了',
    '要不要去医院', '怀孕', '流产', '抑郁', '化验', '验血', '肿瘤', '开刀', '手术'
  ],
  [REFUSAL_REASON.LEGAL]: [
    '起诉', '打官司', '律师函', '违法吗', '判几年', '赔偿标准', '仲裁', '合同纠纷', '被辞退能'
  ]
})

/** 拒答时给的官方渠道（PRD 5.4 要求"给官方渠道 + 请咨询专业机构"，不能只说"我不能回答"） */
const OFFICIAL_CHANNEL = Object.freeze({
  [REFUSAL_REASON.VISA]:
    '签证问题请查 GOV.UK 官网（gov.uk/browse/visas-immigration），或咨询 OISC 注册的持牌移民顾问。',
  [REFUSAL_REASON.IMMIGRATION]:
    '移民与身份问题请查 GOV.UK 官网，或咨询 OISC 注册的持牌移民顾问。',
  [REFUSAL_REASON.MEDICAL]:
    '身体不适请打 NHS 111 咨询，紧急情况打 999；常规问题找你注册的 GP。',
  [REFUSAL_REASON.LEGAL]:
    '法律问题请找持业律师，或先咨询免费的 Citizens Advice（citizensadvice.org.uk）。'
})

const REFUSAL_PREFIX = Object.freeze({
  [REFUSAL_REASON.VISA]: '签证这类问题我不能给判断',
  [REFUSAL_REASON.IMMIGRATION]: '移民与身份这类问题我不能给判断',
  [REFUSAL_REASON.MEDICAL]: '医疗问题我不能给判断',
  [REFUSAL_REASON.LEGAL]: '法律问题我不能给判断'
})

/**
 * 前置拦截。
 * @returns {{refused: boolean, reason: string|null, hit: string, answer: string}}
 */
const guard = question => {
  const raw = String(question || '').toLowerCase()
  for (const [reason, words] of Object.entries(REFUSAL_KEYWORDS)) {
    const hit = words.find(word => raw.includes(word))
    if (hit) {
      return {
        refused: true,
        reason,
        hit,
        answer: `${REFUSAL_PREFIX[reason]}——答错的代价太大，这里不猜。${OFFICIAL_CHANNEL[reason]}`
      }
    }
  }
  return { refused: false, reason: null, hit: '', answer: '' }
}

/**
 * 来源白名单：只保留本次检索真实给出的 refId。
 * @returns {{kept: object[], dropped: string[]}}
 */
const sanitizeSources = (sources, snippets = []) => {
  const allowed = new Map(snippets.map(item => [item.refId, item]))
  const kept = []
  const dropped = []
  for (const item of Array.isArray(sources) ? sources : []) {
    const refId = item && item.refId
    if (refId && allowed.has(refId)) {
      const snippet = allowed.get(refId)
      kept.push({
        refId,
        kind: snippet.kind,
        excerpt: String((item && item.excerpt) || snippet.text || '').slice(0, 120),
        sourceRef: snippet.sourceRef || ''
      })
      continue
    }
    dropped.push(String(refId || '(空)'))
  }
  return { kept, dropped }
}

/** PRD 5.4 的来源标注文案：「根据伦敦小组 3 条历史回答，请自行核实」 */
const attributionOf = (cityName, count) =>
  count ? `根据${cityName || '本地'}小组 ${count} 条历史回答整理，请自行核实。` : ''

/**
 * 有语料、模型也给了具体答案，但没有一条来源站得住 —— 按编造处理（PRD 5.4）。
 * 拒答不算编造：拒答本来就不需要来源。
 */
const isFabricated = ({ data = {}, snippetCount = 0, keptCount = 0 }) =>
  data.refused !== true && snippetCount > 0 && keptCount === 0

module.exports = {
  REFUSAL_KEYWORDS,
  OFFICIAL_CHANNEL,
  REFUSAL_PREFIX,
  guard,
  sanitizeSources,
  attributionOf,
  isFabricated
}
