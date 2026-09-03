/**
 * AI 输出 Schema 校验器与降级判定单测（M2-02）。
 *
 * 这块是 D-15「给 AI 失败留退路」的判定依据：校验失效 → 脏数据直接进需求单；
 * 降级判定写错 → 要么死循环重试烧钱，要么该重试的时候直接放弃。两种都不会报错。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  REQUEST_CATEGORY,
  TIMING_TYPE,
  REWARD_TYPE,
  FIELD_SOURCE
} = require('../cloudfunctions/_shared/constants/enums')
const {
  VALIDATION_CODE,
  FALLBACK_DECISION,
  MAX_RETRIES,
  validate,
  decideFallback
} = require('../cloudfunctions/_shared/service/aiSchemaValidator')
const {
  parseRequestSchema,
  USER_ONLY_FIELDS
} = require('../cloudfunctions/_shared/schemas/parseRequest')
const {
  searchKnowledgeSchema,
  REFUSAL_REASON
} = require('../cloudfunctions/_shared/schemas/searchKnowledge')
const { schemaOf } = require('../cloudfunctions/_shared/schemas')
const { AI_CAPABILITY } = require('../cloudfunctions/_shared/constants/aiCapabilities')
const { USER_ONLY_FIELDS: VALIDATOR_USER_ONLY } =
  require('../cloudfunctions/_shared/service/requestValidator')

/** 一份合法的解析结果，各用例在此基础上改坏一处 */
const validParse = () => ({
  category: REQUEST_CATEGORY.COMPANION,
  title: '找人一起逛大英博物馆',
  detail: '9 月 12 号上午，中文交流就行',
  timing: TIMING_TYPE.SCHEDULED,
  rewardType: REWARD_TYPE.FREE,
  fieldSources: {
    category: FIELD_SOURCE.AI,
    title: FIELD_SOURCE.AI,
    amount: FIELD_SOURCE.EMPTY,
    expectTime: FIELD_SOURCE.EMPTY,
    area: FIELD_SOURCE.EMPTY,
    contact: FIELD_SOURCE.EMPTY
  },
  summary: '我理解成：找人一起逛博物馆，免费互助'
})

test('合法的解析结果通过校验，并回一份干净对象', () => {
  const res = validate(parseRequestSchema, validParse())
  assert.equal(res.valid, true, JSON.stringify(res.errors))
  assert.equal(res.errors.length, 0)
  assert.equal(res.value.category, REQUEST_CATEGORY.COMPANION)
})

test('AI 试图填金额被拒（PRD 5.4 四类字段禁止代填）', () => {
  for (const field of USER_ONLY_FIELDS) {
    const output = validParse()
    output.fieldSources[field] = FIELD_SOURCE.AI
    output[field] = field === 'amount' ? 80 : '模型自己编的值'

    const res = validate(parseRequestSchema, output)
    assert.equal(res.valid, false, `${field} 被 AI 填了却通过了校验`)
    assert.ok(
      res.errors.some(e => e.code === VALIDATION_CODE.AI_FIELD_FORBIDDEN && e.path === field),
      `${field} 应报 AI_FIELD_FORBIDDEN`
    )
    assert.equal(res.value, null, '校验没过就不该回值')
  }
})

test('四类字段标了 ai 但留空是允许的（模型正确地放弃了）', () => {
  const output = validParse()
  for (const field of USER_ONLY_FIELDS) output.fieldSources[field] = FIELD_SOURCE.AI
  const res = validate(parseRequestSchema, output)
  assert.equal(res.valid, true, '标了 ai 而没有值，说明模型守规矩，不该拒')
})

test('Schema 的 userOnlyFields 与服务端校验的清单必须一致', () => {
  assert.deepEqual([...USER_ONLY_FIELDS], [...VALIDATOR_USER_ONLY])
  assert.deepEqual([...parseRequestSchema.userOnlyFields], [...VALIDATOR_USER_ONLY])
})

test('枚举值不在白名单被拒（模型编了一个不存在的品类）', () => {
  const output = validParse()
  output.category = 'dating' // 明确不做的品类，模型不该也不能输出
  const res = validate(parseRequestSchema, output)
  assert.equal(res.valid, false)
  assert.ok(res.errors.some(e => e.code === VALIDATION_CODE.ENUM && e.path === 'category'))
})

