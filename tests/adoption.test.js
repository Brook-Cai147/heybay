/**
 * M2-08 采纳率口径单测。
 *
 * 这块的风险不是崩，而是**口径漂移**：同一个词后面算出来的数不是同一个意思，
 * 而 PRD 5.5 要拿它决定 AI 该不该继续投入。所以口径必须被用例钉死。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { computeAdoption } = require('../cloudfunctions/_shared/ai/adoption')
const { FIELD_SOURCE } = require('../cloudfunctions/_shared/constants/enums')

const { AI, USER, EMPTY } = { AI: FIELD_SOURCE.AI, USER: FIELD_SOURCE.USER, EMPTY: FIELD_SOURCE.EMPTY }

test('一个字段都没改：采纳率 1，adopted 为 true', () => {
  const res = computeAdoption({
    aiFilledFields: ['category', 'title', 'timing'],
    fieldSources: { category: AI, title: AI, timing: AI }
  })
  assert.equal(res.aiFieldCount, 3)
  assert.deepEqual(res.modifiedFields, [])
  assert.equal(res.adoptionRate, 1)
  assert.equal(res.adopted, true)
})

test('改一个字段：采纳率按字段算，不是整次调用的 0/1', () => {
  const res = computeAdoption({
    aiFilledFields: ['category', 'title', 'timing', 'rewardType'],
    fieldSources: { category: AI, title: USER, timing: AI, rewardType: AI }
  })
  assert.deepEqual(res.modifiedFields, ['title'])
  assert.equal(res.adoptionRate, 0.75)
  // 整次调用层面仍算被采纳：留用了三个字段，AI 显然帮上了忙
  assert.equal(res.adopted, true)
})

test('用户把 AI 给的值删空，也算未采纳', () => {
  const res = computeAdoption({
    aiFilledFields: ['detail', 'title'],
    fieldSources: { detail: EMPTY, title: AI }
  })
  assert.deepEqual(res.modifiedFields, ['detail'])
  assert.equal(res.adoptionRate, 0.5)
})

test('全被改掉：采纳率 0，adopted 为 false', () => {
  const res = computeAdoption({
    aiFilledFields: ['category', 'title'],
    fieldSources: { category: USER, title: USER }
  })
  assert.equal(res.adoptionRate, 0)
  assert.equal(res.adopted, false)
})

test('AI 一个建议都没给：采纳率是 null 而不是 0（两件事不能混）', () => {
  const res = computeAdoption({ aiFilledFields: [], fieldSources: {} })
  assert.equal(res.aiFieldCount, 0)
  assert.equal(res.adoptionRate, null)
  assert.equal(res.adopted, null)
})

test('入参缺失或类型不对时不抛错，按「没有建议」处理（埋点不能拖垮发布）', () => {
  for (const input of [undefined, {}, { aiFilledFields: 'category' }, { aiFilledFields: ['a'] }]) {
    const res = computeAdoption(input)
    assert.ok(res, '不能抛错')
    assert.ok(Array.isArray(res.adoptedFields))
  }
  // 有建议但端侧没带 fieldSources：只能判定为全被改，不能乐观算成采纳
  const noSources = computeAdoption({ aiFilledFields: ['title'] })
  assert.equal(noSources.adoptionRate, 0)
})

test('采纳率保留四位小数，不出现 0.6666666666666666 这种数', () => {
  const res = computeAdoption({
    aiFilledFields: ['a', 'b', 'c'],
    fieldSources: { a: AI, b: AI, c: USER }
  })
  assert.equal(res.adoptionRate, 0.6667)
})
