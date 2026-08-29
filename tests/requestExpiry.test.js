/**
 * 需求单过期判定与在架上限单测（M1-05）。
 *
 * 这块的全部风险都在**边界**与**时区**上：算错一小时，即时型单子就会晚一小时才下架；
 * 「今天内」的当地日期算错，伦敦用户的单子会在当地上午八点就消失。所以用例以边界为主。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { TIMING_TYPE, INSTANT_DURATION } = require('../cloudfunctions/_shared/constants/enums')
const {
  SCHEDULED_GRACE_MS,
  ACTIVE_LIMIT,
  EXPIRY_ERROR,
  isTimeZoneSupported,
  computeExpireAt,
  isExpired,
  checkActiveLimit
} = require('../cloudfunctions/_shared/service/requestExpiry')

const HOUR_MS = 60 * 60 * 1000
const LONDON = 'Europe/London'

/** 2026-09-05 10:00 UTC */
const EXPECT_TIME = Date.UTC(2026, 8, 5, 10, 0, 0)

test('运行时支持 IANA 时区（否则「今天内」必须改传 utcOffsetMinutes）', () => {
  assert.equal(isTimeZoneSupported(), true, '本机 Node 缺完整 ICU，需按报错提示改传偏移分钟数')
})

test('预约型：期望时间之后 24 小时过期', () => {
  const request = { timing: TIMING_TYPE.SCHEDULED, expectTime: EXPECT_TIME }
  const { expireAt, rule } = computeExpireAt(request)
  assert.equal(expireAt, EXPECT_TIME + SCHEDULED_GRACE_MS)
  assert.equal(rule, 'scheduled+24h')
})

test('预约型：边界前一毫秒不过期，边界当刻不过期，边界后一毫秒过期', () => {
  const request = { timing: TIMING_TYPE.SCHEDULED, expectTime: EXPECT_TIME }
  const boundary = EXPECT_TIME + SCHEDULED_GRACE_MS
  assert.equal(isExpired(request, boundary - 1), false, '差一毫秒不算过期')
  assert.equal(isExpired(request, boundary), false, '到点那一刻仍然有效')
  assert.equal(isExpired(request, boundary + 1), true, '过点一毫秒即过期')
})

test('预约型：期望时间可以传 ISO 字符串或 Date，结果一致', () => {
  const asNumber = computeExpireAt({ timing: TIMING_TYPE.SCHEDULED, expectTime: EXPECT_TIME })
  const asIso = computeExpireAt({
    timing: TIMING_TYPE.SCHEDULED,
    expectTime: new Date(EXPECT_TIME).toISOString()
  })
  const asDate = computeExpireAt({ timing: TIMING_TYPE.SCHEDULED, expectTime: new Date(EXPECT_TIME) })
  assert.equal(asIso.expireAt, asNumber.expireAt)
  assert.equal(asDate.expireAt, asNumber.expireAt)
})

test('即时型 1h / 3h：从发布时间起算，边界前后各差一毫秒', () => {
  const createdAt = Date.UTC(2026, 8, 5, 9, 0, 0)

  const oneHour = { timing: TIMING_TYPE.INSTANT, instantDuration: INSTANT_DURATION.H1, createdAt }
  assert.equal(computeExpireAt(oneHour).expireAt, createdAt + HOUR_MS)
  assert.equal(isExpired(oneHour, createdAt + HOUR_MS), false)
  assert.equal(isExpired(oneHour, createdAt + HOUR_MS + 1), true)

  const threeHours = { timing: TIMING_TYPE.INSTANT, instantDuration: INSTANT_DURATION.H3, createdAt }
  assert.equal(computeExpireAt(threeHours).expireAt, createdAt + 3 * HOUR_MS)
  assert.equal(isExpired(threeHours, createdAt + 3 * HOUR_MS - 1), false)
  assert.equal(isExpired(threeHours, createdAt + 3 * HOUR_MS + 1), true)
})

