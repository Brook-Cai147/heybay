/**
 * requests 集合的数据存取。**不含业务判断**（状态该不该变、单子能不能发，由 requestService 定）。
 *
 * 写方法都接受一个可选的 transaction 句柄：状态变更必须与 statusLogs 写入同生共死，
 * 所以 requestService 会开事务并把句柄透传下来（见 requestService.transitionRequest）。
 */

const { COLLECTION, getDb, getCommand, NOT_DELETED, withCreateStamps, withUpdateStamps } = require('./db')
const { REQUEST_STATUS } = require('../constants/enums')

/** tx 为空时用普通 db 句柄，两者的 collection API 一致 */
const collection = tx => (tx || getDb()).collection(COLLECTION.REQUESTS)

/** 在架状态：只有这两个状态占用同城在架名额（PRD 4.1 规则 4） */
const ACTIVE_STATUSES = Object.freeze([REQUEST_STATUS.OPEN, REQUEST_STATUS.RESPONDED])

const insert = async (data, isTest, tx) => {
  const res = await collection(tx).add({ data: withCreateStamps(data, isTest) })
  // 事务版 add 返回 { id }，普通版返回 { _id }
  return res._id || res.id
}

/** 按 _id 查；不存在或已软删除返回 null。事务内读会加锁，用于状态的 compare-and-set */
const findById = async (id, tx) => {
  try {
    const res = await collection(tx).doc(id).get()
    if (!res.data || res.data.deletedAt) return null
    return res.data
  } catch (err) {
    // 文档不存在时云数据库直接抛错，这里统一成 null，让 service 给出业务化提示
    return null
  }
}

/** 按 _id 更新，返回被更新的条数 */
const updateById = async (id, data, tx) => {
  const res = await collection(tx).doc(id).update({ data: withUpdateStamps(data) })
  return res.stats ? res.stats.updated : 1
}

/** 某人在某城市当前在架的需求单数量（发布前的上限校验用） */
const countActiveByOwnerCity = async (ownerOpenid, city) => {
  const _ = getCommand()
  const res = await collection()
    .where(Object.assign({ ownerOpenid, city, status: _.in(ACTIVE_STATUSES) }, NOT_DELETED))
    .count()
  return res.total
}

/** 响应计数 +delta（详情页要展示"已有 N 人响应"，避免每次都 count 一遍 responses） */
const incResponseCount = async (id, delta, tx) => {
  return updateById(id, { responseCount: getCommand().inc(delta) }, tx)
}

module.exports = {
  ACTIVE_STATUSES,
  insert,
  findById,
  updateById,
  countActiveByOwnerCity,
  incResponseCount
}
