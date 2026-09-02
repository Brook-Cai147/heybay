/**
 * knowledge 集合的数据存取（M2-09）。**不含打分逻辑** —— 打分在 `service/knowledgeSearch.js`。
 *
 * 为什么不在数据库里做检索：云数据库没有全文索引，中文分词也做不了。
 * 所以这一层只负责"把候选捞回来"（按城市 + 标签命中窄化），排序与打分在内存里算。
 * 单城语料是几十到上千条量级，全量捞回来再打分完全可行 —— 超过这个量级才需要向量库
 * （tech-stack 6.2 的升级点，见 knowledgeSearch.js 顶部注释）。
 */

const { COLLECTION, getDb, getCommand, NOT_DELETED, withCreateStamps, withUpdateStamps } = require('./db')

const collection = () => getDb().collection(COLLECTION.KNOWLEDGE)

/** 一次最多捞多少条候选。够覆盖单城语料，又不会把一次异常查询变成一次额度事故 */
const CANDIDATE_LIMIT = 200

/**
 * 按城市取候选语料。
 *
 * @param {object} options
 * @param {string} options.city   城市 code（`london`）
 * @param {string[]} [options.tags] 有值时先按标签窄化（命中 `city + tags` 索引）；
 *        为空则取该城市全部 —— 标签提取失败不该让检索直接返回空
 * @param {number} [options.limit]
 */
const listCandidates = async ({ city, tags = [], limit = CANDIDATE_LIMIT }) => {
  const _ = getCommand()
  const where = Object.assign({ city }, NOT_DELETED)
  if (Array.isArray(tags) && tags.length) where.tags = _.in(tags)

  const res = await collection().where(where).limit(limit).get()
  return res.data
}

/** 按 refId 查一条；不存在返回 null */
const findByRefId = async refId => {
  const res = await collection()
    .where(Object.assign({ refId }, NOT_DELETED))
    .limit(1)
    .get()
  return res.data.length ? res.data[0] : null
}

/**
 * 按 refId 有则更新无则新建。播种要能反复跑 ——
 * 改了一条语料的答案就重跑一次，不用先删集合（删集合会把 `sourceKind: 'request'`
 * 那类从真实需求单沉淀来的语料一起删掉）。
 */
const upsertByRefId = async (doc, isTest = false) => {
  const existing = await findByRefId(doc.refId)
  if (existing) {
    await collection().doc(existing._id).update({ data: withUpdateStamps(doc) })
    return { action: 'updated', _id: existing._id }
  }
  const res = await collection().add({ data: withCreateStamps(doc, isTest) })
  return { action: 'created', _id: res._id }
}

const countByCity = async city => {
  const res = await collection()
    .where(Object.assign({ city }, NOT_DELETED))
    .count()
  return res.total
}

module.exports = {
  CANDIDATE_LIMIT,
  listCandidates,
  findByRefId,
  upsertByRefId,
  countByCity
}
