/**
 * 需求单状态机 —— 角色权限矩阵单测（M1-02）。
 *
 * 覆盖要求（见 implementation-plan.md M1-02）：
 *   1. 权限表与转移表的边一一对应（加了边忘配权限要被拦下）
 *   2. 每个角色的允许集逐条通过
 *   3. 越权用例全部被拒，且错误码为 TRANSITION_FORBIDDEN
 *   4. 错误码能区分"转移非法"与"转移合法但没权限"
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  REQUEST_STATUS,
  REQUEST_STATUS_VALUES,
  ACTOR_ROLE,
  ACTOR_ROLE_VALUES
} = require('../cloudfunctions/_shared/constants/enums')
const {
  TRANSITIONS,
  PERMISSIONS,
  TRANSITION_ERROR,
  edgeKey,
  isKnownActor,
  allowedActors,
  canActorTransition,
  assertTransitionByActor
} = require('../cloudfunctions/_shared/service/requestStateMachine')

const S = REQUEST_STATUS
const R = ACTOR_ROLE

const legalEdges = Object.entries(TRANSITIONS).flatMap(([from, targets]) =>
  targets.map(to => [from, to])
)

test('权限表的键与转移表的边一一对应', () => {
  const edgesFromTable = legalEdges.map(([from, to]) => edgeKey(from, to)).sort()
  assert.deepEqual(Object.keys(PERMISSIONS).sort(), edgesFromTable)
})

test('每条转移至少有一个角色可执行，且角色都是已登记的', () => {
  for (const [key, actors] of Object.entries(PERMISSIONS)) {
    assert.ok(actors.length > 0, `${key} 没有任何角色可执行，等于死边`)
    for (const actor of actors) {
      assert.equal(isKnownActor(actor), true, `${key} 里的 ${actor} 不是已登记角色`)
    }
  }
})

test('需求方 owner 的允许集：发布、选定、撤销选定、取消（未选定与已选定两段）、完成、评价', () => {
  const expected = [
    [S.DRAFT, S.OPEN],
    [S.RESPONDED, S.MATCHED],
    [S.MATCHED, S.RESPONDED],
    [S.OPEN, S.CANCELLED],
    [S.RESPONDED, S.CANCELLED],
    [S.MATCHED, S.CANCELLED],
    [S.MATCHED, S.DONE],
    [S.DONE, S.RATED]
  ]
  for (const [from, to] of expected) {
    assert.equal(canActorTransition(from, to, R.OWNER), true, `owner 应能做 ${from} → ${to}`)
    assert.equal(assertTransitionByActor(from, to, R.OWNER), true)
  }
})

test('响应者 responder 的允许集只有三条：已选定后的完成、取消、评价', () => {
  const allowed = [
    [S.MATCHED, S.DONE],
    [S.MATCHED, S.CANCELLED],
    [S.DONE, S.RATED]
  ]
  for (const [from, to] of allowed) {
    assert.equal(canActorTransition(from, to, R.RESPONDER), true, `responder 应能做 ${from} → ${to}`)
  }

  // 除这三条外，responder 对任何合法转移都无权
  const allowedKeys = new Set(allowed.map(([from, to]) => edgeKey(from, to)))
  for (const [from, to] of legalEdges) {
    if (allowedKeys.has(edgeKey(from, to))) continue
    assert.equal(
      canActorTransition(from, to, R.RESPONDER),
      false,
      `responder 不应能做 ${from} → ${to}`
    )
  }
})

test('系统 system 只能做被响应与过期，做不了任何用户决策', () => {
  const allowed = [
    [S.OPEN, S.RESPONDED],
    [S.OPEN, S.EXPIRED],
    [S.RESPONDED, S.EXPIRED]
  ]
  for (const [from, to] of allowed) {
    assert.equal(canActorTransition(from, to, R.SYSTEM), true, `system 应能做 ${from} → ${to}`)
  }

  const allowedKeys = new Set(allowed.map(([from, to]) => edgeKey(from, to)))
  for (const [from, to] of legalEdges) {
    if (allowedKeys.has(edgeKey(from, to))) continue
    assert.equal(canActorTransition(from, to, R.SYSTEM), false, `system 不应能做 ${from} → ${to}`)
  }
})

test('管理员 admin 只能下架，不能替用户发布、选定或完成', () => {
  assert.equal(canActorTransition(S.OPEN, S.REMOVED, R.ADMIN), true)
  assert.equal(canActorTransition(S.RESPONDED, S.REMOVED, R.ADMIN), true)

  const allowedKeys = new Set([edgeKey(S.OPEN, S.REMOVED), edgeKey(S.RESPONDED, S.REMOVED)])
  for (const [from, to] of legalEdges) {
    if (allowedKeys.has(edgeKey(from, to))) continue
    assert.equal(canActorTransition(from, to, R.ADMIN), false, `admin 不应能做 ${from} → ${to}`)
  }
})

test('越权用例逐条被拒，错误码为 TRANSITION_FORBIDDEN', () => {
  const forbidden = [
    [S.RESPONDED, S.MATCHED, R.RESPONDER, '响应者不能把自己选定'],
    [S.RESPONDED, S.MATCHED, R.SYSTEM, '选定必须由需求方本人做'],
    [S.RESPONDED, S.MATCHED, R.ADMIN, '管理员不能替需求方选定'],
    [S.OPEN, S.EXPIRED, R.OWNER, '过期只能由定时任务触发'],
    [S.RESPONDED, S.EXPIRED, R.OWNER, '过期只能由定时任务触发'],
    [S.OPEN, S.REMOVED, R.RESPONDER, '下架只有管理员能做'],
    [S.OPEN, S.REMOVED, R.OWNER, '需求方要下自己的单应走取消而非下架'],
    [S.OPEN, S.REMOVED, R.SYSTEM, '下架是人工处置，系统不自动做'],
    [S.DRAFT, S.OPEN, R.SYSTEM, '发布必须由需求方发起'],
    [S.DRAFT, S.OPEN, R.RESPONDER, '响应者不能替别人发单'],
    [S.OPEN, S.RESPONDED, R.OWNER, '被响应是响应动作的连带结果，需求方不能自己置为待选定'],
    [S.OPEN, S.CANCELLED, R.RESPONDER, '未选定阶段响应者与该单无绑定，不能取消他人的单'],
    [S.MATCHED, S.DONE, R.ADMIN, '完成只能由双方各自确认'],
    [S.MATCHED, S.CANCELLED, R.SYSTEM, '取消要记录取消方，不能由系统代做']
  ]

  assert.ok(forbidden.length >= 8, '越权用例不得少于 8 条')

  for (const [from, to, actor, why] of forbidden) {
    assert.equal(canActorTransition(from, to, actor), false, `${actor} 不应能做 ${from} → ${to}：${why}`)
    assert.throws(
      () => assertTransitionByActor(from, to, actor),
      err => {
        assert.equal(err.code, TRANSITION_ERROR.TRANSITION_FORBIDDEN, why)
        assert.equal(err.from, from)
        assert.equal(err.to, to)
        assert.equal(err.actor, actor)
        return true
      },
      `${actor} 做 ${from} → ${to} 应抛 TRANSITION_FORBIDDEN：${why}`
    )
  }
})

test('撤销选定只有需求方能做（D-35）', () => {
  assert.equal(canActorTransition(S.MATCHED, S.RESPONDED, R.OWNER), true)
  // 响应者不想继续时走取消，而不是把自己从"被选中"里摘出去——否则需求方会莫名回到待选定
  assert.equal(canActorTransition(S.MATCHED, S.RESPONDED, R.RESPONDER), false)
  assert.equal(canActorTransition(S.MATCHED, S.RESPONDED, R.SYSTEM), false)
  assert.equal(canActorTransition(S.MATCHED, S.RESPONDED, R.ADMIN), false)
})

test('错误码能区分「转移非法」与「转移合法但没权限」', () => {
  // 转移本身非法：即使角色是 owner 也要报 ILLEGAL_TRANSITION，而不是笼统说没权限
  // 注意：matched → responded 自 D-35 起是合法的（撤销选定），这里换成真正非法的 matched → open
  assert.throws(
    () => assertTransitionByActor(S.MATCHED, S.OPEN, R.OWNER),
    err => err.code === TRANSITION_ERROR.ILLEGAL_TRANSITION
  )
  // 转移合法但角色不对：报 TRANSITION_FORBIDDEN
  assert.throws(
    () => assertTransitionByActor(S.RESPONDED, S.MATCHED, R.RESPONDER),
    err => err.code === TRANSITION_ERROR.TRANSITION_FORBIDDEN
  )
  // 状态未知：报 UNKNOWN_STATUS，优先级最高
  assert.throws(
    () => assertTransitionByActor('pending', S.OPEN, R.OWNER),
    err => err.code === TRANSITION_ERROR.UNKNOWN_STATUS
  )
})

test('未知角色被拒，错误码为 UNKNOWN_ACTOR', () => {
  for (const bad of ['Owner', 'user', 'root', '', null, undefined]) {
    assert.equal(isKnownActor(bad), false)
    assert.equal(canActorTransition(S.DRAFT, S.OPEN, bad), false)
    assert.throws(
      () => assertTransitionByActor(S.DRAFT, S.OPEN, bad),
      err => err.code === TRANSITION_ERROR.UNKNOWN_ACTOR,
      `角色 ${bad} 应抛 UNKNOWN_ACTOR`
    )
  }
})

test('权限矩阵每个格子（合法转移 × 四角色）都被断言覆盖', () => {
  let checked = 0
  for (const [from, to] of legalEdges) {
    for (const actor of ACTOR_ROLE_VALUES) {
      const expected = allowedActors(from, to).includes(actor)
      assert.equal(canActorTransition(from, to, actor), expected, `${actor} × ${from} → ${to}`)
      checked += 1
    }
  }
  assert.equal(checked, 13 * 4, '13 条合法边 × 4 个角色')
})

test('对非法转移的任何角色都返回 false，不因角色是 admin 就放行', () => {
  const legalSet = new Set(legalEdges.map(([from, to]) => edgeKey(from, to)))
  for (const from of REQUEST_STATUS_VALUES) {
    for (const to of REQUEST_STATUS_VALUES) {
      if (legalSet.has(edgeKey(from, to))) continue
      for (const actor of ACTOR_ROLE_VALUES) {
        assert.equal(canActorTransition(from, to, actor), false, `${actor} 不应能做非法转移 ${from} → ${to}`)
      }
    }
  }
})

test('权限表与其中的角色数组都是冻结的', () => {
  assert.equal(Object.isFrozen(PERMISSIONS), true)
  assert.equal(Object.isFrozen(PERMISSIONS[edgeKey(S.MATCHED, S.DONE)]), true)
  assert.throws(() => {
    'use strict'
    PERMISSIONS[edgeKey(S.OPEN, S.REMOVED)] = [R.OWNER]
  })
})
