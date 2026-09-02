/**
 * M2-06 解析结果规范化单测。
 *
 * 这一层守的是两条产品红线，两条都是"错了不会报错"的类型：
 *   四类字段被 AI 代填 → 用户按错的金额/时间去赴约，代价由用户承担（PRD 5.4）
 *   自造品类混进库 → 广场筛选与后续统计全歪，且要等到数据脏了才发现（D-09）
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DRAFT_CONFIDENCE,
  NON_FORM_FIELDS,
  normalizeDraft,
  confidenceOf
} = require('../cloudfunctions/_shared/ai/parseDraft')
const {
  REQUEST_CATEGORY,
  TIMING_TYPE,
  INSTANT_DURATION,
  REWARD_TYPE,
  FIELD_SOURCE
} = require('../cloudfunctions/_shared/constants/enums')
const {
  USER_ONLY_FIELDS,
  PARSE_OUTPUT_FIELDS
} = require('../cloudfunctions/_shared/schemas/parseRequest')

/** 一份模型可能给出的解析结果 */
const modelOutput = (overrides = {}) =>
  Object.assign(
    {
      category: REQUEST_CATEGORY.COMPANION,
      title: '周末找搭子看球',
      detail: '想找个人一起去看球',
      timing: TIMING_TYPE.SCHEDULED,
      instantDuration: null,
      rewardType: REWARD_TYPE.FREE,
      headcount: null,
      amount: null,
      expectTime: null,
      area: null,
      contact: null,
      summary: '我理解你是想周末找人一起看球，对吗？',
      fieldSources: { category: FIELD_SOURCE.AI, title: FIELD_SOURCE.AI }
    },
    overrides
  )

test('四类字段一律抹空，不管模型标了什么来源（PRD 5.4 第一道防线）', () => {
  const res = normalizeDraft(
    modelOutput({
      amount: 50,
      expectTime: '周六下午三点',
      area: '国王十字车站',
      contact: '微信 abc123',
      // 模型甚至可能把它们标成 user 来蒙混过关
      fieldSources: { amount: FIELD_SOURCE.USER, expectTime: FIELD_SOURCE.USER }
    })
  )
  for (const field of USER_ONLY_FIELDS) {
    assert.equal(res.draft[field], null, `${field} 必须被抹空`)
    assert.equal(res.fieldSources[field], FIELD_SOURCE.EMPTY, `${field} 的来源必须是 empty`)
  }
})

test('来源标记按「最后有没有值」推断，不采信模型自报', () => {
  // 模型只标了 category / title，但实际给了 detail 与 rewardType
  const res = normalizeDraft(modelOutput())
  assert.equal(res.fieldSources.detail, FIELD_SOURCE.AI, '有值就该标 ai，哪怕模型没标')
  assert.equal(res.fieldSources.rewardType, FIELD_SOURCE.AI)
  assert.equal(res.fieldSources.headcount, FIELD_SOURCE.EMPTY, '没值就该标 empty')
})

test('每个输出字段都有来源标记，端侧不会读到 undefined', () => {
  const res = normalizeDraft(modelOutput())
  for (const field of PARSE_OUTPUT_FIELDS) {
    assert.ok(field in res.draft, `draft 缺字段 ${field}`)
    assert.ok(field in res.fieldSources, `fieldSources 缺标记 ${field}`)
  }
})

test('归不进 8 类白名单就明确返回无法归类，绝不自造品类（D-09）', () => {
  const res = normalizeDraft(modelOutput({ category: 'dating' }))
  assert.equal(res.unclassified, true)
  assert.equal(res.draft.category, null)
  assert.equal(res.fieldSources.category, FIELD_SOURCE.EMPTY)
  assert.ok(res.hint.length > 0, '必须告诉用户下一步怎么做，而不是只报一句失败')
  assert.equal(res.confidence, DRAFT_CONFIDENCE.LOW)
})

test('空字符串与缺字段都算留空', () => {
  const res = normalizeDraft(modelOutput({ detail: '   ', summary: undefined }))
  assert.equal(res.draft.detail, null)
  assert.equal(res.draft.summary, null)
  assert.equal(res.fieldSources.detail, FIELD_SOURCE.EMPTY)
})

test('置信度：核心三项齐全为 high，缺时效为 medium，归不了类为 low', () => {
  assert.equal(normalizeDraft(modelOutput()).confidence, DRAFT_CONFIDENCE.HIGH)
  assert.equal(normalizeDraft(modelOutput({ timing: null })).confidence, DRAFT_CONFIDENCE.MEDIUM)
  assert.equal(normalizeDraft(modelOutput({ title: '' })).confidence, DRAFT_CONFIDENCE.LOW)
})

test('即时型缺时长算 medium：时长猜错会直接决定单子什么时候过期', () => {
  const res = normalizeDraft(modelOutput({ timing: TIMING_TYPE.INSTANT, instantDuration: null }))
  assert.equal(res.confidence, DRAFT_CONFIDENCE.MEDIUM)
  assert.equal(res.draft.instantDuration, null, '不替用户猜一个档位')
  const complete = normalizeDraft(
    modelOutput({ timing: TIMING_TYPE.INSTANT, instantDuration: INSTANT_DURATION.H3 })
  )
  assert.equal(complete.confidence, DRAFT_CONFIDENCE.HIGH)
})

test('aiFilledFields 是采纳率的分母：只数 AI 真给了建议的字段', () => {
  const res = normalizeDraft(modelOutput())
  assert.ok(res.aiFilledFields.includes('category'))
  assert.ok(res.aiFilledFields.includes('title'))
  for (const field of USER_ONLY_FIELDS) {
    assert.ok(!res.aiFilledFields.includes(field), `${field} 永远不该进分母`)
  }
})

test('summary 不进分母：表单里没这一项，用户永远改不到它，算进去会白送采纳率', () => {
  const res = normalizeDraft(modelOutput())
  assert.equal(res.draft.summary.length > 0, true, 'summary 本身要保留，卡片上要展示')
  assert.ok(!res.aiFilledFields.includes('summary'))
  for (const field of NON_FORM_FIELDS) {
    assert.ok(!res.aiFilledFields.includes(field), `${field} 不该进分母`)
  }
})

test('空输入不抛错，返回一份全空草稿（模型偶尔什么都不给）', () => {
  const res = normalizeDraft({})
  assert.equal(res.unclassified, true)
  assert.equal(res.confidence, DRAFT_CONFIDENCE.LOW)
  assert.deepEqual(res.aiFilledFields, [])
  assert.equal(confidenceOf({}, true), DRAFT_CONFIDENCE.LOW)
})
