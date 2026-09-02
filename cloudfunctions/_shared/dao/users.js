/**
 * users 集合的数据存取。**不含业务判断** —— 谁能改、改了合不合规由 service 决定。
 *
 * 标识字段一律是 openid（D-33），且只能由云函数从 `cloud.getWXContext()` 取，
 * 永不接受端侧传入的 openid。dao 层信任调用方已经做过这件事。
 */

const { COLLECTION, getDb, getCommand, NOT_DELETED, withCreateStamps, withUpdateStamps } = require('./db')

const collection = () => getDb().collection(COLLECTION.USERS)

/** 按 openid 查用户；不存在返回 null */
const findByOpenid = async openid => {
  const res = await collection()
    .where(Object.assign({ openid }, NOT_DELETED))
    .limit(1)
    .get()
  return res.data.length ? res.data[0] : null
}

/**
 * 插入用户档案。openid 上有唯一索引，并发重复插入会被数据库拒绝 ——
 * 这是登录幂等的物理兜底，service 层要捕获冲突后改为读取（见 userService）。
 */
const insert = async (data, isTest) => {
  const res = await collection().add({ data: withCreateStamps(data, isTest) })
  return res._id
}

/** 按 openid 更新；返回实际被更新的条数 */
const updateByOpenid = async (openid, data) => {
  const res = await collection()
    .where({ openid })
    .update({ data: withUpdateStamps(data) })
  return res.stats ? res.stats.updated : 0
}

/** 计数字段自增（如取消次数、完成单数），字段不存在时从 0 起算 */
const incCounter = async (openid, field, delta = 1) => {
  return updateByOpenid(openid, { [field]: getCommand().inc(delta) })
}

/**
 * 某城市的用户（M2-11 的候选池）。
 *
 * 只按城市捞，**打分与过滤都在 service** —— 云数据库排不了"加权得分"这种序，
 * 而单城用户在 M2 阶段是几十到几百人的量级，全捞回来打分完全可行。
 * 上限是硬保险：一次异常查询把免费额度吃光比少推几个人严重得多。
 */
const listByCity = async ({ city, limit = 200 }) => {
  const res = await collection()
    .where(Object.assign({ city }, NOT_DELETED))
    .limit(limit)
    .get()
  return res.data
}

module.exports = {
  findByOpenid,
  insert,
  updateByOpenid,
  incCounter,
  listByCity
}
