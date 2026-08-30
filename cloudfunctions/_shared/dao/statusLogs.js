/**
 * statusLogs 集合的数据存取 —— 需求单状态变更的审计流水。
 *
 * 只增不改：审计记录一旦写下就不再变动，所以这里**没有** update 方法。
 * 写入必须与需求单本身的状态更新在同一个事务里（见 requestService.transitionRequest）：
 * 允许状态变了却没有审计，等于允许纠纷时无从追溯。
 */

const { COLLECTION, getDb, withCreateStamps } = require('./db')

const collection = tx => (tx || getDb()).collection(COLLECTION.STATUS_LOGS)

const insert = async (data, isTest, tx) => {
  const res = await collection(tx).add({ data: withCreateStamps(data, isTest) })
  return res._id || res.id
}

/** 某单的状态变更历史，按时间升序 */
const listByRequest = async (requestId, limit = 50) => {
  const res = await collection()
    .where({ requestId })
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get()
  return res.data
}

module.exports = {
  insert,
  listByRequest
}