test('必填缺失、类型不对、超长都能被指到具体字段', () => {
  const missing = validate(parseRequestSchema, { category: 'companion' })
  assert.equal(missing.valid, false)
  assert.ok(missing.errors.some(e => e.code === VALIDATION_CODE.REQUIRED && e.path === 'title'))

  const wrongType = validParse()
  wrongType.headcount = '两个人'
  const typeRes = validate(parseRequestSchema, wrongType)
  assert.ok(typeRes.errors.some(e => e.code === VALIDATION_CODE.TYPE && e.path === 'headcount'))

  const tooLong = validParse()
  tooLong.title = '一'.repeat(21)
  const longRes = validate(parseRequestSchema, tooLong)
  assert.ok(longRes.errors.some(e => e.code === VALIDATION_CODE.TOO_LONG && e.path === 'title'))
})

/**
 * M2-15 首轮评测暴露的设计矛盾：Prompt 要求"归不进 8 类就把 category 留空"，
 * 而 Schema 曾把 category 设成必填 —— 于是老实留空的那条被判"必填字段缺失"整条作废，
 * 另一条为了满足必填硬塞了品类。**用 Schema 逼模型硬塞品类，正是 D-09 最怕的事。**
 */
test('归不进品类时 category 留空是合法输出，不是校验失败（D-09）', () => {
  const unclassified = Object.assign(validParse(), {
    category: null,
    title: '想找人一起吃饭聊天',
    summary: '这条我没法归进现有分类'
  })
  const res = validate(parseRequestSchema, unclassified)
  assert.equal(res.valid, true, JSON.stringify(res.errors))
  assert.equal(res.value.category, null)

  // 空字符串是「留空」的第三种写法，同样要认
  const emptyString = Object.assign(validParse(), { category: '' })
  assert.equal(validate(parseRequestSchema, emptyString).valid, true)

  // 但白名单外的值仍然要拒 —— 留空可以，自造品类不行
  const invented = Object.assign(validParse(), { category: 'dating' })
  const inventedRes = validate(parseRequestSchema, invented)
  assert.equal(inventedRes.valid, false)
  assert.ok(inventedRes.errors.some(e => e.path === 'category' && e.code === VALIDATION_CODE.ENUM))
})

test('多余字段不算错，只记 warning 并从结果里剥掉', () => {
  const output = validParse()
  output.confidence = 0.87 // 模型自作多情加的字段
  output.内心想法 = '这人应该是学生'

  const res = validate(parseRequestSchema, output)
  assert.equal(res.valid, true, '多余字段不该让整条解析作废（降级的代价更大）')
  assert.equal(res.warnings.length, 2)
  assert.equal(res.value.confidence, undefined, '未声明字段必须被剥掉，不能流进需求单')
  assert.equal(res.value.内心想法, undefined)
})

test('非对象输出直接判失败，不抛异常', () => {
  for (const bad of [null, undefined, '一段自然语言', 42, ['a'], true]) {
    const res = validate(parseRequestSchema, bad)
    assert.equal(res.valid, false)
    assert.equal(res.errors[0].code, VALIDATION_CODE.NOT_AN_OBJECT)
  }
  assert.equal(validate(null, validParse()).valid, false)
})

test('searchKnowledge：来源必填，没有来源的答案不许通过（PRD 5.4 来源标注）', () => {
  const noSources = { answer: '伦敦地铁可以用手机刷', refused: false }
  const res = validate(searchKnowledgeSchema, noSources)
  assert.equal(res.valid, false)
  assert.ok(res.errors.some(e => e.code === VALIDATION_CODE.REQUIRED && e.path === 'sources'))

  // 空数组是合法的：表示确实没查到，端侧据此显示"没查到相关经验"
  const empty = validate(searchKnowledgeSchema, { answer: '没查到', refused: false, sources: [] })
  assert.equal(empty.valid, true)
})

test('searchKnowledge：拒答是一种合法输出，而不是一次失败', () => {
  const refusal = {
    answer: '签证问题我不能给建议，请咨询官方渠道',
    refused: true,
    refusalReason: REFUSAL_REASON.VISA,
    sources: []
  }
  const res = validate(searchKnowledgeSchema, refusal)
  assert.equal(res.valid, true, '正确拒答不该被当成模型故障而触发重试')
  assert.equal(res.value.refused, true)
})

test('searchKnowledge：来源列表里的每一项也逐字段校验', () => {
  const res = validate(searchKnowledgeSchema, {
    answer: '有人问过',
    refused: false,
    sources: [{ refId: 'abc', kind: 'request' }, { kind: '小组帖子' }]
  })
  assert.equal(res.valid, false)
  assert.ok(res.errors.some(e => e.path === 'sources[1].refId' && e.code === VALIDATION_CODE.REQUIRED))
  assert.ok(res.errors.some(e => e.path === 'sources[1].kind' && e.code === VALIDATION_CODE.ENUM))
})

