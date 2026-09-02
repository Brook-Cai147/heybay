/**
 * M2-14 自主性阶梯单测（D-14）。
 *
 * 这一层守的是本项目最核心的一条产品主张：**自主性由用户选择，不是产品单方决定**。
 * 三类错都不会报错：
 *   L0 能发邀请 → 档位变成一个装饰性标签，主张就没了
 *   默认档算错 → 新用户第一单就被代发，正是这条主张要避免的
 *   L3 被放开 → AI 替人跟真人谈条件，出错时后果由用户承担
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AUTONOMY,
  AUTONOMY_VALUES,
  SELECTABLE,
  L0_FIRST_N_REQUESTS,
  DEFAULT_LEVEL,
  AUTONOMY_INFO,
  ladder,
  levelOf,
  canSendInvites,
  rejectReasonOf
} = require('../cloudfunctions/_shared/ai/autonomy')

test('可选档位只有 L0 与 L1；L2 是占位、L3 永不实现', () => {
  assert.deepEqual(SELECTABLE, [AUTONOMY.L0, AUTONOMY.L1])
  assert.equal(AUTONOMY_INFO[AUTONOMY.L2].selectable, false)
  assert.equal(AUTONOMY_INFO[AUTONOMY.L3].selectable, false)
  assert.deepEqual(AUTONOMY_VALUES, [AUTONOMY.L0, AUTONOMY.L1, AUTONOMY.L2])
})

test('每一档都要说清"能做什么 / 不能做什么"，不许只有一句概括（PRD 5.4 可解释）', () => {
  for (const info of ladder()) {
    assert.ok(info.name, `${info.level} 缺档位名`)
    assert.ok(info.summary, `${info.level} 缺一句话说明`)
    assert.ok(Array.isArray(info.cannot) && info.cannot.length > 0, `${info.level} 必须写明不会做什么`)
    assert.ok(info.defaultFor, `${info.level} 要说明默认值情况`)
  }
})

test('L3 必须带"为什么永不做"的理由，且要给用户看（D-14）', () => {
  const never = AUTONOMY_INFO[AUTONOMY.L3]
  assert.ok(never.whyNever && never.whyNever.length > 10)
  assert.match(never.whyNever, /责任|后果/, '理由要落在责任归属上，不是"技术上做不到"')
})

test('新用户前 3 单默认 L0，之后回到全局默认档 L1', () => {
  for (const count of [0, 1, 2]) {
    const res = levelOf({ publishedCount: count })
    assert.equal(res.level, AUTONOMY.L0, `发过 ${count} 单时应当是 L0`)
    assert.match(res.reason, /随时/, '默认档的解释里要写明可以改')
  }
  assert.equal(levelOf({ publishedCount: L0_FIRST_N_REQUESTS }).level, DEFAULT_LEVEL)
  assert.equal(DEFAULT_LEVEL, AUTONOMY.L1)
})

test('用户自己选过就以他的选择为准，且能从 L1 回退到 L0（PRD 5.4 可回退）', () => {
  const back = levelOf({ userLevel: AUTONOMY.L0, publishedCount: 99 })
  assert.equal(back.level, AUTONOMY.L0)
  assert.equal(back.reason, '你自己选的档位')
})

test('端侧传来一个不可选的档位时不采信，回落到默认规则', () => {
  assert.equal(levelOf({ userLevel: AUTONOMY.L3, publishedCount: 99 }).level, DEFAULT_LEVEL)
  assert.equal(levelOf({ userLevel: 'L9', publishedCount: 0 }).level, AUTONOMY.L0)
})

test('L0 与 L1 的唯一行为差异：能不能发出邀请', () => {
  assert.equal(canSendInvites(AUTONOMY.L0), false, 'L0 只读建议，一条都不许发')
  assert.equal(canSendInvites(AUTONOMY.L1), true)
  assert.equal(canSendInvites(AUTONOMY.L2), true)
  assert.equal(canSendInvites(AUTONOMY.L3), false)
})

test('设成不可选的档位时要给理由，而且 L2 与 L3 的理由不一样', () => {
  assert.equal(rejectReasonOf(AUTONOMY.L0), null)
  assert.equal(rejectReasonOf(AUTONOMY.L1), null)
  const l2 = rejectReasonOf(AUTONOMY.L2)
  const l3 = rejectReasonOf(AUTONOMY.L3)
  assert.match(l2, /还没做|M5/, 'L2 是"还没做"')
  assert.match(l3, /责任|后果/, 'L3 是"永不做"，理由完全不同')
  assert.notEqual(l2, l3)
  assert.match(rejectReasonOf('L9'), /没有/)
})
