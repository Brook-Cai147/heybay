/**
 * 需求单状态机 —— 转移合法性单测（M1-01）。
 *
 * 覆盖要求（见 implementation-plan.md M1-01）：
 *   1. 转移表里每一条合法边都逐条通过
 *   2. 四个终态的任何出边都被拒
 *   3. 未知状态被拒
 *   4. draft 不能直接跳 matched
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { REQUEST_STATUS, REQUEST_STATUS_VALUES } = require('../cloudfunctions/_shared/constants/enums')
const {
  TRANSITIONS,
  TRANSITION_ERROR,
  isKnownStatus,
  isTerminalStatus,
  allowedTargets,
  canTransition,
  assertTransition
} = require('../cloudfunctions/_shared/service/requestStateMachine')

const S = REQUEST_STATUS

/** 转移表里的全部合法边，展开成 [from, to] 数组，用于逐条断言 */
const legalEdges = Object.entries(TRANSITIONS).flatMap(([from, targets]) =>
  targets.map(to => [from, to])
)

test('转移表覆盖全部九个状态，且与枚举一一对应', () => {
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...REQUEST_STATUS_VALUES].sort())
})

test('每一条合法转移都通过（canTransition 与 assertTransition 一致）', () => {
  assert.equal(legalEdges.length, 12, '转移表边数变化时请同步 PRD 4.1 与本断言')
  for (const [from, to] of legalEdges) {
    assert.equal(canTransition(from, to), true, `${from} → ${to} 应为合法`)
    assert.equal(assertTransition(from, to), true, `${from} → ${to} 应为合法`)
  }
})

test('非法转移全部被拒，且错误码为 ILLEGAL_TRANSITION', () => {
  const legalSet = new Set(legalEdges.map(([from, to]) => `${from}>${to}`))
  let illegalCount = 0

  for (const from of REQUEST_STATUS_VALUES) {
    for (const to of REQUEST_STATUS_VALUES) {
      if (legalSet.has(`${from}>${to}`)) continue
      illegalCount += 1
      assert.equal(canTransition(from, to), false, `${from} → ${to} 应为非法`)
      assert.throws(
        () => assertTransition(from, to),
        err => {
          assert.equal(err.code, TRANSITION_ERROR.ILLEGAL_TRANSITION)
          assert.equal(err.from, from)
          assert.equal(err.to, to)
          return true
        },
        `${from} → ${to} 应抛 ILLEGAL_TRANSITION`
      )
    }
  }

  assert.equal(illegalCount, 9 * 9 - 12, '九个状态的全组合减去 12 条合法边')
})

test('自转移（from === to）一律非法', () => {
  for (const status of REQUEST_STATUS_VALUES) {
    assert.equal(canTransition(status, status), false, `${status} → ${status} 应为非法`)
  }
})

test('终态没有任何出边：rated / expired / cancelled / removed', () => {
  for (const status of [S.RATED, S.EXPIRED, S.CANCELLED, S.REMOVED]) {
    assert.equal(isTerminalStatus(status), true, `${status} 应为终态`)
    assert.deepEqual(allowedTargets(status), [], `${status} 不应有出边`)
    for (const to of REQUEST_STATUS_VALUES) {
      assert.equal(canTransition(status, to), false, `终态 ${status} 不应能转移到 ${to}`)
    }
  }
})

test('未完结的状态都不是终态', () => {
  for (const status of [S.DRAFT, S.OPEN, S.RESPONDED, S.MATCHED, S.DONE]) {
    assert.equal(isTerminalStatus(status), false, `${status} 不应为终态`)
  }
})

test('未知状态被拒，错误码为 UNKNOWN_STATUS', () => {
  const unknowns = ['Open', 'pending', '', null, undefined, 'DRAFT']

  for (const bad of unknowns) {
    assert.equal(isKnownStatus(bad), false, `${bad} 不应是已登记状态`)
    assert.equal(canTransition(bad, S.OPEN), false)
    assert.equal(canTransition(S.OPEN, bad), false)
    assert.throws(
      () => assertTransition(bad, S.OPEN),
      err => err.code === TRANSITION_ERROR.UNKNOWN_STATUS,
      `当前状态 ${bad} 应抛 UNKNOWN_STATUS`
    )
    assert.throws(
      () => assertTransition(S.OPEN, bad),
      err => err.code === TRANSITION_ERROR.UNKNOWN_STATUS,
      `目标状态 ${bad} 应抛 UNKNOWN_STATUS`
    )
  }
})

test('draft 只能到 open，不能跳过中间状态', () => {
  assert.deepEqual(allowedTargets(S.DRAFT), [S.OPEN])
  assert.equal(canTransition(S.DRAFT, S.MATCHED), false, '不能绕过响应与选定')
  assert.equal(canTransition(S.DRAFT, S.RESPONDED), false)
  assert.equal(canTransition(S.DRAFT, S.DONE), false)
})

test('关键业务约束：已完成的单不能被取消或下架，已确定的单不能过期', () => {
  assert.equal(canTransition(S.DONE, S.CANCELLED), false, '完成后取消要走纠纷流程，不改状态')
  assert.equal(canTransition(S.DONE, S.REMOVED), false)
  assert.equal(canTransition(S.MATCHED, S.EXPIRED), false, '已选定的单由双方确认或取消收尾，不自动过期')
  assert.equal(canTransition(S.MATCHED, S.RESPONDED), false, '选定不可逆')
})

test('转移表与错误对象都是冻结的，防止运行时被改坏', () => {
  assert.equal(Object.isFrozen(TRANSITIONS), true)
  assert.equal(Object.isFrozen(TRANSITIONS[S.OPEN]), true)
  assert.throws(() => {
    'use strict'
    TRANSITIONS[S.DONE] = [S.OPEN]
  })
})