test('降级判定：通过就过，第一次失败重试，重试后仍失败才降级', () => {
  assert.equal(decideFallback({ valid: true, attempt: 1 }).decision, FALLBACK_DECISION.PASS)

  const first = decideFallback({
    valid: false,
    attempt: 1,
    errors: [{ path: 'category', message: '取值不在白名单内' }]
  })
  assert.equal(first.decision, FALLBACK_DECISION.RETRY)
  assert.equal(first.nextAttempt, 2)
  assert.ok(first.retryHint.includes('category'), '重试时要把错在哪告诉模型')

  const second = decideFallback({ valid: false, attempt: 2 })
  assert.equal(second.decision, FALLBACK_DECISION.FALLBACK)
  assert.equal(second.reasonCode, 'schema_invalid_after_retry')
  assert.ok(second.message.length > 0, '降级信号必须带人话提示，端侧要直接展示')
})

test('降级判定绝不给出第三次机会（不做死循环）', () => {
  assert.equal(MAX_RETRIES, 1)
  for (const attempt of [2, 3, 10]) {
    assert.equal(
      decideFallback({ valid: false, attempt }).decision,
      FALLBACK_DECISION.FALLBACK,
      `第 ${attempt} 次尝试后只能降级`
    )
  }
})

test('Schema 汇总表：注册表里已实现的能力都能取到 Schema，未实现的取到 null', () => {
  assert.equal(schemaOf(AI_CAPABILITY.PARSE_REQUEST), parseRequestSchema)
  assert.equal(schemaOf(AI_CAPABILITY.SEARCH_KNOWLEDGE), searchKnowledgeSchema)
  assert.ok(schemaOf(AI_CAPABILITY.GENERATE_CHECKLIST), 'M2-12 起长输出清单也有 Schema')
  assert.ok(schemaOf(AI_CAPABILITY.DRAFT_INVITE), 'M2-14 起邀请文案也有 Schema')
  assert.equal(schemaOf(AI_CAPABILITY.MODERATE), null, '还没做的能力不该有 Schema')
  assert.equal(schemaOf('nope'), null)
})

/**
 * 以下三条来自第一次真实调用踩到的坑（2026-09-02）：
 * Prompt 要求"判断不了就留空"，模型老实回了 `instantDuration: ""` 与 `rewardType: ""`，
 * 结果被判成"取值不在白名单内"，重试一次仍旧、最后降级。
 * 「留空」在 JSON 里有三种写法，校验器必须都认。
 */
test('nullable 字段的空字符串等于留空，不是非法枚举值（真实调用踩过的坑）', () => {
  const res = validate(
    parseRequestSchema,
    Object.assign(validParse(), { instantDuration: '', rewardType: '', detail: '' })
  )
  assert.equal(res.valid, true, JSON.stringify(res.errors))
  assert.equal(res.value.instantDuration, null)
  assert.equal(res.value.rewardType, null)
})

test('三种「留空」写法（缺字段 / null / 空串）结果一致', () => {
  const base = validParse()
  delete base.rewardType
  const missing = validate(parseRequestSchema, base)
  const nulled = validate(parseRequestSchema, Object.assign(validParse(), { rewardType: null }))
  const blank = validate(parseRequestSchema, Object.assign(validParse(), { rewardType: '   ' }))
  for (const res of [missing, nulled, blank]) {
    assert.equal(res.valid, true, JSON.stringify(res.errors))
    assert.equal(res.value.rewardType, null)
  }
})

test('空字符串的宽容只给 nullable 字段：title 空串照样报错', () => {
  const res = validate(parseRequestSchema, Object.assign(validParse(), { title: '' }))
  assert.equal(res.valid, false)
  assert.ok(res.errors.some(e => e.path === 'title'), '必填且有 minLength 的字段不能被放过')
})

test('fieldSources 里键名跑偏的标记被剥掉并记 warning（真实调用踩过的坑）', () => {
  const bad = validParse()
  // 模型第一次真实调用时把「见面时间」自己译成了 meetTime、「见面地点」译成 meetLocation
  bad.fieldSources = Object.assign({}, bad.fieldSources, {
    meetTime: FIELD_SOURCE.EMPTY,
    meetLocation: FIELD_SOURCE.EMPTY
  })
  const res = validate(parseRequestSchema, bad)
  assert.equal(res.valid, true, JSON.stringify(res.errors))
  assert.equal(res.value.fieldSources.meetTime, undefined, '白名单外的键必须被剥掉')
  assert.equal(res.value.fieldSources.expectTime, FIELD_SOURCE.EMPTY, '正确的键要保留')
  // warning 必须冒到最外层，否则被剥掉的键悄无声息
  assert.ok(
    res.warnings.some(w => w.path === 'fieldSources.meetTime'),
    '嵌套对象里的 warning 要能冒到最外层'
  )
})
