/**
 * 详情页动作可见性单测（`tech-stack.md` 第 10 节第 7 块，D-29）。
 *
 * 为什么这块值得测：它的失效形态是"按钮不出现"，不报错、不崩，
 * 在界面上和"功能还没做"长得一模一样 —— 只能靠人逐个视角点出来，而这已经真实漏过一次。
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { REQUEST_STATUS: S } = require('../miniprogram/models/enums')
const { VIEWER_ROLE: V, resolveDetailActions } = require('../miniprogram/models/viewRules')

const at = (status, viewerRole, extra = {}) =>
  resolveDetailActions(Object.assign({ status, viewerRole }, extra))

test('游客：只在 open / responded 且自己没响应过时才有响应入口', () => {
  assert.equal(at(S.OPEN, V.VISITOR).canRespond, true)
  assert.equal(at(S.RESPONDED, V.VISITOR).canRespond, true)
  for (const status of [S.DRAFT, S.MATCHED, S.DONE, S.RATED, S.EXPIRED, S.CANCELLED, S.REMOVED]) {
    assert.equal(at(status, V.VISITOR).canRespond, false, `${status} 不该有响应入口`)
  }
})

test('游客已响应过：响应入口消失，改为显示已响应提示', () => {
  const a = at(S.RESPONDED, V.VISITOR, { hasMyResponse: true })
  assert.equal(a.canRespond, false)
  assert.equal(a.showRespondedHint, true)
  // 没响应过时不该显示这条提示
  assert.equal(at(S.RESPONDED, V.VISITOR).showRespondedHint, false)
})

test('需求方与被选定的响应者都没有响应入口', () => {
  assert.equal(at(S.OPEN, V.OWNER).canRespond, false)
  assert.equal(at(S.MATCHED, V.RESPONDER).canRespond, false)
})

test('选定按钮：只有需求方、只在 responded', () => {
  assert.equal(at(S.RESPONDED, V.OWNER).canSelect, true)
  assert.equal(at(S.OPEN, V.OWNER).canSelect, false, 'open 时响应列表是空的')
  assert.equal(at(S.MATCHED, V.OWNER).canSelect, false, '已经选完了')
  assert.equal(at(S.RESPONDED, V.VISITOR).canSelect, false)
})

test('撤销选定：只有需求方、只在 matched（D-35）', () => {
  assert.equal(at(S.MATCHED, V.OWNER).canUnselect, true)
  assert.equal(at(S.MATCHED, V.RESPONDER).canUnselect, false)
  assert.equal(at(S.RESPONDED, V.OWNER).canUnselect, false)
  assert.equal(at(S.DONE, V.OWNER).canUnselect, false)
})

test('确认完成：双方在 matched 各自一次；这正是之前漏掉的那个按钮', () => {
  assert.equal(at(S.MATCHED, V.OWNER).canConfirmDone, true)
  assert.equal(at(S.MATCHED, V.RESPONDER).canConfirmDone, true, '响应者也必须能看到这个按钮')
  assert.equal(at(S.MATCHED, V.VISITOR).canConfirmDone, false)
  assert.equal(at(S.RESPONDED, V.OWNER).canConfirmDone, false)
  assert.equal(at(S.DONE, V.OWNER).canConfirmDone, false)
})

test('自己确认过之后：按钮消失，转为等待对方', () => {
  const owner = at(S.MATCHED, V.OWNER, { doneConfirm: { owner: true, responder: false } })
  assert.equal(owner.canConfirmDone, false)
  assert.equal(owner.myDoneConfirmed, true)
  assert.equal(owner.peerDoneConfirmed, false)
  assert.equal(owner.waitingForPeer, true, '按钮消失后必须有等待态，否则整张卡看起来像坏了')

  // 同一份数据在响应者视角要反过来读
  const responder = at(S.MATCHED, V.RESPONDER, { doneConfirm: { owner: true, responder: false } })
  assert.equal(responder.canConfirmDone, true)
  assert.equal(responder.myDoneConfirmed, false)
  assert.equal(responder.peerDoneConfirmed, true)
  assert.equal(responder.waitingForPeer, false)
})

test('取消：需求方在 open/responded/matched 都能取消，响应者只能在 matched', () => {
  for (const status of [S.OPEN, S.RESPONDED, S.MATCHED]) {
    assert.equal(at(status, V.OWNER).canCancel, true, `owner 应能在 ${status} 取消`)
  }
  for (const status of [S.DONE, S.RATED, S.EXPIRED, S.CANCELLED, S.REMOVED]) {
    assert.equal(at(status, V.OWNER).canCancel, false, `${status} 不该还能取消`)
  }
  assert.equal(at(S.MATCHED, V.RESPONDER).canCancel, true)
  assert.equal(at(S.RESPONDED, V.RESPONDER).canCancel, false)
  assert.equal(at(S.MATCHED, V.VISITOR).canCancel, false)
})

test('联系方式只在 matched / done、且只对双方可见（D-36）', () => {
  assert.equal(at(S.MATCHED, V.OWNER).canSeeContact, true)
  assert.equal(at(S.MATCHED, V.RESPONDER).canSeeContact, true)
  assert.equal(at(S.DONE, V.OWNER).canSeeContact, true, '完成后仍要能联系上，比如落东西了')
  assert.equal(at(S.MATCHED, V.VISITOR).canSeeContact, false, '第三方永远看不到')
  assert.equal(at(S.RESPONDED, V.OWNER).canSeeContact, false, '还没达成共识')
  assert.equal(at(S.CANCELLED, V.OWNER).canSeeContact, false)
})

test('入参缺失时不抛错，全部动作一律关闭（页面加载中也会调到）', () => {
  const empty = resolveDetailActions()
  for (const [key, value] of Object.entries(empty)) {
    assert.equal(value, false, `${key} 在无入参时应为 false`)
  }
})
