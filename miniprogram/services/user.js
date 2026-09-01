/**
 * 用户相关的端侧服务（M1-08）。**一个云函数动作对应一个方法**，页面只调这里。
 */

const { callAction } = require('./cloud')

const FUNCTION_NAME = 'login'

/** 登录建档；幂等，可以每次启动都调 */
const login = (profile = {}) => callAction(FUNCTION_NAME, 'login', profile)

/** 更新常驻城市、性别与联系方式（性别用于「仅同性响应」判定；联系方式见 D-36） */
const updateProfile = patch => callAction(FUNCTION_NAME, 'updateProfile', patch)

/** 取当前用户档案；没建档时返回的 user 为 null */
const getMe = () => callAction(FUNCTION_NAME, 'getMe')

module.exports = {
  login,
  updateProfile,
  getMe
}
