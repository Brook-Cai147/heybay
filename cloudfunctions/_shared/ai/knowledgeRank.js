/**
 * 站内语料的**打分与排序**（M2-09）。纯函数，不碰数据库 —— 查询在 `service/knowledgeSearch.js`。
 *
 * **对计划的一处拆分**：M2-09 只列了 `dao/knowledge.js` 与 `service/knowledgeSearch.js`。
 * 但打分规则是这一步唯一需要单测的东西，而 service 一旦 require dao 就连带 require
 * `wx-server-sdk`，本地 `node:test` 直接跑不起来（M2 的其它纯逻辑 `ai/parseDraft.js`、
 * `ai/cache.js` 都是同一个原因放在 `ai/` 下）。所以打分留在这里，service 只做查询与拼装。
 *
 * 为什么不上向量库（tech-stack 6.2）：单城语料只有几十条，关键词 + 标签就能把 Top 5 找对；
 * 向量库要多一个外部服务、多一份 embedding 成本，在这个量级纯属过度设计。
 *
 * **升级点**：单城语料 > 2000 条，或兜底采纳率 < 50%（PRD 5.5 的指标）时切向量检索。
 * 届时只换 `scoreDoc` 与 `rankCandidates` 的内部实现 —— 对外契约（带 refId 的 snippets）
 * 是照着"以后要换检索方式"设计的，`fallbackAnswerService` 不用改。
 *
 * 打分规则**显式写成权重表**而不是一个综合公式：命中不合理时，要能一眼看出是哪一项加错了分。
 */

/** 打分权重。改这里就是改检索行为，改完请重跑 tests/knowledgeSearch.test.js */
const WEIGHTS = Object.freeze({
  /** 标签命中：问"换电话卡"命中 `sim` 标签，比零散字词重合可靠得多 */
  TAG_HIT: 3,
  /** 问题文本重合：语料的「问题」字段与用户问法撞上，说明问的是同一件事 */
  QUESTION_GRAM: 2,
  /** 答案文本重合：弱信号 —— 答案长，撞上几个字很容易 */
  ANSWER_GRAM: 1,
  /** 人工预置语料的可靠度加成：它是编辑过的，比用户帖子沉淀的更可信 */
  PRESET_BONUS: 1
})

/** 单条语料在文本重合上最多拿多少次命中，防止长文档靠字数堆分 */
const GRAM_HIT_CAP = 5

/**
 * 两道入选门槛。没有它们，"随便问一句"也能凑出 5 条低分语料塞进上下文，
 * 而模型看到语料就会努力从里面凑答案 —— 这正是 PRD 5.4 要禁的编造。
 *
 * MIN_SCORE 的含义：光靠"是人工预置"（presetBonus=1）或一次零散的答案字词重合不算命中，
 * 至少要有**一次标签命中**（3+1）或**两处问题文本重合**（2×2）才有资格进上下文。
 */
const MIN_SCORE = 4

/** 与最佳命中差一半以上的直接丢掉：Top 5 是上限不是配额，凑数比少给更糟 */
const RELATIVE_FLOOR = 0.5

/**
 * 停用词（2-gram）。疑问词与口头语在每句话里都有，留着会让"怎么去机场"和
 * "怎么办电话卡"因为共有"怎么"而互相命中。`伦敦` 也在列：M1 只开一座城，
 * 它对区分语料没有任何信息量。
 */
const STOP_GRAMS = Object.freeze(new Set([
  '怎么', '么办', '什么', '为什', '哪里', '哪个', '哪些', '如何', '可以', '需要',
  '一下', '有没', '没有', '是不', '不是', '的话', '这个', '那个', '应该', '知道',
  '想问', '请问', '一个', '还是', '伦敦'
]))


/** 返回给模型的语料条数（PRD 5.4 的「根据 N 条历史回答」就是这个 N） */
const TOP_N = 5

/** 语料来源类型，与 `schemas/searchKnowledge.js` 的 `sources[].kind` 白名单一致 */
const SOURCE_KIND = Object.freeze({
  PRESET: 'preset',     // 人工预置
  REQUEST: 'request',   // 过期需求单沉淀
  POST: 'post'          // 社区精华帖
})

const SOURCE_KIND_VALUES = Object.freeze(Object.values(SOURCE_KIND))

/**
 * 标签词典：标签 → 触发它的说法。
 *
 * 这份词典是"用户怎么问"到"语料怎么标"之间的唯一映射。放在代码里而不是数据库里，
 * 是因为它要跟着语料一起被单测覆盖 —— 词典写漏了会表现成"明明有语料却查不到"，
 * 这种故障在没有单测时只能靠人肉试出来。
 */
const TAG_KEYWORDS = Object.freeze({
  sim: ['电话卡', '手机卡', 'sim', '流量', '套餐', '号码', '充值'],
  transport: ['地铁', '公交', '巴士', 'tube', 'oyster', '交通卡', '打车', '火车', '通勤'],
  airport: ['机场', '希思罗', 'heathrow', 'gatwick', '盖特威克', '落地', '接机', '航班'],
  tax_refund: ['退税', 'vat', '免税', 'refund'],
  health: ['看病', '看医生', 'gp', 'nhs', '挂号', '药店', '急诊', '生病', '不舒服'],
  safety: ['报警', '警察', '被偷', '被抢', '丢了', '诈骗', '骗子', '999', '安全'],
  grocery: ['超市', '买菜', '便宜', '中超', 'tesco', 'lidl', 'aldi', '亚超', '食材'],
  housing: ['租房', '房子', '押金', '合同', '中介', '房东', '看房'],
  bank: ['银行', '开户', '账户', '汇款', '转账', '信用卡'],
  sightseeing: ['景点', '博物馆', '门票', '打卡', '游览', '参观'],
  food: ['餐厅', '吃饭', '外卖', '小吃', '中餐', '点菜'],
  document: ['证件', '护照', 'brp', '注册', '地址证明', '预约', '签证信']
})

