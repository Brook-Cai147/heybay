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

/**
 * 某人在某城市当前在架的需求单数量（发布前的上限校验用）。
 *
 * **必须按 `expireAt` 过滤**，与 `listOpenByCity` 用同一个"在架"口径：
 * 过期扫描是定时任务（即时型 10 分钟一轮），总有一段时间里单子已过期而 `status` 还是 open。
 * 不过滤的话，用户在广场上看到自己只挂着 1 条、发新单却被拦"最多挂 3 条" ——
 * 同一个"在架"有两种口径，而用户能看到的那个才是对的。真机验证撞上过这条。
 *
 * @param {number} [nowMs] 判定时刻；不传则只按状态数
 */
const countActiveByOwnerCity = async (ownerOpenid, city, nowMs) => {
  const _ = getCommand()
  const where = Object.assign({ ownerOpenid, city, status: _.in(ACTIVE_STATUSES) }, NOT_DELETED)
  if (nowMs) where.expireAt = _.gt(new Date(nowMs))
  const res = await collection().where(where).count()
  return res.total
}

/** 响应计数 +delta（详情页要展示"已有 N 人响应"，避免每次都 count 一遍 responses） */
const incResponseCount = async (id, delta, tx) => {
  return updateById(id, { responseCount: getCommand().inc(delta) }, tx)
}

/**
 * 需求广场列表查询（M1-16）。
 *
 * where 条件的字段顺序刻意与 `city + status + expireAt` 索引一致，让查询能命中索引；
 * 「未过期」用 `expireAt > now` 而不是靠定时任务已经把过期单改状态 —— 定时任务有最长 10 分钟
 * 的延迟窗口，那段时间里过期单不该还挂在广场上。
 *
 * @param {object} options
 * @param {string} options.city
 * @param {string} [options.category]     品类筛选，空表示全部
 * @param {number} options.nowMs          当前时间，由调用方显式传入
 * @param {boolean} [options.includeTest] 是否包含 `_isTest` 数据（联调期为 true）
 * @param {number} [options.limit]
 * @param {number} [options.skip]
 */
const listOpenByCity = async ({ city, category, nowMs, includeTest = false, limit = 20, skip = 0 }) => {
  const _ = getCommand()
  const where = {
    city,
    status: _.in(ACTIVE_STATUSES),
    expireAt: _.gt(new Date(nowMs)),
    deletedAt: null
  }
  if (category) where.category = category
  // 未包含测试数据时用 `_.neq(true)`：它同时匹配"字段为 false"与"字段不存在"，正是想要的语义
  if (!includeTest) where._isTest = _.neq(true)

  const res = await collection()
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()
  return res.data
}


/**
 * 某人发布的需求单（「我发布的」列表用）。
 *
 * 与广场不同，这里**不筛状态、不筛过期** —— 自己的单子无论过期、取消还是已完成都要能找回来，
 * 这是用户回看自己做过什么的唯一入口。命中 `ownerOpenid + status` 索引的前缀。
 */
const listByOwner = async ({ ownerOpenid, includeTest = false, limit = 20, skip = 0 }) => {
  const _ = getCommand()
  const where = Object.assign({ ownerOpenid }, NOT_DELETED)
  if (!includeTest) where._isTest = _.neq(true)

  const res = await collection()
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()
  return res.data
}

/**
 * 按一组 _id 批量取（「我响应的」列表：先查响应拿到 requestId，再一次取回需求单）。
 * 逐个 `findById` 会打出 N 次数据库调用，免费额度下不值得。
 */
const listByIds = async ids => {
  if (!Array.isArray(ids) || !ids.length) return []
  const _ = getCommand()
  const res = await collection()
    .where(Object.assign({ _id: _.in(ids) }, NOT_DELETED))
    .limit(ids.length)
    .get()
  return res.data
}

/**
 * 待过期的需求单（M1-18 的定时扫描用）：仍在架、且 `expireAt` 已经过去。
 *
 * 单次处理条数必须有上限 —— 一次异常扫描把免费额度的调用次数吃光，比晚十分钟过期严重得多。
 * 处理不完下一轮继续（本查询天然幂等：已改成 expired 的单不会再被选出来）。
 *
 * @param {string} [timing] 只扫某种时效类型（即时型 10 分钟一轮、预约型 1 小时一轮），空表示全部
 */
const listExpiredCandidates = async ({ timing, nowMs, limit = 50 }) => {
  const _ = getCommand()
  const where = {
    status: _.in(ACTIVE_STATUSES),
    expireAt: _.lte(new Date(nowMs)),
    deletedAt: null
  }
  if (timing) where.timing = timing

  const res = await collection()
    .where(where)
    .orderBy('expireAt', 'asc') // 先处理过期最久的
    .limit(limit)
    .get()
  return res.data
}

module.exports = {
  ACTIVE_STATUSES,
  insert,
  findById,
  updateById,
  countActiveByOwnerCity,
  incResponseCount,
  listOpenByCity,
  listByOwner,
  listByIds,
  listExpiredCandidates
}
