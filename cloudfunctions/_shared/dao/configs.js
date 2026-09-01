/**
 * configs 集合的数据存取。
 *
 * 计划里 M1-08 只列了四个 dao，这一个是实现时补的：M1-09 的在架上限与城市时区都来自
 * `configs`（在架上限"改配置不改代码"是 M1-09 的明确要求），没有 dao 就得让 service 直接查库，
 * 那会破坏分层铁律。补一个只读 dao 是代价最小的做法。
 *
 * 写入方向只有 `setupService.seedConfigs`（M1-19 从 `ping` 搬过来的），
 * 且只能由 `cron` 在云端手动触发 —— 端侧永远不该写配置。
 */

const { COLLECTION, getDb, serverDate } = require('./db')

const collection = () => getDb().collection(COLLECTION.CONFIGS)

/** 按 key 取一条配置；不存在返回 null */
const findByKey = async key => {
  const res = await collection().where({ key }).limit(1).get()
  return res.data.length ? res.data[0] : null
}

/** 取配置的 value，不存在时返回 fallback（配置缺失不应让主流程崩） */
const getValue = async (key, fallback = null) => {
  const doc = await findByKey(key)
  return doc && doc.value !== undefined ? doc.value : fallback
}

/**
 * 按 key 写入一条配置：有则更新、无则新建（幂等，可反复跑）。
 * 配置**不带 `_isTest`** —— 带了会在清理联调数据时被误删。
 */
const upsertByKey = async (key, { value, desc }) => {
  const existing = await findByKey(key)
  if (existing) {
    await collection().doc(existing._id).update({
      data: { value, desc, updatedAt: serverDate() }
    })
    return { action: 'updated', _id: existing._id }
  }
  const added = await collection().add({
    data: { key, value, desc, createdAt: serverDate(), updatedAt: serverDate() }
  })
  return { action: 'created', _id: added._id }
}

module.exports = {
  findByKey,
  getValue,
  upsertByKey
}
