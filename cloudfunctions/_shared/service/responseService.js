/**
 * 响应需求单的业务规则（M1-10）。
 *
 * 幂等是这一步的核心：用户网络重试、连点两次，都不允许出现第二条响应。
 * 三道防线，从便宜到可靠：预查询（给友好提示）→ 唯一索引（物理保证）→ 冲突后改读（并发兜底）。
 * 只有第二道是真正可靠的，前后两道是为了体验与不把数据库报错泄给用户。
 */

const responsesDao = require('../dao/responses')
const requestsDao = require('../dao/requests')
const usersDao = require('../dao/users')
const {
  REQUEST_STATUS,
  ACTOR_ROLE,
  GENDER,
  PREFERENCE_FLAG,
  REWARD_TYPE,
  RESPONSE_SOURCE,
  RESPONSE_SOURCE_VALUES
} = require('../constants/enums')
const { ERROR, fail, ok } = require('../constants/errors')
const { applyTransition } = require('./requestService')

/** 可被响应的状态：已选定 / 已过期 / 已取消 / 已下架的单都不再接受响应 */
const ACCEPTING_STATUSES = Object.freeze([REQUEST_STATUS.OPEN, REQUEST_STATUS.RESPONDED])

const PITCH_MAX_CHARS = 100

/** 状态 → 给用户的解释。笼统说"不能响应"会让人以为是 bug */
const NOT_ACCEPTING_REASON = Object.freeze({
  [REQUEST_STATUS.MATCHED]: '需求方已经选定了别人',
  [REQUEST_STATUS.DONE]: '这条需求已经完成了',
  [REQUEST_STATUS.RATED]: '这条需求已经完成了',
  [REQUEST_STATUS.EXPIRED]: '这条需求已经过期',
  [REQUEST_STATUS.CANCELLED]: '需求方已取消这条需求',
  [REQUEST_STATUS.REMOVED]: '这条需求已下架',
  [REQUEST_STATUS.DRAFT]: '这条需求还没发布'
})

const charLength = text => Array.from(String(text)).length

const normalizeParams = params => {
  const { requestId } = params
  if (!requestId || typeof requestId !== 'string') fail(ERROR.BAD_PARAMS, '缺 requestId')

  const pitch = typeof params.pitch === 'string' ? params.pitch.trim() : ''
  if (charLength(pitch) > PITCH_MAX_CHARS) {
    fail(ERROR.BAD_PARAMS, `自荐语不超过 ${PITCH_MAX_CHARS} 字`)
  }

  let quote = null
  if (params.quote !== undefined && params.quote !== null && params.quote !== '') {
    const parsed = Number(params.quote)
    if (!Number.isFinite(parsed) || parsed <= 0) fail(ERROR.BAD_PARAMS, '报价要是大于 0 的数字')
    quote = parsed
  }

  const source = RESPONSE_SOURCE_VALUES.includes(params.source)
    ? params.source
    : RESPONSE_SOURCE.COMMUNITY // 默认按"从需求广场看到的"归因，不猜更精确的来源

  return { requestId, pitch, quote, source }
}

/**
 * 「仅同性响应」校验（D-26）。
 * 未填性别时给的是"补全性别后可响应"，而不是笼统拒绝 —— 这是一条可行动的提示。
 */
const assertGenderAllowed = async (request, responder) => {
  const preference = request.preference || {}
  if (preference[PREFERENCE_FLAG.SAME_GENDER_ONLY] !== true) return

  const responderGender = (responder && responder.gender) || GENDER.UNSET
  if (responderGender === GENDER.UNSET) {
    fail(ERROR.GENDER_REQUIRED, '这条需求只接受同性响应，补全性别后就可以响应了')
  }

  const owner = await usersDao.findByOpenid(request.ownerOpenid)
  const ownerGender = (owner && owner.gender) || GENDER.UNSET
  if (ownerGender === GENDER.UNSET) {
    // 发布时已拦过这种情况；能走到这里说明是历史数据，如实说明而不是假装校验通过
    fail(ERROR.GENDER_MISMATCH, '需求方尚未填写性别，这条「仅同性」需求暂时无法响应')
  }
  if (ownerGender !== responderGender) {
    fail(ERROR.GENDER_MISMATCH, '这条需求只接受同性响应')
  }
}

