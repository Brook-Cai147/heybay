/**
 * responses 集合的数据存取。**不含业务判断**（能不能响应由 responseService 定）。
 *
 * `requestId + responderOpenid` 上有唯一索引（M1-07），是幂等的物理兜底：
 * 即使 service 的预检查被并发绕过，数据库也不会留下第二条响应。
 */

const { COLLECTION, getDb, NOT_DELETED, withCreateStamps, withUpdateStamps } = require('./db')

const collection = tx => (tx || getDb()).collection(COLLECTION.RESPONSES)

const insert = async (data, isTest, tx) => {
  const res = await collection(tx).add({ data: withCreateStamps(data, isTest) })
  return res._id || res.id
}

/** 同一人对同一单的响应；不存在返回 null */
const findByRequestAndResponder = async (requestId, responderOpenid) => {
  const res = await collection()
    .where(Object.assign({ requestId, responderOpenid }, NOT_DELETED))
    .limit(1)
    .get()
  return res.data.length ? res.data[0] : null
}

/** 某单的响应列表，按创建时间升序（M1-17 的响应列表；M2 上信任分后再改排序） */
const listByRequest = async (requestId, limit = 50) => {
  const res = await collection()
    .where(Object.assign({ requestId }, NOT_DELETED))
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get()
  return res.data
}

const countByRequest = async requestId => {
  const res = await collection()
    .where(Object.assign({ requestId }, NOT_DELETED))
    .count()
  return res.total
}

const updateById = async (id, data, tx) => {
  const res = await collection(tx).doc(id).update({ data: withUpdateStamps(data) })
  return res.stats ? res.stats.updated : 1
}

module.exports = {
  insert,
  findByRequestAndResponder,
  listByRequest,
  countByRequest,
  updateById
}
