/**
 * 详情页的「谁在什么状态下能做什么」规则（纯逻辑，可在 node 里直接跑）。
 *
 * 为什么单独抽出来：这套判断散在页面里时，一个条件写错的表现是"按钮不出现"，
 * 而按钮不出现在界面上和"功能没做"长得一模一样 —— M1-17 就因此漏了一次
 * （响应者看不到「我这边已完成」）。抽成纯函数后它能被单测覆盖，错了会变红而不是变安静。
 *
 * 本文件不引用 `wx.*`，不做任何 IO。
 */

const { REQUEST_STATUS } = require('./enums')

/** 端侧的视角枚举：owner / responder 与云侧 ACTOR_ROLE 同名，visitor 是端侧特有 */
const VIEWER_ROLE = Object.freeze({
  OWNER: 'owner',
  RESPONDER: 'responder',
  VISITOR: 'visitor'
})

/** 可以被响应的状态 */
const ACCEPTING = Object.freeze([REQUEST_STATUS.OPEN, REQUEST_STATUS.RESPONDED])

/** 已经进入"双方在联系"的状态 —— 联系方式在这两个状态下才互相可见（D-36） */
const CONTACT_VISIBLE = Object.freeze([REQUEST_STATUS.MATCHED, REQUEST_STATUS.DONE])

/** 需求方可以取消的状态；响应者只能在 matched 取消（与云侧权限矩阵一致） */
const OWNER_CANCELLABLE = Object.freeze([
  REQUEST_STATUS.OPEN,
  REQUEST_STATUS.RESPONDED,
  REQUEST_STATUS.MATCHED
])

/**
 * @param {object} input
 * @param {string} input.status         需求单当前状态
 * @param {string} input.viewerRole     VIEWER_ROLE 之一
 * @param {boolean} [input.hasMyResponse] 当前用户是否已响应过这条单
 * @param {object} [input.doneConfirm]  `{ owner: boolean, responder: boolean }`
 * @returns {object} 各个动作是否可见/可用
 */
const resolveDetailActions = ({ status, viewerRole, hasMyResponse = false, doneConfirm = {} } = {}) => {
  const isOwner = viewerRole === VIEWER_ROLE.OWNER
  const isResponder = viewerRole === VIEWER_ROLE.RESPONDER
  const isParty = isOwner || isResponder

  const accepting = ACCEPTING.includes(status)
  const matched = status === REQUEST_STATUS.MATCHED

  const myDoneConfirmed = isOwner
    ? doneConfirm.owner === true
    : (isResponder ? doneConfirm.responder === true : false)
  const peerDoneConfirmed = isOwner
    ? doneConfirm.responder === true
    : (isResponder ? doneConfirm.owner === true : false)

  return {
    // 只有"既不是需求方也不是被选定者"的人才有响应入口，且没响应过、单子还收响应
    canRespond: viewerRole === VIEWER_ROLE.VISITOR && !hasMyResponse && accepting,
    // 待选定时才有选定按钮：open（还没人响应）时列表是空的，matched 时已经选完了
    canSelect: isOwner && status === REQUEST_STATUS.RESPONDED,
    // 撤销选定只有需求方、且只在 matched（D-35）
    canUnselect: isOwner && matched,
    // 确认完成：双方各自一次，自己确认过就不再显示按钮，改为显示等待状态
    canConfirmDone: isParty && matched && !myDoneConfirmed,
    myDoneConfirmed,
    peerDoneConfirmed,
    waitingForPeer: isParty && matched && myDoneConfirmed && !peerDoneConfirmed,
    canCancel: (isOwner && OWNER_CANCELLABLE.includes(status)) || (isResponder && matched),
    // 联系方式：双方之间、且已达成共识之后（D-36）
    canSeeContact: isParty && CONTACT_VISIBLE.includes(status),
    // 已响应但还没被选定时给一句状态说明，避免页面看起来什么都没发生
    showRespondedHint: viewerRole === VIEWER_ROLE.VISITOR && hasMyResponse && accepting
  }
}

module.exports = {
  VIEWER_ROLE,
  ACCEPTING,
  CONTACT_VISIBLE,
  OWNER_CANCELLABLE,
  resolveDetailActions
}
