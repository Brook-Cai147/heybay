/**
 * M2-10 拒答边界与来源校验单测。
 *
 * 这两条是 PRD 5.4 的红线，且都属于"错了不会报错"的类型：
 *   拒答失效 → 模型给出签证/医疗判断，用户照着做，代价由用户承担
 *   来源失校 → 模型编一个 refId，答案看起来有出处其实没有，这比没有出处更糟
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  REFUSAL_KEYWORDS,
  OFFICIAL_CHANNEL,
  guard,
  sanitizeSources,
  attributionOf,
  isFabricated
} = require('../cloudfunctions/_shared/ai/answerGuard')
const { REFUSAL_REASON, REFUSAL_REASON_VALUES } = require('../cloudfunctions/_shared/schemas/searchKnowledge')

const snippet = (refId, overrides = {}) =>
  Object.assign({ refId, kind: 'preset', text: '语料原文', sourceRef: '人工预置' }, overrides)

test('四类问题一律拒答，且每类都给官方渠道（PRD 5.4）', () => {
  const cases = {
    [REFUSAL_REASON.VISA]: '我的学签快到期了怎么续签',
    [REFUSAL_REASON.IMMIGRATION]: '住满五年能申请永居吗',
    [REFUSAL_REASON.MEDICAL]: '这两天头疼该吃什么药',
    [REFUSAL_REASON.LEGAL]: '房东不退押金我能起诉他吗'
  }
  for (const [reason, question] of Object.entries(cases)) {
    const res = guard(question)
    assert.equal(res.refused, true, `${question} 应当被拦下`)
    assert.equal(res.reason, reason)
    assert.ok(res.answer.includes(OFFICIAL_CHANNEL[reason]), '拒答必须带官方渠道，不能只说"我不能回答"')
  }
})

test('拒答词表里的每一类都是 Schema 登记过的原因，不会出现前端认不出来的值', () => {
  for (const reason of Object.keys(REFUSAL_KEYWORDS)) {
    assert.ok(REFUSAL_REASON_VALUES.includes(reason), `${reason} 不在 Schema 白名单里`)
    assert.ok(OFFICIAL_CHANNEL[reason], `${reason} 缺官方渠道文案`)
  }
})

test('医疗只拦"求判断"，不拦"求流程"——否则语料库里的就医流程词条永远回不出来', () => {
  for (const question of ['怎么注册 GP', '半夜不舒服打哪个号', '看病要带什么材料']) {
    assert.equal(guard(question).refused, false, `${question} 是流程问题，不该被拦`)
  }
  for (const question of ['这个症状严重吗', '要不要去医院'] ) {
    assert.equal(guard(question).refused, true, `${question} 是要医疗判断，必须拦`)
  }
})

test('普通生活问题不被误拦', () => {
  for (const question of ['哪个超市便宜', '希思罗怎么进城', '手机被偷了怎么办', '中超在哪']) {
    assert.equal(guard(question).refused, false, question)
  }
})

test('拦截不区分大小写，英文写法也拦得住', () => {
  assert.equal(guard('My VISA is expiring').refused, true)
})

test('来源白名单：不在本次检索结果里的 refId 一律丢掉', () => {
  const snippets = [snippet('ldn-sim-01'), snippet('ldn-sim-02')]
  const res = sanitizeSources(
    [{ refId: 'ldn-sim-01' }, { refId: 'ldn-fake-99' }, { refId: '' }, null],
    snippets
  )
  assert.deepEqual(res.kept.map(item => item.refId), ['ldn-sim-01'])
  assert.equal(res.dropped.length, 3, '编的、空的、null 都要被丢掉并留痕')
})

test('保留下来的来源，kind 与出处取检索结果的值，不信模型自己填的', () => {
  const snippets = [snippet('ldn-post-01', { kind: 'post', sourceRef: '社区精华帖' })]
  const res = sanitizeSources([{ refId: 'ldn-post-01', kind: 'preset', excerpt: '模型摘的一句' }], snippets)
  assert.equal(res.kept[0].kind, 'post', 'kind 必须来自语料本身 —— 模型说它是预置也不算')
  assert.equal(res.kept[0].sourceRef, '社区精华帖')
  assert.equal(res.kept[0].excerpt, '模型摘的一句', '摘录允许用模型的，它只是展示文本')
})

test('摘录超长会被截断，避免整段语料回灌到端侧', () => {
  const long = '很长的语料'.repeat(50)
  const res = sanitizeSources([{ refId: 'a', excerpt: long }], [snippet('a')])
  assert.ok(res.kept[0].excerpt.length <= 120)
})

test('有语料、答案具体、却没有一条来源站得住 —— 按编造处理', () => {
  assert.equal(isFabricated({ data: { refused: false }, snippetCount: 3, keptCount: 0 }), true)
})

test('拒答不算编造：拒答本来就不需要来源', () => {
  assert.equal(isFabricated({ data: { refused: true }, snippetCount: 0, keptCount: 0 }), false)
})

test('本来就没检索到语料，模型老实说不知道，不算编造', () => {
  assert.equal(isFabricated({ data: { refused: false }, snippetCount: 0, keptCount: 0 }), false)
})

test('来源标注按 PRD 5.4 的口径给条数，没有来源时不写标注', () => {
  assert.equal(attributionOf('伦敦', 3), '根据伦敦小组 3 条历史回答整理，请自行核实。')
  assert.equal(attributionOf('伦敦', 0), '', '没来源就不要贴"根据 0 条"这种话')
})
