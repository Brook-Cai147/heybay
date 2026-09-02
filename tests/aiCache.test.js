/**
 * M2-05 缓存键单测。
 *
 * 缓存出错的表现极其隐蔽：不会报错，只会静静地返回一个不属于这次输入的答案。
 * 所以键的构成必须逐条钉住，尤其是「语料变了键要变」这条。
 */

const test = require('node:test')
const assert = require('node:assert')

const {
  normalizeInput,
  isCacheable,
  cacheKeyOf,
  expireAtMsOf
} = require('../cloudfunctions/_shared/ai/cache')
const { AI_CAPABILITY } = require('../cloudfunctions/_shared/constants/aiCapabilities')
const { AI_REGISTRY } = require('../cloudfunctions/_shared/ai/registry')

const keyFor = (params, city = 'london') =>
  cacheKeyOf({ capability: AI_CAPABILITY.SEARCH_KNOWLEDGE, city, params })

test('归一化只做大小写、空白与首尾标点，不动内容', () => {
  assert.strictEqual(normalizeInput('  NHS  怎么 注册？ '), 'nhs 怎么 注册')
  assert.strictEqual(normalizeInput('\n\tHello   World\n'), 'hello world')
  assert.strictEqual(normalizeInput(''), '')
  assert.strictEqual(normalizeInput(undefined), '')
})

test('同一问题的不同写法（大小写、空白、尾部标点）命中同一条缓存', () => {
  const a = keyFor({ question: 'NHS 怎么注册？' })
  const b = keyFor({ question: '  nhs 怎么注册  ' })
  assert.strictEqual(a, b)
})

test('不做同义词归并：问法不同就当成不同问题，宁可少命中也不要答错', () => {
  assert.notStrictEqual(keyFor({ question: 'NHS 怎么注册' }), keyFor({ question: '如何注册 NHS' }))
})

test('城市进键：同一个问题在不同城市不共用答案（D-10 的开城边界）', () => {
  assert.notStrictEqual(keyFor({ question: '看牙贵吗' }, 'london'), keyFor({ question: '看牙贵吗' }, 'manchester'))
})

test('语料变了键就变——否则「补了新语料还回旧答案」是查不出来的 bug', () => {
  const one = keyFor({ question: '看牙贵吗', snippets: [{ refId: 'a' }] })
  const two = keyFor({ question: '看牙贵吗', snippets: [{ refId: 'a' }, { refId: 'b' }] })
  assert.notStrictEqual(one, two)
})

test('语料顺序不影响键：同一批语料换个顺序不该重算一次模型', () => {
  const asc = keyFor({ question: '看牙贵吗', snippets: [{ refId: 'a' }, { refId: 'b' }] })
  const desc = keyFor({ question: '看牙贵吗', snippets: [{ refId: 'b' }, { refId: 'a' }] })
  assert.strictEqual(asc, desc)
})

test('空问题不生成键：空输入没有缓存价值，还会把所有空调用撞到一起', () => {
  assert.strictEqual(keyFor({ question: '   ' }), null)
  assert.strictEqual(keyFor({}), null)
})

test('可缓存与否由注册表说了算，解析类能力一律不缓存', () => {
  assert.strictEqual(isCacheable(AI_REGISTRY[AI_CAPABILITY.SEARCH_KNOWLEDGE]), true)
  assert.strictEqual(isCacheable(AI_REGISTRY[AI_CAPABILITY.PARSE_REQUEST]), false)
  assert.strictEqual(cacheKeyOf({ capability: AI_CAPABILITY.PARSE_REQUEST, city: 'london', params: { text: '找人看球' } }), null)
  assert.strictEqual(isCacheable(null), false)
})

test('有效期来自注册表的 cacheTtlSeconds，不在缓存模块里另写一个默认值', () => {
  const record = AI_REGISTRY[AI_CAPABILITY.SEARCH_KNOWLEDGE]
  assert.strictEqual(expireAtMsOf(record, 1000), 1000 + record.cacheTtlSeconds * 1000)
  assert.strictEqual(expireAtMsOf(AI_REGISTRY[AI_CAPABILITY.PARSE_REQUEST], 1000), 1000)
})

test('键的三段结构可读：城市:能力:哈希（排查时能一眼看出是谁的缓存）', () => {
  const parts = keyFor({ question: '看牙贵吗' }).split(':')
  assert.strictEqual(parts.length, 3)
  assert.strictEqual(parts[0], 'london')
  assert.strictEqual(parts[1], AI_CAPABILITY.SEARCH_KNOWLEDGE)
  assert.match(parts[2], /^[0-9a-f]{32}$/)
})

const checklistKey = (params, city = 'london') =>
  cacheKeyOf({ capability: AI_CAPABILITY.GENERATE_CHECKLIST, city, params })

test('落地清单按城市 + 出行类型缓存：换个到达时间照样命中（M2-12 第 2 条）', () => {
  const monday = checklistKey({ travelType: '留学', arriveAt: '下周一' })
  const friday = checklistKey({ travelType: '留学', arriveAt: '10 月 3 日晚上' })
  assert.strictEqual(monday, friday, '同城同出行类型可复用，这是这条贵能力省额度的唯一手段')
  assert.notStrictEqual(monday, checklistKey({ travelType: '旅游', arriveAt: '下周一' }))
  assert.notStrictEqual(monday, checklistKey({ travelType: '留学' }, 'manchester'))
})

test('落地清单缺出行类型时不生成键：所有空调用会撞成同一条缓存', () => {
  assert.strictEqual(checklistKey({ arriveAt: '下周一' }), null)
})
