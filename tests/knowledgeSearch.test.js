/**
 * M2-09 语料检索打分单测。
 *
 * 这一层守的是兜底作答的入口质量。两类错都不会报错，只会让答案变差：
 *   该命中的没命中 → 明明有语料却回"站里还没人聊过"，用户以为功能坏了
 *   不该命中的命中了 → 一堆不相关语料进上下文，模型会从里面硬凑一个答案（PRD 5.4 禁止编造）
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  WEIGHTS,
  MIN_SCORE,
  RELATIVE_FLOOR,
  TOP_N,
  SOURCE_KIND,
  TAG_VALUES,
  tokenize,
  inferTags,
  scoreDoc,
  rankCandidates
} = require('../cloudfunctions/_shared/ai/knowledgeRank')
const { LONDON_SEEDS } = require('../cloudfunctions/_shared/data/londonKnowledge')

const doc = (overrides = {}) =>
  Object.assign(
    {
      refId: 'ldn-test-01',
      city: 'london',
      tags: ['sim'],
      question: '刚到伦敦怎么办电话卡？',
      answer: '买运营商的月付 SIM 卡，开通要护照信息。',
      sourceKind: SOURCE_KIND.PRESET,
      sourceRef: '人工预置'
    },
    overrides
  )

test('切词：中文按 2-gram、英文数字按整词', () => {
  const tokens = tokenize('NHS 111 电话卡')
  assert.ok(tokens.has('nhs'), '英文整词')
  assert.ok(tokens.has('111'), '数字整词')
  assert.ok(tokens.has('电话'), '中文 2-gram')
  assert.ok(tokens.has('话卡'), '中文 2-gram 滑窗')
  assert.ok(!tokens.has('电'), '单字不进词表，太容易撞')
})

test('停用词：疑问词与「伦敦」不参与打分，否则任意两句话都能互相命中', () => {
  const tokens = tokenize('在伦敦怎么办这个')
  for (const gram of ['怎么', '伦敦', '这个']) {
    assert.ok(!tokens.has(gram), `${gram} 应当被停用`)
  }
})

test('标签推断：命中词典就出标签，认不出来给空数组而不是报错', () => {
  assert.deepEqual(inferTags('哪里能买电话卡'), ['sim'])
  assert.deepEqual(inferTags('今天天气怎么样'), [])
  for (const tag of inferTags('落地希思罗怎么坐地铁进城')) {
    assert.ok(TAG_VALUES.includes(tag), `${tag} 必须是词典里登记过的标签`)
  }
})

test('权重生效：标签命中比答案字词重合值钱，明细要能对上总分', () => {
  const queryTokens = tokenize('电话卡怎么办')
  const res = scoreDoc(doc(), { queryTokens, tags: ['sim'] })
  const { tagHits, questionHits, answerHits, presetBonus } = res.matched
  const expected =
    tagHits * WEIGHTS.TAG_HIT +
    questionHits * WEIGHTS.QUESTION_GRAM +
    answerHits * WEIGHTS.ANSWER_GRAM +
    presetBonus * WEIGHTS.PRESET_BONUS
  assert.equal(res.score, expected, '总分必须等于明细按权重加总 —— 明细是给人看"为什么命中"的依据')
  assert.equal(tagHits, 1)
})

test('人工预置有可靠度加成，同分时也排在用户沉淀语料前面', () => {
  const queryTokens = tokenize('电话卡')
  const asPreset = scoreDoc(doc(), { queryTokens, tags: [] })
  const asPost = scoreDoc(doc({ sourceKind: SOURCE_KIND.POST }), { queryTokens, tags: [] })
  assert.equal(asPreset.score - asPost.score, WEIGHTS.PRESET_BONUS)
})

test('语料外的问题一条都不给：宁可说不知道，也不要塞低分语料诱导模型编造', () => {
  const res = rankCandidates({ candidates: LONDON_SEEDS, question: '伦敦有推荐的川菜馆吗' })
  assert.equal(res.snippets.length, 0, '语料里没有餐厅推荐，就该空手而归')
})

test('入选门槛：只靠「是人工预置」这一项不足以进上下文', () => {
  const onlyBonus = scoreDoc(doc({ question: '××', answer: '××', tags: [] }), {
    queryTokens: tokenize('完全不相干的问题'),
    tags: []
  })
  assert.equal(onlyBonus.score, WEIGHTS.PRESET_BONUS)
  assert.ok(onlyBonus.score < MIN_SCORE, 'presetBonus 单独不够门槛')
})

test('相对门槛：与最佳命中差一半以上的被丢掉，Top 5 是上限不是配额', () => {
  const candidates = [
    doc({ refId: 'a', question: '刚到伦敦怎么办电话卡？' }),
    doc({ refId: 'b', tags: ['grocery'], question: '哪个超市便宜', answer: 'Lidl 和 Aldi 便宜。' })
  ]
  const res = rankCandidates({ candidates, question: '刚到伦敦怎么办电话卡' })
  assert.equal(res.snippets.length, 1, '不相干的那条不该为了凑数被带上')
  assert.equal(res.snippets[0].refId, 'a')
  assert.ok(RELATIVE_FLOOR > 0 && RELATIVE_FLOOR < 1)
})

test('检索结果必须带来源引用：没有 refId 与 kind，PRD 5.4 的来源标注就无从谈起', () => {
  const res = rankCandidates({ candidates: LONDON_SEEDS, question: '希思罗机场怎么去市区' })
  assert.ok(res.snippets.length > 0)
  assert.ok(res.snippets.length <= TOP_N)
  for (const item of res.snippets) {
    assert.ok(item.refId, 'refId 必须有')
    assert.ok(['request', 'post', 'preset'].includes(item.kind), 'kind 必须在 Schema 白名单内')
    assert.ok(item.text && item.text.length > 0, '要有正文供模型引用')
  }
})

test('排序稳定：同一批候选同一个问题，两次检索结果完全一致', () => {
  const first = rankCandidates({ candidates: LONDON_SEEDS, question: '手机被偷了怎么办' })
  const second = rankCandidates({ candidates: LONDON_SEEDS.slice().reverse(), question: '手机被偷了怎么办' })
  assert.deepEqual(
    first.snippets.map(item => item.refId),
    second.snippets.map(item => item.refId),
    '候选顺序变了结果不该变 —— 否则同一个问题今天一个答案明天另一个'
  )
})

test('语料自身规范：refId 唯一、标签在词典内、答案不为空', () => {
  const seen = new Set()
  for (const item of LONDON_SEEDS) {
    assert.ok(!seen.has(item.refId), `refId 重复：${item.refId}`)
    seen.add(item.refId)
    assert.equal(item.city, 'london')
    assert.ok(item.question && item.answer, `${item.refId} 问答都不能空`)
    assert.ok(['preset', 'request', 'post'].includes(item.sourceKind), `${item.refId} 来源类型不对`)
    for (const tag of item.tags) {
      assert.ok(TAG_VALUES.includes(tag), `${item.refId} 用了词典里没有的标签 ${tag}，永远检索不到`)
    }
  }
  assert.ok(LONDON_SEEDS.length >= 20, '最小语料集按计划是 20~30 条')
  assert.ok(LONDON_SEEDS.length <= 30, '完整语料库属 M4，别在 M2 堆内容')
})
