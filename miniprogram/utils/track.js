/**
 * 端侧埋点上报（M1-13）。
 *
 * **绝不阻断主流程**：失败静默重试一次后放弃，不弹提示、不抛错、不 return reject。
 * 页面调用处不需要 await，也不需要 catch —— 这是刻意的，埋点代码不该出现在业务的错误路径上。
 *
 * 事件名必须在 `_shared/constants/events.js` 的字典里且为 active，否则云函数会拒收
 * （拒收也只在控制台留一行 warn，不影响页面）。
 */

const { IS_TEST_DATA } = require('../config/env')

const FUNCTION_NAME = 'track'
const RETRY_DELAY_MS = 1000

const callOnce = (name, eventParams) =>
  wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: {
      action: 'report',
      params: {
        name,
        eventParams,
        clientTime: Date.now(),
        isTest: IS_TEST_DATA
      }
    }
  })

/**
 * 上报一条事件。
 * @param {string} name 事件名（取自 models 层的事件常量或字典，不要手写字面量）
 * @param {object} [eventParams] 事件必填参数，见事件字典
 */
const track = (name, eventParams = {}) => {
  if (!wx.cloud) return

  const attempt = isRetry =>
    callOnce(name, eventParams)
      .then(res => {
        const result = res && res.result
        if (result && result.ok === false) {
          // 事件名或参数不合字典：这是开发期错误，要看得见，但不打扰用户
          console.warn(`[track] ${name} 被拒：${result.code} ${result.message}`)
        }
      })
      .catch(err => {
        if (isRetry) {
          console.warn(`[track] ${name} 上报失败，已放弃`, err && err.errMsg)
          return
        }
        setTimeout(() => attempt(true), RETRY_DELAY_MS)
      })

  attempt(false)
}

module.exports = { track }
