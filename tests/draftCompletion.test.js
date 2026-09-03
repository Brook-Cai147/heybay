/**
 * 草稿补全规则单测（M2-13 修复）。
 *
 * 这个文件存在的直接原因是一次真机失败：对话里给出了「确认发布」按钮，点下去服务端回
 * 「需求单有 2 处不合规」—— 因为补全规则只查了五项固定必填，漏了预约型的期望时间与
 * 搭子同行的人数。**最重要的一组用例是 parity**：`missingForCreate` 说齐了，
 * `requestValidator` 就必须收；说没齐，就必须拒。两处规则不靠人记得同步，靠这里红。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const dc = require('../cloudfunctions/_shared/ai/draftCompletion')
const { validateAndNormalize } = require('../cloudfunctions/_shared/service/requestValidator')
const {
  REQUEST_CATEGORY,
  TIMING_TYPE,
  INSTANT_DURATION,
  REWARD_TYPE,
  VISIBILITY,
  FIELD_SOURCE
} = require('../cloudfunctions/_shared/constants/enums')

/** 一份"能发出去"的即时型搭子单，各用例在它上面做减法 */
const complete = () => ({
  category: REQUEST_CATEGORY.COMPANION,
  city: 'london',
  title: '一起去看展',
  detail: '这周六想找人一起去看展',
  timing: TIMING_TYPE.INSTANT,
  instantDuration: INSTANT_DURATION.H3,
  rewardType: REWARD_TYPE.FREE,
  visibility: VISIBILITY.CITY,
  headcount: 2
})

const canCreate = draft => {
  try {
    validateAndNormalize(draft)
    return true
  } catch (err) {
    return false
  }
}

test('齐了就是齐了：不缺项、给确认按钮、不用去表单', () => {
  const status = dc.statusOf(complete())
  assert.deepStrictEqual(status.missingFields, [])
  assert.equal(status.needsConfirm, true)
  assert.equal(status.ask, null)
  assert.equal(status.handoff, '')
})

test('真机踩到的那一条：预约型 + 搭子同行，缺期望时间与人数', () => {
  const draft = Object.assign(complete(), {
    timing: TIMING_TYPE.SCHEDULED,
    instantDuration: null,
    expectTime: null,
    headcount: null
  })
  const status = dc.statusOf(draft)
  assert.deepStrictEqual(status.missingFields, ['expectTime', 'headcount'])
  // 有"只能本人填"的字段时不再问选项：问完还是发不出去，那次追问就是白问的
  assert.equal(status.ask, null)
  assert.equal(status.handoff, 'publish')
  assert.match(status.handoffReason, /期望时间/)
  assert.equal(status.needsConfirm, false, '这里给 true 就是那次真机失败')
})

test('只缺报酬类型：在对话里问，不赶去表单', () => {
  const draft = Object.assign(complete(), { rewardType: null })
  const status = dc.statusOf(draft)
  assert.deepStrictEqual(status.missingFields, ['rewardType'])
  assert.equal(status.handoff, '')
  assert.equal(status.ask.field, 'rewardType')
  assert.deepStrictEqual(status.ask.choices, dc.CHAT_REWARD_TYPES)
  // 付费不在对话里选，但要给一个"去表单"的出口
  assert.equal(status.ask.formChoice, REWARD_TYPE.PAID)
})

test('对话里能问的三项，一次只问一项', () => {
  const draft = Object.assign(complete(), {
    rewardType: null,
    instantDuration: null,
    headcount: null
  })
  const status = dc.statusOf(draft)
  assert.deepStrictEqual(status.missingFields, ['rewardType', 'instantDuration', 'headcount'])
  assert.equal(status.ask.field, 'rewardType', '按 missing 的顺序问第一项')
})

test('报酬选了付费就必须有金额，而金额只能去表单', () => {
  const draft = Object.assign(complete(), { rewardType: REWARD_TYPE.PAID, amount: null })
  const status = dc.statusOf(draft)
  assert.deepStrictEqual(status.missingFields, ['amount'])
  assert.equal(status.handoff, 'publish')
  assert.match(status.handoffReason, /金额/)
})

