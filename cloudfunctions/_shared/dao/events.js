/**
 * events 集合的数据存取 —— 埋点流水。只增不改不删。
 *
 * 写失败绝不能影响主流程（M1-13：埋点不阻断业务），所以这里不做重试、不抛业务错误，
 * 由 trackService 决定如何吞掉失败。
 */

const { COLLECTION, getDb, withCreateStamps } = require('./db')

const collection = () => getDb().collection(COLLECTION.EVENTS)

const insert = async (data, isTest) => {
  const res = await collection().add({ data: withCreateStamps(data, isTest) })
  return res._id
}

module.exports = { insert }
