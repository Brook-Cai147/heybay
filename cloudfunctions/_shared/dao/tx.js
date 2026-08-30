/**
 * 事务句柄。单独一个文件，是为了让 service 能开事务而**不 require 整个 db.js**
 * （db.js 是 dao 内部用的，service 直接用它就容易顺手写出 `db.collection(...)` 而越层）。
 *
 * 用在需求单状态变更上：状态更新与审计日志必须同生共死（M1-09 的明确要求）。
 */

const cloud = require('wx-server-sdk')

/** 开一个数据库事务。事务内的 get 会加锁，因此也是状态 compare-and-set 的实现手段 */
const startTransaction = () => cloud.database().startTransaction()

module.exports = { startTransaction }
