/**
 * login —— 登录建档云函数（M1-08）。
 *
 * 三个 action：`login`（建档或更新活跃时间，幂等）、`updateProfile`（常驻城市与性别）、`getMe`。
 * handler 只做壳：身份、参数形状、分发。业务判断全在 `_shared/service/userService.js`。
 *
 * `_shared` 是复制进本目录的副本（`npm run sync` 生成），改共享代码后必须重新 sync 再上传。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { createHandler } = require('./_shared/service/dispatch')
const userService = require('./_shared/service/userService')

exports.main = createHandler({
  login: ({ openid, params }) =>
    userService.login({ openid, params, isTest: params.isTest === true }),

  updateProfile: ({ openid, params }) => userService.updateProfile({ openid, params }),

  getMe: ({ openid }) => userService.getMe({ openid })
})