test('「今天内」按城市当地日期算到 23:59:59.999，夏令时下伦敦为 22:59:59.999Z', () => {
  // 2026-07-01 是英国夏令时（BST，UTC+1）
  const createdAt = Date.UTC(2026, 6, 1, 12, 0, 0)
  const { expireAt, rule } = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    timeZone: LONDON
  })
  assert.equal(rule, 'instant/today')
  assert.equal(expireAt, Date.UTC(2026, 6, 1, 22, 59, 59, 999), 'BST 期间当地午夜 = 前一天 23:00Z')
})

test('「今天内」冬令时下伦敦为 23:59:59.999Z（同一算法，偏移自动变化）', () => {
  // 2026-01-15 是英国冬令时（GMT，UTC+0）
  const createdAt = Date.UTC(2026, 0, 15, 12, 0, 0)
  const { expireAt } = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    timeZone: LONDON
  })
  assert.equal(expireAt, Date.UTC(2026, 0, 15, 23, 59, 59, 999))
})

test('「今天内」跨时区：同一时刻发布，不同城市过期点不同', () => {
  // 2026-07-01 02:00Z：伦敦已是 7/1 凌晨三点，纽约还是 6/30 晚十点
  const createdAt = Date.UTC(2026, 6, 1, 2, 0, 0)
  const london = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    timeZone: LONDON
  }).expireAt
  const newYork = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    timeZone: 'America/New_York'
  }).expireAt

  assert.equal(london, Date.UTC(2026, 6, 1, 22, 59, 59, 999), '伦敦算到 7/1 当地结束')
  assert.equal(newYork, Date.UTC(2026, 6, 1, 3, 59, 59, 999), '纽约还在 6/30，算到 6/30 当地结束')
  assert.ok(newYork < london)
})

test('「今天内」在当地深夜发布时，有效期很短但不会为负', () => {
  // 伦敦当地 2026-07-01 23:30（= 22:30Z）
  const createdAt = Date.UTC(2026, 6, 1, 22, 30, 0)
  const { expireAt } = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    timeZone: LONDON
  })
  assert.ok(expireAt > createdAt, '过期点必须晚于发布时间')
  assert.ok(expireAt - createdAt < 30 * 60 * 1000, '当地深夜发布只剩不到半小时')
})

test('「今天内」可用 utcOffsetMinutes 代替 IANA 时区（运行时缺 ICU 时的退路）', () => {
  const createdAt = Date.UTC(2026, 6, 1, 12, 0, 0)
  const byOffset = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    utcOffsetMinutes: 60
  }).expireAt
  const byZone = computeExpireAt({
    timing: TIMING_TYPE.INSTANT,
    instantDuration: INSTANT_DURATION.TODAY,
    createdAt,
    timeZone: LONDON
  }).expireAt
  assert.equal(byOffset, byZone, '显式偏移与 IANA 时区在夏令时期间应给出同一结果')
})

test('「今天内」缺时区信息时报 MISSING_TIMEZONE，不静默用服务器本地时区', () => {
  assert.throws(
    () =>
      computeExpireAt({
        timing: TIMING_TYPE.INSTANT,
        instantDuration: INSTANT_DURATION.TODAY,
        createdAt: Date.UTC(2026, 6, 1, 12, 0, 0)
      }),
    err => err.code === EXPIRY_ERROR.MISSING_TIMEZONE
  )
})

