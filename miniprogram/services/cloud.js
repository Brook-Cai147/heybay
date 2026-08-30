/**
 * 云函数调用的唯一出口（端侧）。
 *
 * 页面不直接 `wx.cloud.callFunction`：
 *   - 统一注入联调标记 `isTest`（来自 config/env.js），避免每个调用点都记着传
 *   - 统一把 `{ ok: false, code, message }` 转成带 code 的 Error，让页面能原样展示业务提示
 *     （M1-17 的要求：不吞错、不弹通用"网络错误"）
 *   - 网络层失败与业务失败区分开：前者 code 为 NETWORK_ERROR，后者是云函数给的业务码
 */

const { IS_TEST_DATA } = require('../config/env')

/** 端侧自造的错误码，与云函数的业务码不重名 */
const CLIENT_ERROR = {
  CLOUD_NOT_READY: 'CLOUD_NOT_READY',
  NETWORK_ERROR: 'NETWORK_ERROR'
}

const makeError = (code, message, extra) => {
  const err = new Error(message)
  err.code = code
  if (extra) Object.assign(err, extra)
  return err
}

/**
 * 调一个云函数动作。
 * @param {string} name   云函数名
 * @param {string} action 动作名
 * @param {object} [params]
 * @returns {Promise<object>} 云函数返回值里除 ok 之外的部分
 */
const callAction = async (name, action, params = {}) => {
  if (!wx.cloud) {
    throw makeError(CLIENT_ERROR.CLOUD_NOT_READY, '云能力未初始化，请重启小程序')
  }

  let res
  try {
    res = await wx.cloud.callFunction({
      name,
      data: { action, params: Object.assign({ isTest: IS_TEST_DATA }, params) }
    })
  } catch (err) {
    // 只有真正的网络/调用层失败会走到这里；业务失败在 result 里
    throw makeError(CLIENT_ERROR.NETWORK_ERROR, '网络不太顺，请重试一次', { raw: err })
  }

  const result = res && res.result
  if (!result || typeof result !== 'object') {
    throw makeError(CLIENT_ERROR.NETWORK_ERROR, '云函数没有返回内容', { raw: res })
  }
  if (!result.ok) {
    throw makeError(result.code || 'UNKNOWN', result.message || '操作失败', { detail: result.detail })
  }
  return result
}

module.exports = {
  CLIENT_ERROR,
  callAction
}
