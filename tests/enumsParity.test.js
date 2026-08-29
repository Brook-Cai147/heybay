/**
 * 端云枚举一致性单测（M1-03）。
 *
 * 存在理由：小程序端无法 require 目录外文件，枚举只能双份（D-27）。手抄副本迟早会漂移，
 * 而漂移的后果是端侧写出云侧不认的值 —— 脏数据进库、且不会立刻报错。这条断言就是那道闸。
 *
 * `ACTOR_ROLE` 是云侧独有（鉴权概念），有意不参与比对。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const cloudEnums = require('../cloudfunctions/_shared/constants/enums')
const clientEnums = require('../miniprogram/models/enums')

/** 两侧都必须存在且完全相等的枚举组 */
const SHARED_GROUPS = [
  'REQUEST_STATUS',
  'REQUEST_CATEGORY',
  'REQUEST_CATEGORY_LABEL',
  'TIMING_TYPE',
  'INSTANT_DURATION',
  'REWARD_TYPE',
  'VISIBILITY',
  'GENDER',
  'PREFERENCE_FLAG'
]

/** 与上面各组对应的 VALUES 数组 */
const SHARED_VALUE_LISTS = [
  'REQUEST_STATUS_VALUES',
  'REQUEST_CATEGORY_VALUES',
  'TIMING_TYPE_VALUES',
  'INSTANT_DURATION_VALUES',
  'REWARD_TYPE_VALUES',
  'VISIBILITY_VALUES',
  'GENDER_VALUES',
  'PREFERENCE_FLAG_VALUES'
]

test('共享枚举组在两侧的键与值完全一致', () => {
  for (const group of SHARED_GROUPS) {
    assert.ok(cloudEnums[group], `云侧缺少枚举组 ${group}`)
    assert.ok(clientEnums[group], `端侧缺少枚举组 ${group}`)
    assert.deepEqual(
      clientEnums[group],
      cloudEnums[group],
      `${group} 两侧不一致 —— 改枚举必须同时改云侧与端侧（D-27）`
    )
  }
})

test('共享枚举的 VALUES 数组在两侧一致，且顺序相同', () => {
  for (const list of SHARED_VALUE_LISTS) {
    assert.deepEqual(clientEnums[list], cloudEnums[list], `${list} 两侧不一致`)
  }
})

test('端侧不含云侧独有的 ACTOR_ROLE，云侧含', () => {
  assert.ok(cloudEnums.ACTOR_ROLE, '云侧应有 ACTOR_ROLE')
  assert.equal(clientEnums.ACTOR_ROLE, undefined, 'ACTOR_ROLE 是鉴权概念，端侧不该有')
})

test('两侧导出的键集合只差 ACTOR_ROLE 相关项', () => {
  const cloudKeys = Object.keys(cloudEnums).sort()
  const clientKeys = Object.keys(clientEnums).sort()
  const onlyInCloud = cloudKeys.filter(key => !clientKeys.includes(key))
  const onlyInClient = clientKeys.filter(key => !cloudKeys.includes(key))

  assert.deepEqual(onlyInCloud, ['ACTOR_ROLE', 'ACTOR_ROLE_VALUES'])
  assert.deepEqual(onlyInClient, [], '端侧不应有云侧没有的枚举')
})

test('品类白名单恰好 8 类，且每类都有中文展示名（D-09）', () => {
  assert.equal(cloudEnums.REQUEST_CATEGORY_VALUES.length, 8, '品类只能有 8 类，加类前先看 D-09')
  for (const value of cloudEnums.REQUEST_CATEGORY_VALUES) {
    assert.ok(cloudEnums.REQUEST_CATEGORY_LABEL[value], `${value} 缺少中文展示名`)
  }
  assert.equal(
    Object.keys(cloudEnums.REQUEST_CATEGORY_LABEL).length,
    8,
    '展示名多于品类，说明有残留'
  )
})

test('品类白名单里没有交友类语义，偏好里没有异性选项（D-09）', () => {
  const banned = ['friend', 'dating', 'social', 'chat', 'companion_dating']
  for (const value of cloudEnums.REQUEST_CATEGORY_VALUES) {
    assert.equal(banned.includes(value), false, `品类 ${value} 属交友语义，不允许存在`)
  }
  for (const label of Object.values(cloudEnums.REQUEST_CATEGORY_LABEL)) {
    for (const word of ['交友', '聊天', '同城', '处对象']) {
      assert.equal(label.includes(word), false, `品类展示名「${label}」含交友语义`)
    }
  }
  for (const flag of cloudEnums.PREFERENCE_FLAG_VALUES) {
    assert.equal(/opposite|异性/i.test(flag), false, `偏好开关 ${flag} 指向异性偏好，违反 D-09`)
  }
})

test('性别枚举含 unset —— 未填是一个显式取值，不是空字符串（D-26）', () => {
  assert.ok(cloudEnums.GENDER_VALUES.includes('unset'))
  assert.equal(cloudEnums.GENDER_VALUES.length, 3)
})

test('两侧枚举对象都是冻结的', () => {
  for (const group of SHARED_GROUPS) {
    assert.equal(Object.isFrozen(cloudEnums[group]), true, `云侧 ${group} 未冻结`)
    assert.equal(Object.isFrozen(clientEnums[group]), true, `端侧 ${group} 未冻结`)
  }
})
