/**
 * AI 额度与成本计算单测（M2-01）。
 *
 * 这块算错的后果：额度算错会误拦付费用户或让免费用户白用；成本算错会让 PRD 5.5 的
 * 「每次成功撮合 AI 成本 ≤0.10 元」这条达标线失去意义 —— 都属于"错了不会报错"的类型。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AI_CAPABILITY,
  AI_CAPABILITY_VALUES,
  QUOTA_TIER,
  QUOTA_TIER_VALUES,
  CAPABILITY_TIER,
  DAILY_LIMITS
} = require('../cloudfunctions/_shared/constants/aiCapabilities')
const {
  QUOTA_RESULT,
  isKnownCapability,
  tierOf,
  dailyLimitOf,
  checkQuota,
  computeCost,
  usageKey
} = require('../cloudfunctions/_shared/service/aiQuota')

const LONDON = 'Europe/London'
/** 伦敦夏令时的一天：2026-07-01 中午（BST，UTC+1） */
const SUMMER_NOON = Date.UTC(2026, 6, 1, 12, 0, 0)
/** 伦敦冬令时的一天：2026-01-15 中午（GMT，UTC+0） */
const WINTER_NOON = Date.UTC(2026, 0, 15, 12, 0, 0)

test('14 项能力全部登记了额度类别，且类别取值合法', () => {
  assert.equal(AI_CAPABILITY_VALUES.length, 14, '能力数与 PRD 5.2 的能力地图一致')
  for (const capability of AI_CAPABILITY_VALUES) {
    const tier = CAPABILITY_TIER[capability]
    assert.ok(tier, `${capability} 没有登记额度类别`)
    assert.ok(QUOTA_TIER_VALUES.includes(tier), `${capability} 的类别 ${tier} 不在三档之内`)
  }
})

test('每日限免的能力都配了 free / member 上限，且会员不低于免费', () => {
  for (const capability of AI_CAPABILITY_VALUES) {
    if (CAPABILITY_TIER[capability] !== QUOTA_TIER.DAILY) {
      assert.equal(DAILY_LIMITS[capability], undefined, `${capability} 不是日限档，不该有额度配置`)
      continue
    }
    const limits = DAILY_LIMITS[capability]
    assert.ok(limits, `${capability} 是日限档但没配额度`)
    assert.ok(limits.free >= 1, `${capability} 免费额度至少 1 次`)
    assert.ok(limits.member >= limits.free, `${capability} 会员额度不该低于免费额度`)
  }
})

test('无限免费的能力永不被拦，用量再高也放行', () => {
  const unlimited = AI_CAPABILITY_VALUES.filter(
    c => CAPABILITY_TIER[c] === QUOTA_TIER.UNLIMITED
  )
  assert.ok(unlimited.length >= 9, '主转化路径上的短文本能力都该是无限免费')

  for (const capability of unlimited) {
    const res = checkQuota({ capability, usedToday: 99999, nowMs: SUMMER_NOON, timeZone: LONDON })
    assert.equal(res.allowed, true, `${capability} 不该被额度拦住`)
    assert.equal(res.remaining, Infinity)
    assert.equal(dailyLimitOf(capability), Infinity)
  }
})

test('应急求助卡与需求单解析必须是无限免费（拦住它们的代价远大于省下的钱）', () => {
  assert.equal(tierOf(AI_CAPABILITY.EMERGENCY_CARD), QUOTA_TIER.UNLIMITED)
  assert.equal(tierOf(AI_CAPABILITY.PARSE_REQUEST), QUOTA_TIER.UNLIMITED)
})

test('定时任务发起的能力属 SYSTEM 档，不计任何用户的额度', () => {
  assert.equal(tierOf(AI_CAPABILITY.DAILY_TOPIC), QUOTA_TIER.SYSTEM)
  const res = checkQuota({ capability: AI_CAPABILITY.DAILY_TOPIC, usedToday: 500, nowMs: SUMMER_NOON })
  assert.equal(res.allowed, true)
})

test('每日限免：免费用户到上限被拦，会员上限更高', () => {
  const capability = AI_CAPABILITY.GENERATE_CHECKLIST
  const freeLimit = DAILY_LIMITS[capability].free

  const stillOk = checkQuota({ capability, usedToday: freeLimit - 1, nowMs: SUMMER_NOON, timeZone: LONDON })
  assert.equal(stillOk.allowed, true)
  assert.equal(stillOk.remaining, 1)

  const blocked = checkQuota({ capability, usedToday: freeLimit, nowMs: SUMMER_NOON, timeZone: LONDON })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.result, QUOTA_RESULT.QUOTA_EXCEEDED)

  // 同样的用量，会员还能继续用
  const member = checkQuota({
    capability,
    usedToday: freeLimit,
    isMember: true,
    nowMs: SUMMER_NOON,
    timeZone: LONDON
  })
  assert.equal(member.allowed, true)
})

