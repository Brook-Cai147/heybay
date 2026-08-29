/**
 * A/B 分桶与埋点事件字典单测（M1-04）。
 *
 * 分桶算错的后果是不可逆的：桶号不稳定 → 实验组中途漂移 → 全部对比数据作废，
 * 而且事后无法修（历史事件已经写死了错的桶号）。所以这块必须有测试（D-29 第 5 块）。
 * 事件字典部分只做结构性断言（字段齐全、命名规范、无重复），成本极低。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BUCKET_COUNT,
  DEFAULT_EXPERIMENT_KEY,
  stableHash,
  bucketOf
} = require('../cloudfunctions/_shared/service/bucketing')
const {
  EVENTS,
  EVENT_GROUP,
  EVENT_NAMES,
  ACTIVE_EVENT_NAMES,
  EVENT_COMMON_FIELDS,
  isKnownEvent,
  isActiveEvent,
  validateEvent
} = require('../cloudfunctions/_shared/constants/events')

/** 构造一批形似真实 openid 的字符串 */
const makeOpenids = count =>
  Array.from({ length: count }, (_, i) => `o_Hey${String(i).padStart(6, '0')}Bay${i * 7919}`)

test('同一 openid 反复计算，桶号永远一致', () => {
  const openid = 'o_HeyBay000123abcXYZ'
  const first = bucketOf(openid)
  for (let i = 0; i < 50; i += 1) {
    assert.equal(bucketOf(openid), first, '同一个人的桶号必须稳定')
  }
})

test('桶号落在 0 ~ 99 的整数区间内', () => {
  for (const openid of makeOpenids(500)) {
    const bucket = bucketOf(openid)
    assert.equal(Number.isInteger(bucket), true, `${openid} 的桶号不是整数`)
    assert.ok(bucket >= 0 && bucket < BUCKET_COUNT, `${openid} 的桶号越界：${bucket}`)
  }
})

test('1000 个 openid 的分布大致均匀（按四分位检查，各区间 20%±7%）', () => {
  const openids = makeOpenids(1000)
  const quartiles = [0, 0, 0, 0]
  for (const openid of openids) {
    quartiles[Math.floor(bucketOf(openid) / 25)] += 1
  }

  for (const [index, count] of quartiles.entries()) {
    const ratio = count / openids.length
    assert.ok(
      ratio > 0.18 && ratio < 0.32,
      `第 ${index + 1} 个四分位占比 ${(ratio * 100).toFixed(1)}%，偏离过大`
    )
  }
  assert.equal(quartiles.reduce((sum, n) => sum + n, 0), 1000)
})

test('100 个桶都能被命中（5000 个 openid 下不应有空桶）', () => {
  const hit = new Set()
  for (const openid of makeOpenids(5000)) hit.add(bucketOf(openid))
  assert.equal(hit.size, BUCKET_COUNT, `只命中了 ${hit.size} 个桶，哈希分布有问题`)
})

test('同一 openid 在不同实验 key 下的桶号互不相关', () => {
  const openids = makeOpenids(300)
  let sameBucketCount = 0
  for (const openid of openids) {
    if (bucketOf(openid, 'exp_publish_ai') === bucketOf(openid, 'exp_distribution')) {
      sameBucketCount += 1
    }
  }
  // 两个独立实验里落进同一桶的概率约 1%，300 个样本下不该超过 5%
  assert.ok(
    sameBucketCount / openids.length < 0.05,
    `两个实验的桶号重合率 ${sameBucketCount}/300，说明实验间会相互污染`
  )
})

test('不传实验 key 等价于用默认 key', () => {
  const openid = 'o_HeyBayDefaultKeyCheck'
  assert.equal(bucketOf(openid), bucketOf(openid, DEFAULT_EXPERIMENT_KEY))
  // 空值一律回落到默认 key，不产生第三种行为
  assert.equal(bucketOf(openid), bucketOf(openid, ''))
  assert.equal(bucketOf(openid), bucketOf(openid, null))
})

