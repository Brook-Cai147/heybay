/**
 * 全项目枚举的权威副本（云侧）。
 *
 * 端侧副本在 `miniprogram/models/enums.js`，两份必须键值完全一致 —— 小程序端无法
 * require 目录外文件，双份不可避免，靠 tests/enumsParity.test.js 的断言锁住漂移（D-27）。
 * 任何改动都要同时改两处。
 *
 * 业务代码禁止写状态、品类等字符串字面量，一律从这里取（tech-stack 第 1 节）。
 */

/** 需求单状态（PRD 4.1 状态机） */
const REQUEST_STATUS = {
  DRAFT: 'draft',           // 草稿
  OPEN: 'open',             // 招募中
  RESPONDED: 'responded',   // 待选定（已有响应）
  MATCHED: 'matched',       // 已确定（已选定响应者）
  DONE: 'done',             // 已完成（双方均确认）
  RATED: 'rated',           // 已评价 —— 登记但 M1 不使用，评价属 M3
  EXPIRED: 'expired',       // 已过期
  CANCELLED: 'cancelled',   // 已取消
  REMOVED: 'removed'        // 已下架（违规）
}

/** 需求单状态的全量取值，供校验与遍历用 */
const REQUEST_STATUS_VALUES = Object.freeze(Object.values(REQUEST_STATUS))

module.exports = {
  REQUEST_STATUS: Object.freeze(REQUEST_STATUS),
  REQUEST_STATUS_VALUES
}
