/**
 * track —— 埋点上报云函数（M1-13）。
 *
 * 只有一个 action。字典外或 planned 状态的事件名一律被拒（见 `_shared/constants/events.js`），
 * 这样事件名不会野生增长。桶号由服务端算并缓存到 `users`，端侧不参与分桶（端侧可被改）。
 *
 * `_shared` 是 `npm run sync` 复制进来的副本，改共享代码后必须重新 sync 再上传。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { createHandler } = require('./_shared/service/dispatch')
const trackService = require('./_shared/service/trackService')

exports.main = createHandler({
  report: ({ openid, params }) =>
    trackService.report({
      openid,
      name: params.name,
      params: params.eventParams,
      clientTime: params.clientTime,
      isTest: params.isTest === true
    })
})
