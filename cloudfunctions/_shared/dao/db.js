/**
 * 数据库句柄与公共约定（dao 层内部使用，service 层不直接 require 本文件）。
 *
 * 分层铁律（tech-stack 第 3 节）：**只有 dao 目录能接触云数据库 API**。
 * service 里出现 `db.collection(...)` 就是越层了，改动时请把查询下沉到对应的 dao。
 */

const cloud = require('wx-server-sdk')

/** 集合名统一在此登记，避免各处手写字符串拼错（M1-07 建的六个集合，M2-04 加 aiLogs） */
const COLLECTION = Object.freeze({
  USERS: 'users',
  REQUESTS: 'requests',
  RESPONSES: 'responses',
  STATUS_LOGS: 'statusLogs',
  EVENTS: 'events',
  CONFIGS: 'configs',
  AI_LOGS: 'aiLogs'
})

/**
 * 延迟取 db：`cloud.init` 由各云函数入口负责，模块加载时可能还没 init 完。
 * 每次调用 `cloud.database()` 开销极小，不做缓存反而更安全。
 */
const getDb = () => cloud.database()

/** 查询指令（db.command），如 `_.in([...])`、`_.inc(1)` */
const getCommand = () => cloud.database().command

/** 服务端时间。**业务时间一律用它，不用客户端传来的时间**（端侧时钟不可信） */
const serverDate = () => cloud.database().serverDate()

/**
 * 软删除过滤条件（tech-stack 第 4 节：不做物理删除，纠纷追溯需要证据）。
 *
 * 云数据库底层是 MongoDB 语义，`{ deletedAt: null }` 同时匹配"字段为 null"与"字段不存在"，
 * 所以新文档不必显式写 `deletedAt: null` 也能被查到。
 */
const NOT_DELETED = Object.freeze({ deletedAt: null })

/** 给写入补上时间戳；`_isTest` 由调用方显式传入，dao 不自己猜 */
const withCreateStamps = (data, isTest) => {
  const doc = Object.assign({}, data, { createdAt: serverDate(), updatedAt: serverDate() })
  if (isTest === true) doc._isTest = true
  return doc
}

/** 给更新补上 updatedAt */
const withUpdateStamps = data => Object.assign({}, data, { updatedAt: serverDate() })

module.exports = {
  COLLECTION,
  getDb,
  getCommand,
  serverDate,
  NOT_DELETED,
  withCreateStamps,
  withUpdateStamps
}