/** 响应需求单。首个响应会把单子从 open 推到 responded（actor 为 system） */
const submit = async ({ openid, params = {}, isTest = false }) => {
  const { requestId, pitch, quote, source } = normalizeParams(params)

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')

  if (request.ownerOpenid === openid) {
    fail(ERROR.CANNOT_RESPOND_OWN, '这是你自己发的需求，不用响应')
  }
  if (!ACCEPTING_STATUSES.includes(request.status)) {
    fail(
      ERROR.REQUEST_NOT_ACCEPTING,
      NOT_ACCEPTING_REASON[request.status] || '这条需求现在不接受响应'
    )
  }

  const responder = await usersDao.findByOpenid(openid)
  await assertGenderAllowed(request, responder)

  const existing = await responsesDao.findByRequestAndResponder(requestId, openid)
  if (existing) {
    fail(ERROR.ALREADY_RESPONDED, '你已经响应过这条需求了，等需求方选定就好')
  }

  const doc = {
    requestId,
    responderOpenid: openid,
    pitch,
    // 报价只对付费类有意义，其余类型存 null，避免出现"免费单带报价"这种自相矛盾的数据
    quote: request.rewardType === REWARD_TYPE.PAID ? quote : null,
    source,
    selected: false,
    // 冗余存响应者展示信息（tech-stack 第 4 节：冗余优于联查）
    responderNickName: responder ? responder.nickName : '',
    responderAvatarUrl: responder ? responder.avatarUrl : '',
    responderTrustLevel: responder ? responder.trustLevel : 'newcomer'
  }

  let responseId
  try {
    responseId = await responsesDao.insert(doc, isTest)
  } catch (err) {
    // 唯一索引冲突：并发下另一次调用刚写成功。转成业务提示，不把数据库报错泄给端侧
    const again = await responsesDao.findByRequestAndResponder(requestId, openid)
    if (again) fail(ERROR.ALREADY_RESPONDED, '你已经响应过这条需求了，等需求方选定就好')
    throw err
  }

  // 首个响应触发 open → responded；已是 responded 的单不重复转移
  let transitioned = false
  if (request.status === REQUEST_STATUS.OPEN) {
    await applyTransition({
      requestId,
      to: REQUEST_STATUS.RESPONDED,
      actorRole: ACTOR_ROLE.SYSTEM,
      actorOpenid: openid,
      reason: 'first_response',
      isTest
    })
    transitioned = true
  }

  await requestsDao.incResponseCount(requestId, 1)
  const responseCount = await responsesDao.countByRequest(requestId)

  return ok({
    responseId,
    requestStatus: transitioned ? REQUEST_STATUS.RESPONDED : request.status,
    transitioned,
    responseCount
  })
}

/**
 * 响应列表。
 * 需求方看到全部；其他人只看到自己那条 —— 别人的自荐语与报价不该被围观。
 */
const list = async ({ openid, params = {} }) => {
  const { requestId } = params
  if (!requestId) fail(ERROR.BAD_PARAMS, '缺 requestId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')

  const isOwner = request.ownerOpenid === openid
  if (!isOwner) {
    const mine = await responsesDao.findByRequestAndResponder(requestId, openid)
    return ok({ isOwner, responses: mine ? [mine] : [], total: request.responseCount || 0 })
  }

  const responses = await responsesDao.listByRequest(requestId)
  return ok({ isOwner, responses, total: responses.length })
}

module.exports = {
  ACCEPTING_STATUSES,
  PITCH_MAX_CHARS,
  submit,
  list
}