test('四类字段永远不在"对话里能问"的名单里（PRD 5.4）', () => {
  for (const field of ['amount', 'expectTime', 'area', 'contact']) {
    assert.equal(
      dc.CONVERSATIONAL_FIELDS.includes(field),
      false,
      `${field} 被放进对话可问字段，等于给四类字段开了后门`
    )
  }
})

test('填选项：只认白名单字段与白名单取值', () => {
  const draft = Object.assign(complete(), { rewardType: null })

  const okRes = dc.applyChoice({ draft, field: 'rewardType', value: REWARD_TYPE.MEAL })
  assert.equal(okRes.ok, true)
  assert.equal(okRes.draft.rewardType, REWARD_TYPE.MEAL)
  // 用户自己点的，来源就是 user —— 不进 AI 采纳率的分子分母
  assert.equal(okRes.fieldSources.rewardType, FIELD_SOURCE.USER)
  assert.equal(draft.rewardType, null, '原草稿不该被就地改写')

  assert.equal(dc.applyChoice({ draft, field: 'amount', value: 100 }).reason, 'field_not_allowed')
  assert.equal(dc.applyChoice({ draft, field: 'expectTime', value: '周六' }).reason, 'field_not_allowed')
  assert.equal(dc.applyChoice({ draft, field: 'rewardType', value: 'paid' }).reason, 'bad_value')
  assert.equal(dc.applyChoice({ draft, field: 'headcount', value: 99 }).reason, 'bad_value')
  assert.equal(dc.applyChoice({ draft: null, field: 'rewardType', value: 'free' }).reason, 'no_draft')
})

test('人数只认 1~20 的整数', () => {
  assert.equal(dc.isValidHeadcount(1), true)
  assert.equal(dc.isValidHeadcount(20), true)
  assert.equal(dc.isValidHeadcount(0), false)
  assert.equal(dc.isValidHeadcount(21), false)
  assert.equal(dc.isValidHeadcount(2.5), false)
  assert.equal(dc.isValidHeadcount('3'), true, '端侧 dataset 传上来的是字符串')
  assert.equal(dc.isValidHeadcount(null), false)
})

/**
 * **本文件最重要的一组。** 补全规则与服务端校验器必须给出同一个答案：
 * 说齐了就一定能写库，说没齐就一定写不进去。任何一条不一致，就会以
 * "按钮点了才报错"或"明明能发却被赶去表单"的形式出现在用户面前。
 */
test('parity：missingForCreate 与 requestValidator 结论一致', () => {
  const cases = [
    ['完整的即时型搭子单', complete()],
    ['缺品类', Object.assign(complete(), { category: null })],
    ['缺标题', Object.assign(complete(), { title: '' })],
    ['缺具体需求', Object.assign(complete(), { detail: '  ' })],
    ['缺报酬类型', Object.assign(complete(), { rewardType: null })],
    ['即时型缺时长', Object.assign(complete(), { instantDuration: null })],
    ['搭子同行缺人数', Object.assign(complete(), { headcount: null })],
    ['搭子同行人数越界', Object.assign(complete(), { headcount: 99 })],
    [
      '预约型缺期望时间',
      Object.assign(complete(), { timing: TIMING_TYPE.SCHEDULED, instantDuration: null, expectTime: null })
    ],
    [
      '预约型齐全',
      Object.assign(complete(), {
        timing: TIMING_TYPE.SCHEDULED,
        instantDuration: null,
        expectTime: '2026-09-05 14:00'
      })
    ],
    ['付费缺金额', Object.assign(complete(), { rewardType: REWARD_TYPE.PAID, amount: null })],
    ['付费带金额', Object.assign(complete(), { rewardType: REWARD_TYPE.PAID, amount: 30 })],
    [
      '非搭子品类不要求人数',
      Object.assign(complete(), { category: REQUEST_CATEGORY.INQUIRY, headcount: null })
    ]
  ]

  for (const [name, draft] of cases) {
    const complete_ = dc.missingForCreate(draft).length === 0
    assert.equal(
      complete_,
      canCreate(draft),
      `「${name}」两处结论不一致：补全规则说${complete_ ? '齐了' : '没齐'}，校验器说${canCreate(draft) ? '能收' : '不收'}`
    )
  }
})
