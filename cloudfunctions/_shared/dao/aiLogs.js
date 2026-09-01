/**
 * aiLogs 集合的数据存取（M2-04）。
 *
 * 这张表同时承担三件事，所以字段比一般日志多：
 *   1. **成本核算** —— PRD 5.5 要求"每次成功撮合的 AI token 成本 ≤0.10 元"，没有逐次记账就算不出来
 *   2. **额度计数** —— M2-01 的额度判定需要"当日已用量"，用量的真源就是这张表（`dayKey` + `quotaCounted`）
 *   3. **采纳率评测** —— `adopted` 先留空，用户确认解析结果后回填（M2-08），这是"AI 有没有用"的唯一硬指标
 *
 * 写入永不阻塞主流程：记账失败只打日志，不能让一次成功的 AI 调用因为写日志失败而返回错误。
 */

const { COLLECTION, getDb, serverDate } = require('./db')

const collection = () => getDb().collection(COLLECTION.AI_LOGS)

/**
 * 记一次 AI 调用。
 * @param {object} log 已由 service 组装好的记录（handler / service 决定语义，dao 不加工业务字段）
 */
const insert = async (log, isTest = false) => {
  const doc = Object.assign(
    {
      openid: '',
      capability: '',
      dayKey: '',
      // 是否计入当日额度：命中缓存、被额度拦下、系统档调用都不计
      quotaCounted: false,
      modelTier: '',
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      latencyMs: 0,
      attempts: 1,
      result: '',
      fromCache: false,
      // 用户有没有采纳 AI 的输出，M2-08 回填；null = 还不知道
      adopted: null,
      errorCode: null
    },
    log,
    { createdAt: serverDate() }
  )
  if (isTest === true) doc._isTest = true
  const added = await collection().add({ data: doc })
  return added._id
}

/**
 * 某人某能力在某个「当地日」已成功用掉几次。
 * 只数 `quotaCounted: true` —— 缓存命中与被拦下的调用没花钱，不该占额度。
 */
const countUsedToday = async ({ openid, capability, dayKey }) => {
  const res = await collection()
    .where({ openid, capability, dayKey, quotaCounted: true })
    .count()
  return res.total
}

/** 当日全局成本合计，供 M2-05 的成本护栏用 */
const sumCostByDay = async dayKey => {
  const $ = getDb().command.aggregate
  const res = await collection()
    .aggregate()
    .match({ dayKey })
    .group({ _id: null, total: $.sum('$cost') })
    .end()
  return res.list.length ? res.list[0].total : 0
}

/** 回填「用户是否采纳」（M2-08 用） */
const markAdopted = async (logId, adopted) => {
  await collection().doc(logId).update({ data: { adopted: adopted === true } })
}

module.exports = {
  insert,
  countUsedToday,
  sumCostByDay,
  markAdopted
}
