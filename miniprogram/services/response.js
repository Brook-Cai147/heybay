/**
 * 响应相关的端侧服务（M1-10）。**一个云函数动作对应一个方法**，页面只调这里。
 */

const { callAction } = require('./cloud')

const FUNCTION_NAME = 'responseFlow'

/**
 * 响应一条需求单。
 * @param {string} requestId
 * @param {object} [payload] `{ pitch, quote, source }`；source 取值见 models/enums 的 RESPONSE_SOURCE
 */
const submit = (requestId, payload = {}) =>
  callAction(FUNCTION_NAME, 'submit', Object.assign({ requestId }, payload))

/** 响应列表：需求方得到全部，其他人只得到自己那条 */
const list = requestId => callAction(FUNCTION_NAME, 'list', { requestId })

module.exports = {
  submit,
  list
}
