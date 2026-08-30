/**
 * 需求单相关的端侧服务（M1-09）。**一个云函数动作对应一个方法**，页面只调这里。
 *
 * 发布前页面应先跑一遍 `models/schema.js` 的校验（为体验），
 * 但服务端会独立再校验一遍（为安全）—— 两者都不能省。
 */

const { callAction } = require('./cloud')
const { REQUEST_STATUS } = require('../models/enums')

const FUNCTION_NAME = 'requestFlow'

/**
 * 发布需求单（draft → open）。
 * @param {object} draft 需求单字段；可带 `fieldSources` 标记各字段来源（user / ai / empty），
 *                       其中金额、期望时间、地点、联系方式若标为 ai 会被服务端拒绝（PRD 5.4）
 */
const create = draft => callAction(FUNCTION_NAME, 'create', draft)

/** 状态变更的唯一入口；角色由服务端按 openid 判定，端侧不传角色 */
const transition = (requestId, to, reason) =>
  callAction(FUNCTION_NAME, 'transitionRequest', { requestId, to, reason })

/** 取消自己的需求单 */
const cancel = (requestId, reason) => transition(requestId, REQUEST_STATUS.CANCELLED, reason)

/** 需求单详情 */
const getDetail = requestId => callAction(FUNCTION_NAME, 'getDetail', { requestId })

module.exports = {
  create,
  transition,
  cancel,
  getDetail
}
