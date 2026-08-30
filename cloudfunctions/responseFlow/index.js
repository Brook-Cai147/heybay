/**
 * responseFlow —— 响应需求单（M1-10）。
 *
 * handler 只做壳；幂等、性别校验、首个响应触发状态转移都在
 * `_shared/service/responseService.js`。状态变更仍然经 requestService 的唯一通道。
 *
 * `_shared` 是 `npm run sync` 复制进来的副本，改共享代码后必须重新 sync 再上传。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { createHandler } = require('./_shared/service/dispatch')
const responseService = require('./_shared/service/responseService')

exports.main = createHandler({
  submit: ({ openid, params }) =>
    responseService.submit({ openid, params, isTest: params.isTest === true }),

  list: ({ openid, params }) => responseService.list({ openid, params })
})
