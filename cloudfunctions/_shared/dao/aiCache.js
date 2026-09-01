/**
 * aiCache 集合的数据存取（M2-05）。
 *
 * **对计划的一处补充**：M2-05 只列了 `ai/cache.js`，没提存储。但进程内缓存在云函数上几乎无效
 * —— 实例随时回收、并发时多实例各存一份，命中率低到不值得做。缓存的目的是省钱与省额度，
 * 不落库就达不到目的，所以补一个集合。代价是你要多建一个集合（见 architecture.md 的索引清单）。
 *
 * 过期不靠定时清理：读的时候比 `expireAt`，过期的当没命中。
 * 陈旧文档留着不删是有意的 —— 它是"这个问题被问过多少次"的免费统计，占的空间可忽略。
 */

const { COLLECTION, getDb, serverDate } = require('./db')

const collection = () => getDb().collection(COLLECTION.AI_CACHE)

/** 取一条未过期的缓存；过期或不存在都返回 null */
const findFresh = async (cacheKey, nowMs) => {
  const res = await collection().where({ cacheKey }).limit(1).get()
  if (!res.data.length) return null
  const doc = res.data[0]
  const expireAt = doc.expireAt ? new Date(doc.expireAt).getTime() : 0
  if (!expireAt || expireAt <= nowMs) return null
  return doc
}

/** 写入或刷新一条缓存（同 key 覆盖，不堆积历史版本） */
const upsert = async ({ cacheKey, capability, city, value, expireAtMs, hits = 0 }, isTest = false) => {
  const existing = await collection().where({ cacheKey }).limit(1).get()
  const data = {
    cacheKey,
    capability,
    city,
    value,
    expireAt: new Date(expireAtMs),
    hits,
    updatedAt: serverDate()
  }
  if (existing.data.length) {
    await collection().doc(existing.data[0]._id).update({ data })
    return existing.data[0]._id
  }
  const doc = Object.assign({ createdAt: serverDate() }, data)
  if (isTest === true) doc._isTest = true
  const added = await collection().add({ data: doc })
  return added._id
}

/** 命中计数。失败无所谓：统计不准比读缓存失败好得多 */
const bumpHits = async docId => {
  try {
    await collection().doc(docId).update({ data: { hits: getDb().command.inc(1) } })
  } catch (err) {
    console.error('[aiCache] 命中计数失败（忽略）', err && err.message)
  }
}

module.exports = {
  findFresh,
  upsert,
  bumpHits
}