test('额度耗尽的返回是结构化的：上限、已用、下次可用时间、能否升级', () => {
  const capability = AI_CAPABILITY.SEARCH_KNOWLEDGE
  const res = checkQuota({
    capability,
    usedToday: DAILY_LIMITS[capability].free,
    nowMs: SUMMER_NOON,
    timeZone: LONDON
  })

  assert.equal(res.allowed, false)
  assert.equal(res.limit, DAILY_LIMITS[capability].free)
  assert.equal(res.usedToday, DAILY_LIMITS[capability].free)
  assert.equal(res.remaining, 0)
  assert.equal(typeof res.resetAtMs, 'number')
  assert.equal(res.upgradable, true, '免费用户还有升级这条路')
  assert.ok(res.message.includes('会员'), '免费用户的提示应指出会员可提高上限')

  // 会员到顶只能等重置，提示语不该再推销会员
  const memberRes = checkQuota({
    capability,
    usedToday: DAILY_LIMITS[capability].member,
    isMember: true,
    nowMs: SUMMER_NOON,
    timeZone: LONDON
  })
  assert.equal(memberRes.allowed, false)
  assert.equal(memberRes.upgradable, false)
  assert.equal(memberRes.message.includes('会员'), false)
})

test('跨天重置：下次可用时间是当地次日零点，夏令时冬令时都对', () => {
  const capability = AI_CAPABILITY.GENERATE_XHS_POST
  const used = DAILY_LIMITS[capability].free

  // 夏令时（BST = UTC+1）：当地 7/2 00:00 = UTC 7/1 23:00
  const summer = checkQuota({ capability, usedToday: used, nowMs: SUMMER_NOON, timeZone: LONDON })
  assert.equal(summer.resetAtMs, Date.UTC(2026, 6, 1, 23, 0, 0))

  // 冬令时（GMT = UTC+0）：当地 1/16 00:00 = UTC 1/16 00:00
  const winter = checkQuota({ capability, usedToday: used, nowMs: WINTER_NOON, timeZone: LONDON })
  assert.equal(winter.resetAtMs, Date.UTC(2026, 0, 16, 0, 0, 0))

  assert.ok(summer.resetAtMs > SUMMER_NOON, '重置时间必须在当前时间之后')
})

test('当日边界：当地 23:59 仍算今天，重置点一到就是新的一天', () => {
  const capability = AI_CAPABILITY.BROADCAST
  const used = DAILY_LIMITS[capability].free

  // 夏令时下当地 23:59 = UTC 22:59
  const lateNight = Date.UTC(2026, 6, 1, 22, 59, 0)
  const res = checkQuota({ capability, usedToday: used, nowMs: lateNight, timeZone: LONDON })
  assert.equal(res.allowed, false, '当地还没到零点，额度不该提前恢复')
  assert.equal(res.resetAtMs, Date.UTC(2026, 6, 1, 23, 0, 0))

  // 到了重置时刻，用量归零（用量由调用方按 usageKey 重新计，这里验证键确实变了）
  const keyBefore = usageKey({ capability, nowMs: lateNight, timeZone: LONDON })
  const keyAfter = usageKey({ capability, nowMs: res.resetAtMs, timeZone: LONDON })
  assert.notEqual(keyBefore, keyAfter, '跨过当地零点后日用量键必须变化')
  assert.ok(keyBefore.endsWith('2026-07-01'))
  assert.ok(keyAfter.endsWith('2026-07-02'))
})

test('未登记的能力一律拒绝，不默认放行', () => {
  for (const bad of ['parseRequests', 'chat', '', null, undefined]) {
    const res = checkQuota({ capability: bad, usedToday: 0, nowMs: SUMMER_NOON })
    assert.equal(res.allowed, false, `${bad} 不该被放行`)
    assert.equal(res.result, QUOTA_RESULT.UNKNOWN_CAPABILITY)
    assert.equal(isKnownCapability(bad), false)
    assert.equal(tierOf(bad), null)
  }
})

test('成本计算：输入输出分开计价，保留四位小数', () => {
  // 1500 输入 + 300 输出，报价 1 元/百万输入、2 元/百万输出
  // = (1500 * 1 + 300 * 2) / 1e6 = 0.0021
  const cost = computeCost({
    inputTokens: 1500,
    outputTokens: 300,
    inputPricePerMTokens: 1,
    outputPricePerMTokens: 2
  })
  assert.equal(cost, 0.0021)

  // 量级自检：需求单解析应落在 PRD 5.6 给的 0.001~0.005 区间
  assert.ok(cost >= 0.001 && cost <= 0.005, 'PRD 5.6 的解析成本量级')
})

test('成本计算：缺参数与负数都按 0 处理，不产生 NaN', () => {
  assert.equal(computeCost(), 0)
  assert.equal(computeCost({ inputTokens: 1000 }), 0, '没有报价就算不出钱')
  assert.equal(
    computeCost({ inputTokens: -5, outputTokens: -5, inputPricePerMTokens: 1, outputPricePerMTokens: 1 }),
    0
  )
  assert.equal(Number.isNaN(computeCost({ inputTokens: 'x', inputPricePerMTokens: 1 })), false)
})

test('成本计算不会把小额抹成 0（四位小数是刻意选的）', () => {
  // 机审级别：输入 800、输出 20，报价 0.5 / 1 元每百万 = 0.00042
  const cost = computeCost({
    inputTokens: 800,
    outputTokens: 20,
    inputPricePerMTokens: 0.5,
    outputPricePerMTokens: 1
  })
  assert.equal(cost, 0.0004)
  assert.ok(cost > 0, '千分之几元的调用不该被四舍五入成免费')
})

test('额度表与能力表都是冻结的，防止运行时被改坏', () => {
  assert.equal(Object.isFrozen(CAPABILITY_TIER), true)
  assert.equal(Object.isFrozen(DAILY_LIMITS), true)
  assert.equal(Object.isFrozen(DAILY_LIMITS[AI_CAPABILITY.BROADCAST]), true)
})
