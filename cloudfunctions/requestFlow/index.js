/**
 * requestFlow —— 需求单的唯一写入口（M1-09）。
 *
 * handler 只做三件事：取身份、校验入参形状、按 action 分发。业务判断全在
 * `_shared/service/requestService.js`；状态变更一律经 `transitionRequest`，没有旁路。
 *
 * `_shared` 是 `npm run sync` 复制进来的副本，改共享代码后必须重新 sync 再上传。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { createHandler } = require('./_shared/service/dispatch')
const requestService = require('./_shared/service/requestService')

exports.main = createHandler({
  create: ({ openid, params }) =>
    requestService.create({ openid, params, isTest: params.isTest === true }),

  transitionRequest: ({ openid, params }) =>
    requestService.transitionRequest({ openid, params, isTest: params.isTest === true }),

  selectResponder: ({ openid, params }) =>
    requestService.selectResponder({ openid, params, isTest: params.isTest === true }),

  confirmDone: ({ openid, params }) =>
    requestService.confirmDone({ openid, params, isTest: params.isTest === true }),

  cancel: ({ openid, params }) =>
    requestService.cancel({ openid, params, isTest: params.isTest === true }),

  getDetail: ({ openid, params }) => requestService.getDetail({ openid, params }),

  list: ({ openid, params }) => requestService.listSquare({ openid, params })
})
