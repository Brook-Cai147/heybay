/**
 * 云函数的统一返回形状与业务错误码。
 *
 * 铁律（PRD 6.4 / M1-17）：**业务失败不是异常**。云函数一律返回
 * `{ ok: false, code, message }`，端侧原样把 message 呈现给用户，
 * 绝不吞错、也绝不把数据库原始报错抛到界面上。
 *
 * 只有"代码 bug 级"的意外才走 UNEXPECTED —— 那种情况 message 不面向用户，只面向日志。
 */

const ERROR = Object.freeze({
  // 入参与鉴权
  BAD_ACTION: 'BAD_ACTION',                     // action 不在白名单内
  BAD_PARAMS: 'BAD_PARAMS',                     // 入参形状不对
  NO_IDENTITY: 'NO_IDENTITY',                   // 取不到 openid（未登录或调用方式不对）
  FORBIDDEN: 'FORBIDDEN',                       // 身份合法但没资格做这件事

  // 需求单
  VALIDATION_FAILED: 'VALIDATION_FAILED',       // 字段校验不通过（errors 数组随返回）
  AI_FIELD_FORBIDDEN: 'AI_FIELD_FORBIDDEN',     // 四类字段标了 AI 来源（PRD 5.4）
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  CITY_NOT_OPEN: 'CITY_NOT_OPEN',               // 该城市尚未开城（D-10）
  ACTIVE_LIMIT_REACHED: 'ACTIVE_LIMIT_REACHED', // 同城在架上限
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',     // 当前状态不允许这次变更
  TRANSITION_FORBIDDEN: 'TRANSITION_FORBIDDEN', // 变更合法但发起方没资格

  // 响应
  CANNOT_RESPOND_OWN: 'CANNOT_RESPOND_OWN',     // 不能响应自己的单
  REQUEST_NOT_ACCEPTING: 'REQUEST_NOT_ACCEPTING', // 单子不在可响应状态
  ALREADY_RESPONDED: 'ALREADY_RESPONDED',       // 幂等：已响应过
  GENDER_REQUIRED: 'GENDER_REQUIRED',           // 仅同性单，响应者未填性别（D-26）
  GENDER_MISMATCH: 'GENDER_MISMATCH',           // 仅同性单，性别不符
  RESPONSE_NOT_FOUND: 'RESPONSE_NOT_FOUND',

  UNEXPECTED: 'UNEXPECTED'                      // 兜底：非预期异常
})

/** 业务错误：带 code 的 Error，handler 会把它转成 { ok: false, code, message } */
const businessError = (code, message, extra = {}) => {
  const err = new Error(message)
  err.code = code
  err.isBusiness = true
  Object.assign(err, extra)
  return err
}

const fail = (code, message, extra = {}) => {
  throw businessError(code, message, extra)
}

const ok = (data = {}) => Object.assign({ ok: true }, data)

module.exports = {
  ERROR,
  businessError,
  fail,
  ok
}
