/**
 * invites 集合的数据存取（M2-14）。站内定向邀请。
 *
 * **为什么不是订阅消息**：订阅消息整块归 M4（D-30），而 L0/L1 的行为差异要在 M2 就能验证。
 * 站内邀请落成一条记录、在消息 Tab 里能看到，就足够验证"邀请必经用户勾选"这条红线。
 *
 * `requestId + inviteeOpenid` 上应建唯一索引：同一条单不该重复邀请同一个人 ——
 * 重复邀请在对方眼里就是骚扰，而这是靠数据库拦最省事的一类约束。
 */

const { COLLECTION, getDb, getCommand, NOT_DELETED, withCreateStamps, withUpdateStamps } = require('./db')

const collection = () => getDb().collection(COLLECTION.INVITES)

/** 一条邀请。`text` 是模型起草、**用户勾选后**才落库的文案 */
const insert = async (data, isTest = false) => {
  const res = await collection().add({ data: withCreateStamps(data, isTest) })
  return res._id
}

/** 同一条单已经邀请过的人，用来去重（不依赖端侧自己记） */
const listByRequest = async requestId => {
  const res = await collection()
    .where(Object.assign({ requestId }, NOT_DELETED))
    .limit(50)
    .get()
  return res.data
}

/** 我收到的邀请（消息 Tab 用），按时间倒序 */
const listByInvitee = async (inviteeOpenid, limit = 20) => {
  const res = await collection()
    .where(Object.assign({ inviteeOpenid }, NOT_DELETED))
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get()
  return res.data
}

/** 标记这条邀请已被查看 / 已响应。`respondedAt` 是 L1→L2 询问的触发依据（D-14） */
const markState = async (id, patch) => {
  const res = await collection().doc(id).update({ data: withUpdateStamps(patch) })
  return res.stats ? res.stats.updated : 1
}

/** 某条单的邀请有没有换来响应，用于统计 L1 的实际效果（PRD 7.3） */
const countResponded = async requestId => {
  const _ = getCommand()
  const res = await collection()
    .where(Object.assign({ requestId, respondedAt: _.neq(null) }, NOT_DELETED))
    .count()
  return res.total
}

module.exports = {
  insert,
  listByRequest,
  listByInvitee,
  markState,
  countResponded
}