test('openid 缺失或非法时返回 null，不抛错（埋点不能阻断主流程）', () => {
  for (const bad of ['', '   ', null, undefined, 123, {}, []]) {
    assert.equal(bucketOf(bad), null, `${JSON.stringify(bad)} 应返回 null`)
  }
})

test('哈希是纯函数：不依赖随机数与当前时间', () => {
  const snapshot = stableHash('o_HeyBayPureCheck')
  assert.equal(stableHash('o_HeyBayPureCheck'), snapshot)
  assert.notEqual(stableHash('o_HeyBayPureChecl'), snapshot, '一位之差应产生不同哈希')
  assert.equal(stableHash('') >= 0, true, '空串也要有确定结果')
})

test('事件字典：每条事件都有分组、状态、必填参数列表与说明', () => {
  assert.ok(EVENT_NAMES.length > 0)
  const groups = Object.values(EVENT_GROUP)
  for (const name of EVENT_NAMES) {
    const def = EVENTS[name]
    assert.ok(groups.includes(def.group), `${name} 的分组不在六类之内`)
    assert.ok(['active', 'planned'].includes(def.status), `${name} 的状态取值不对`)
    assert.ok(Array.isArray(def.params), `${name} 缺少 params`)
    assert.ok(def.desc && def.desc.length > 0, `${name} 缺少说明`)
  }
})

test('事件字典：PRD 7.3 的六类分组每类至少登记一条事件', () => {
  const covered = new Set(EVENT_NAMES.map(name => EVENTS[name].group))
  for (const group of Object.values(EVENT_GROUP)) {
    if (group === EVENT_GROUP.EXPERIMENT) continue // 分桶是公共字段，不是事件
    assert.ok(covered.has(group), `分组 ${group} 没有任何事件`)
  }
  assert.ok(EVENT_COMMON_FIELDS.includes('bucket'), '公共字段里必须有 bucket')
})

test('事件字典：事件名用小写下划线，无重名', () => {
  for (const name of EVENT_NAMES) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `${name} 不符合命名规范`)
  }
  assert.equal(new Set(EVENT_NAMES).size, EVENT_NAMES.length, '存在重复事件名')
})

test('事件校验：字典外事件被拒，planned 事件也被拒', () => {
  assert.equal(isKnownEvent('not_a_real_event'), false)
  assert.deepEqual(validateEvent('not_a_real_event', {}), {
    valid: false,
    reason: 'UNKNOWN_EVENT',
    missing: []
  })

  const planned = EVENT_NAMES.find(name => !isActiveEvent(name))
  assert.ok(planned, '应当存在 planned 占位事件')
  assert.equal(validateEvent(planned, {}).reason, 'EVENT_NOT_ACTIVE')
})

test('事件校验：必填参数缺失会被指出来，齐全则通过', () => {
  const result = validateEvent('request_status_changed', { requestId: 'r1', from: 'open' })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'MISSING_PARAMS')
  assert.deepEqual(result.missing, ['to', 'actor'])

  const ok = validateEvent('request_status_changed', {
    requestId: 'r1',
    from: 'open',
    to: 'responded',
    actor: 'system'
  })
  assert.deepEqual(ok, { valid: true, reason: null, missing: [] })
})

test('M1 需要上报的关键事件都是 active 状态', () => {
  const mustBeActive = [
    'request_publish_submitted',
    'request_status_changed',
    'request_expired',
    'request_done_confirmed',
    'request_card_clicked',
    'response_submitted',
    'responder_selected',
    'same_gender_only_enabled',
    'gender_missing_blocked',
    'safety_tip_shown'
  ]
  for (const name of mustBeActive) {
    assert.equal(isActiveEvent(name), true, `${name} 应为 active`)
    assert.ok(ACTIVE_EVENT_NAMES.includes(name))
  }
})