const TAG_VALUES = Object.freeze(Object.keys(TAG_KEYWORDS))

/**
 * 切词。中文没有空格，按 **2-gram** 切：单字太容易撞（"的""在"都能命中），
 * 3-gram 又会让"换电话卡"和"电话卡怎么换"对不上。
 * 英文与数字按整词切，因为 `oyster`、`nhs`、`999` 这类词整体才有意义。
 */
const tokenize = text => {
  const raw = String(text || '').toLowerCase()
  const tokens = new Set()
  for (const word of raw.match(/[a-z0-9]+/g) || []) tokens.add(word)
  for (const run of raw.match(/[\u4e00-\u9fa5]+/g) || []) {
    const chars = Array.from(run)
    if (chars.length === 1) {
      tokens.add(run)
      continue
    }
    for (let i = 0; i + 2 <= chars.length; i++) {
      const gram = chars.slice(i, i + 2).join('')
      if (!STOP_GRAMS.has(gram)) tokens.add(gram)
    }
  }
  return tokens
}

/** 从问题里推断标签。推断不出来返回空数组，检索退化成全城候选 + 文本打分 */
const inferTags = question => {
  const raw = String(question || '').toLowerCase()
  return TAG_VALUES.filter(tag => TAG_KEYWORDS[tag].some(word => raw.includes(word)))
}

/** 查询词与一段文本的重合命中数，上限 GRAM_HIT_CAP */
const overlapHits = (queryTokens, text) => {
  const docTokens = tokenize(text)
  let hits = 0
  for (const token of queryTokens) {
    if (docTokens.has(token)) hits += 1
  }
  return Math.min(hits, GRAM_HIT_CAP)
}

/**
 * 给一条语料打分。返回**得分 + 明细**：明细就是"为什么命中"，
 * 验证检索是否合理时看的是明细，不是总分。
 */
const scoreDoc = (doc, { queryTokens, tags = [] }) => {
  const docTags = Array.isArray(doc.tags) ? doc.tags : []
  const hitTags = tags.filter(tag => docTags.includes(tag))
  const questionHits = overlapHits(queryTokens, doc.question)
  const answerHits = overlapHits(queryTokens, doc.answer)
  const presetBonus = doc.sourceKind === SOURCE_KIND.PRESET ? 1 : 0

  const score =
    hitTags.length * WEIGHTS.TAG_HIT +
    questionHits * WEIGHTS.QUESTION_GRAM +
    answerHits * WEIGHTS.ANSWER_GRAM +
    presetBonus * WEIGHTS.PRESET_BONUS

  return {
    score,
    matched: { tagHits: hitTags.length, tags: hitTags, questionHits, answerHits, presetBonus }
  }
}

/** 排序：得分降序 → 人工预置优先 → refId 字典序（同分时结果稳定可复现） */
const rank = items =>
  items.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.sourceKind !== b.sourceKind) {
      if (a.sourceKind === SOURCE_KIND.PRESET) return -1
      if (b.sourceKind === SOURCE_KIND.PRESET) return 1
    }
    return String(a.refId).localeCompare(String(b.refId))
  })

/**
 * 给定候选与问题，算出 Top N。
 *
 * @returns {{tags: string[], snippets: object[]}} snippets 已经是喂给模型的形状
 */
const rankCandidates = ({ candidates = [], question, limit = TOP_N }) => {
  const queryTokens = tokenize(question)
  const tags = inferTags(question)

  const scored = candidates
    .map(doc => {
      const { score, matched } = scoreDoc(doc, { queryTokens, tags })
      return {
        refId: doc.refId,
        kind: doc.sourceKind,
        sourceKind: doc.sourceKind,
        question: doc.question,
        text: doc.answer,
        sourceRef: doc.sourceRef || '',
        score,
        matched
      }
    })
    // 0 分的一条都不给：宁可让模型看到"没有语料"，也不要塞一堆不相关的东西进上下文 ——
    // 那会诱导它从不相关语料里硬凑一个答案（PRD 5.4 禁止编造）
    .filter(item => item.score >= MIN_SCORE)

  const ranked = rank(scored)
  const best = ranked.length ? ranked[0].score : 0
  const floor = best * RELATIVE_FLOOR

  return { tags, snippets: ranked.filter(item => item.score >= floor).slice(0, limit) }
}

module.exports = {
  WEIGHTS,
  GRAM_HIT_CAP,
  MIN_SCORE,
  RELATIVE_FLOOR,
  STOP_GRAMS,
  TOP_N,
  SOURCE_KIND,
  SOURCE_KIND_VALUES,
  TAG_KEYWORDS,
  TAG_VALUES,
  tokenize,
  inferTags,
  overlapHits,
  scoreDoc,
  rankCandidates
}
