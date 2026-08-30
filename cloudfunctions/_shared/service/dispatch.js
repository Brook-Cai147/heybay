/**
 * 云函数入口的公共骨架：取身份 → 校验 action → 分发 → 把异常翻译成业务返回。
 *
 * 为什么抽出来：三个 handler（login / requestFlow / responseFlow）如果各写一遍
 * try-catch 与错误码翻译，迟早有一个漏掉，结果就是数据库原始报错漏到用户界面上。
 * handler 只负责这层薄壳，业务判断一律在 service 里（tech-stack 第 3 节）。
 */

const cloud = require('wx-server-sdk')
const { ERROR } = require('../constants/errors')
const { TRANSITION_ERROR } = require('./requestStateMachine')

/** 状态机错误码 → 业务错误码。两套码分开维护，因为状态机是纯逻辑、不知道云函数返回形状 */
const TRANSITION_ERROR_MAP = Object.freeze({
  [TRANSITION_ERROR.UNKNOWN_STATUS]: ERROR.ILLEGAL_TRANSITION,
  [TRANSITION_ERROR.ILLEGAL_TRANSITION]: ERROR.ILLEGAL_TRANSITION,
  [TRANSITION_ERROR.UNKNOWN_ACTOR]: ERROR.BAD_PARAMS,
  [TRANSITION_ERROR.TRANSITION_FORBIDDEN]: ERROR.TRANSITION_FORBIDDEN
})

/**
 * @param {object} actions action 名 → async ({ openid, params, wxContext }) => 返回值
 * @returns {function} 可直接作为 exports.main 的函数
 */
const createHandler = actions => async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event
  const params = event.params && typeof event.params === 'object' ? event.params : {}

  if (!openid) {
    // 云函数被非小程序端调用（如控制台测试）时取不到 openid，此时一切写操作都不该继续
    return { ok: false, code: ERROR.NO_IDENTITY, message: '取不到调用者身份，请从小程序端调用' }
  }
  if (!action || !Object.prototype.hasOwnProperty.call(actions, action)) {
    return {
      ok: false,
      code: ERROR.BAD_ACTION,
      message: `不认识的 action：${action}。可用：${Object.keys(actions).join(' / ')}`
    }
  }

  try {
    return await actions[action]({ openid, params, wxContext })
  } catch (err) {
    if (err && err.isBusiness) {
      return Object.assign(
        { ok: false, code: err.code, message: err.message },
        err.detail ? { detail: err.detail } : {}
      )
    }
    if (err && TRANSITION_ERROR_MAP[err.code]) {
      // 状态机抛的错本身就是给人看的（"open 允许转移到 …"），可以直接呈现
      return { ok: false, code: TRANSITION_ERROR_MAP[err.code], message: err.message }
    }
    // 到这里就是非预期异常：日志留全，返回给端侧的只有一句可读提示
    console.error(`[${action}] 非预期异常`, err)
    return {
      ok: false,
      code: ERROR.UNEXPECTED,
      message: '操作失败，请稍后重试',
      debug: String(err && err.message).slice(0, 200)
    }
  }
}

module.exports = { createHandler }