test('数据异常：预约型缺期望时间、即时型缺时长、时长档位不认识、时效类型未知', () => {
  assert.throws(
    () => computeExpireAt({ timing: TIMING_TYPE.SCHEDULED }),
    err => err.code === EXPIRY_ERROR.MISSING_EXPECT_TIME
  )
  assert.throws(
    () => computeExpireAt({ timing: TIMING_TYPE.SCHEDULED, expectTime: '' }),
    err => err.code === EXPIRY_ERROR.MISSING_EXPECT_TIME
  )
  assert.throws(
    () => computeExpireAt({ timing: TIMING_TYPE.INSTANT, createdAt: Date.now() }),
    err => err.code === EXPIRY_ERROR.MISSING_DURATION
  )
  assert.throws(
    () => computeExpireAt({ timing: TIMING_TYPE.INSTANT, instantDuration: '2h', createdAt: 0 }),
    err => err.code === EXPIRY_ERROR.INVALID_DURATION
  )
  for (const timing of ['Scheduled', 'urgent', '', null, undefined]) {
    assert.throws(
      () => computeExpireAt({ timing }),
      err => err.code === EXPIRY_ERROR.INVALID_TIMING,
      `时效类型 ${timing} 应报 INVALID_TIMING`
    )
  }
  assert.throws(() => computeExpireAt(null), err => err.code === EXPIRY_ERROR.INVALID_TIMING)
})

test('数据异常：无法解析的时间值报 INVALID_TIME 并指出字段', () => {
  assert.throws(
    () => computeExpireAt({ timing: TIMING_TYPE.SCHEDULED, expectTime: '明天下午' }),
    err => err.code === EXPIRY_ERROR.INVALID_TIME && err.field === 'expectTime'
  )
  assert.throws(
    () =>
      computeExpireAt({
        timing: TIMING_TYPE.INSTANT,
        instantDuration: INSTANT_DURATION.H1,
        createdAt: 'not a time'
      }),
    err => err.code === EXPIRY_ERROR.INVALID_TIME && err.field === 'createdAt'
  )
})

test('isExpired 必须显式传当前时间，不许省略', () => {
  const request = { timing: TIMING_TYPE.SCHEDULED, expectTime: EXPECT_TIME }
  for (const bad of [undefined, null, 'now', NaN]) {
    assert.throws(
      () => isExpired(request, bad),
      err => err.code === EXPIRY_ERROR.INVALID_TIME && err.field === 'nowMs',
      `nowMs 传 ${bad} 应报错`
    )
  }
})

test('在架上限：免费用户 3 条，第 4 条被拦', () => {
  assert.deepEqual(checkActiveLimit(0), { allowed: true, limit: 3, remaining: 3 })
  assert.deepEqual(checkActiveLimit(2), { allowed: true, limit: 3, remaining: 1 })
  assert.deepEqual(checkActiveLimit(3), { allowed: false, limit: 3, remaining: 0 })
  assert.deepEqual(checkActiveLimit(4), { allowed: false, limit: 3, remaining: 0 })
  assert.equal(ACTIVE_LIMIT.FREE, 3)
})

test('在架上限：会员 10 条（M1 不启用，M5 才传 isMember）', () => {
  assert.equal(checkActiveLimit(9, { isMember: true }).allowed, true)
  assert.equal(checkActiveLimit(10, { isMember: true }).allowed, false)
  assert.equal(ACTIVE_LIMIT.MEMBER, 10)
})

test('在架上限：显式 limit 优先，供 configs 集合下发（改配置不改代码）', () => {
  assert.deepEqual(checkActiveLimit(4, { limit: 5 }), { allowed: true, limit: 5, remaining: 1 })
  assert.equal(checkActiveLimit(0, { limit: 0 }).allowed, false, 'limit 为 0 表示禁止发布')
  assert.equal(checkActiveLimit(9, { isMember: true, limit: 3 }).allowed, false, '显式 limit 覆盖会员档')
})

test('在架上限：非法在架数量报错而不是放行', () => {
  for (const bad of [-1, 1.5, '2', null, undefined, NaN]) {
    assert.throws(
      () => checkActiveLimit(bad),
      err => err.code === EXPIRY_ERROR.INVALID_TIME && err.field === 'activeCount',
      `在架数量 ${bad} 应报错`
    )
  }
})
