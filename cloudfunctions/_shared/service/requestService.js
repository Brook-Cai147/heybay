/**
 * 需求单的业务规则（M1-09）。**状态变更的唯一通道**。
 *
 * 铁律：
 *   1. 任何状态变化都必须经 `applyTransition`，它先过状态机（合法性 + 权限），再写库
 *   2. 状态更新与 `statusLogs` 写入在同一个事务里 —— 不允许状态变了却没有审计
 *   3. 规则不在这里重写：过期时间与在架上限都调 `requestExpiry` 的纯函数，那边有单测
 */

const requestsDao = require('../dao/requests')
const responsesDao = require('../dao/responses')
const statusLogsDao = require('../dao/statusLogs')
const configsDao = require('../dao/configs')
const { startTransaction } = require('../dao/tx')
const { REQUEST_STATUS, ACTOR_ROLE, GENDER, PREFERENCE_FLAG } = require('../constants/enums')
const { ERROR, fail, ok } = require('../constants/errors')
const { assertTransitionByActor } = require('./requestStateMachine')
const { computeExpireAt, checkActiveLimit } = require('./requestExpiry')
const { validateAndNormalize } = require('./requestValidator')
const trackService = require('./trackService')
const { publicUser } = require('./userService')
const usersDao = require('../dao/users')

/** 城市配置的 key 规则（D-34：M1~M2 城市配置暂存 configs，M3 迁 cities 集合） */
const cityConfigKey = city => `city_${String(city).toLowerCase()}`

const ADMIN_CONFIG_KEY = 'admin_openids'

/** 读城市配置；未配置即视为未开城（D-10：只开伦敦，其余显示"尚未开城"） */
const loadCityConfig = async city => {
  const config = await configsDao.getValue(cityConfigKey(city))
  if (!config || config.isOpen !== true) {
    fail(ERROR.CITY_NOT_OPEN, `${city} 还没有开城，暂时不能在这里发需求`)
  }
  return config
}

/**
 * 发布需求单：draft → open。
 *
 * 顺序有意为之：先校验字段（含 AI 代填拦截）→ 再查城市与在架上限 → 最后才写库。
 * 把最便宜的检查放前面，避免为一条不合规的单子白查两次数据库。
 */
const create = async ({ openid, params = {}, isTest = false }) => {
  const draft = validateAndNormalize(params)
  const city = await loadCityConfig(draft.city)

  const activeCount = await requestsDao.countActiveByOwnerCity(openid, draft.city)
  const limitCheck = checkActiveLimit(activeCount, { limit: city.activeLimitFree })
  if (!limitCheck.allowed) {
    fail(
      ERROR.ACTIVE_LIMIT_REACHED,
      `同一城市最多同时挂 ${limitCheck.limit} 条需求，先完成或取消一条再发新的`
    )
  }

  // 发布时间用服务端时间：端侧时钟不可信，而过期时间是从这里算起的
  const nowMs = Date.now()
  const { expireAt, rule } = computeExpireAt({
    timing: draft.timing,
    expectTime: draft.expectTime,
    instantDuration: draft.instantDuration,
    createdAt: nowMs,
    timeZone: city.timeZone
  })

  // draft → open 也要过一遍状态机，不给"创建"开后门
  assertTransitionByActor(REQUEST_STATUS.DRAFT, REQUEST_STATUS.OPEN, ACTOR_ROLE.OWNER)

  const owner = await usersDao.findByOpenid(openid)

  // 开了「仅同性响应」却没填自己的性别，这个开关就无从判定 —— 在发布时拦住，
  // 而不是等到别人来响应时才报错（D-26）
  if (draft.preference[PREFERENCE_FLAG.SAME_GENDER_ONLY] === true) {
    if (!owner || !owner.gender || owner.gender === GENDER.UNSET) {
      fail(ERROR.BAD_PARAMS, '开启「仅同性响应」前，请先在个人资料里填写你的性别')
    }
  }

  const doc = Object.assign({}, draft, {
    ownerOpenid: openid,
    status: REQUEST_STATUS.OPEN,
    expireAt: new Date(expireAt),
    expireRule: rule,
    responseCount: 0,
    matchedResponderOpenid: null,
    doneConfirmedBy: [],
    // 冗余存需求方展示信息（tech-stack 第 4 节：冗余优于联查）
    ownerNickName: owner ? owner.nickName : '',
    ownerAvatarUrl: owner ? owner.avatarUrl : '',
    ownerTrustLevel: owner ? owner.trustLevel : 'newcomer'
  })

  const tx = await startTransaction()
  try {
    const requestId = await requestsDao.insert(doc, isTest, tx)
    await statusLogsDao.insert(
      {
        requestId,
        from: REQUEST_STATUS.DRAFT,
        to: REQUEST_STATUS.OPEN,
        actor: ACTOR_ROLE.OWNER,
        actorOpenid: openid,
        reason: 'create'
      },
      isTest,
      tx
    )
    await tx.commit()

    // 「仅同性响应」的使用率要能观测（PRD 4.5 / 事件字典 ⑤ 安全组），上报失败不影响发布
    if (draft.preference[PREFERENCE_FLAG.SAME_GENDER_ONLY] === true) {
      await trackService.reportSafely({
        openid,
        name: 'same_gender_only_enabled',
        params: { requestId },
        isTest
      })
    }
    return ok({ requestId, status: REQUEST_STATUS.OPEN, expireAt, expireRule: rule })
  } catch (err) {
    try {
      await tx.rollback()
    } catch (rollbackErr) {
      console.error('[create] rollback 失败', rollbackErr)
    }
    throw err
  }
}


/**
 * 执行一次状态转移。所有状态变化的唯一出口。
 *
 * @param {string}  requestId
 * @param {string}  to           目标状态
 * @param {string}  actorRole    ACTOR_ROLE 之一
 * @param {string}  actorOpenid  发起人 openid（system 触发时传触发者，便于追溯）
 * @param {string}  [reason]
 * @param {object}  [patch]      随状态一起写入的字段（如 matchedResponderOpenid）
 * @param {boolean} [isTest]
 */
const applyTransition = async ({ requestId, to, actorRole, actorOpenid, reason = '', patch = {}, isTest = false }) => {
  const tx = await startTransaction()
  let committed = false
  try {
    // 事务内读会加锁：并发的两次"选定"只有一次能成，另一次会看到已变更的状态并被状态机拒绝
    const request = await requestsDao.findById(requestId, tx)
    if (!request) {
      fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')
    }

    const from = request.status
    assertTransitionByActor(from, to, actorRole)

    await requestsDao.updateById(requestId, Object.assign({ status: to }, patch), tx)
    await statusLogsDao.insert(
      { requestId, from, to, actor: actorRole, actorOpenid, reason },
      isTest,
      tx
    )
    await tx.commit()
    committed = true
    // 状态变更事件由服务端上报，不依赖端侧触发（M1-13）。**上报失败不能影响已提交的状态变更**
    await trackService.reportSafely({
      openid: actorOpenid,
      name: 'request_status_changed',
      params: { requestId, from, to, actor: actorRole },
      isTest
    })
    return { from, to, request }
  } catch (err) {
    if (!committed) {
      // rollback 自身失败不能掩盖原始错误，所以只记日志
      try {
        await tx.rollback()
      } catch (rollbackErr) {
        console.error('[applyTransition] rollback 失败', rollbackErr)
      }
    }
    throw err
  }
}

/**
 * 判断某个 openid 对某单是什么角色。
 * 注意：`system` 永远不由端侧调用得到 —— 定时任务与连带触发在服务端内部指定角色。
 */
const resolveActorRole = async (request, openid) => {
  if (request.ownerOpenid === openid) return ACTOR_ROLE.OWNER
  if (request.matchedResponderOpenid && request.matchedResponderOpenid === openid) {
    return ACTOR_ROLE.RESPONDER
  }
  const admins = await configsDao.getValue(ADMIN_CONFIG_KEY, [])
  if (Array.isArray(admins) && admins.includes(openid)) return ACTOR_ROLE.ADMIN
  return null
}

/** 端侧发起的状态变更入口：角色由服务端判定，**不接受端侧传角色** */
const transitionRequest = async ({ openid, params = {}, isTest = false }) => {
  const { requestId, to, reason } = params
  if (!requestId || typeof requestId !== 'string') fail(ERROR.BAD_PARAMS, '缺 requestId')
  if (!to || typeof to !== 'string') fail(ERROR.BAD_PARAMS, '缺目标状态 to')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')

  const actorRole = await resolveActorRole(request, openid)
  if (!actorRole) {
    fail(ERROR.FORBIDDEN, '你不是这条需求的相关人，不能改它的状态')
  }

  const result = await applyTransition({
    requestId,
    to,
    actorRole,
    actorOpenid: openid,
    reason: typeof reason === 'string' ? reason : '',
    isTest
  })
  return ok({ requestId, from: result.from, to: result.to, actor: actorRole })
}

/** 需求单详情（M1-17 用）。M1 阶段整条文档回传，M3 上私信与联系方式前要在这里做字段裁剪 */
const getDetail = async ({ openid, params = {} }) => {
  const { requestId } = params
  if (!requestId) fail(ERROR.BAD_PARAMS, '缺 requestId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')

  const owner = await usersDao.findByOpenid(request.ownerOpenid)
  return ok({
    request,
    isOwner: request.ownerOpenid === openid,
    owner: publicUser(owner)
  })
}

/**
 * 选定响应者（M1-11）：responded → matched。**不可逆**。
 *
 * "不可逆"落成服务端约束而不是前端提示：已是 matched 的单再选别人会被状态机拒绝
 * （matched 没有回到 responded 的边），并发的两次选定也只有一次能过（事务内读加锁）。
 */
const selectResponder = async ({ openid, params = {}, isTest = false }) => {
  const { requestId, responseId } = params
  if (!requestId || typeof requestId !== 'string') fail(ERROR.BAD_PARAMS, '缺 requestId')
  if (!responseId || typeof responseId !== 'string') fail(ERROR.BAD_PARAMS, '缺 responseId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')
  if (request.ownerOpenid !== openid) {
    fail(ERROR.FORBIDDEN, '只有需求方本人能选定响应者')
  }

  // 幂等：重复选定同一人返回成功但不再转移、不再写日志；选定另一人则明确拒绝
  if (request.status === REQUEST_STATUS.MATCHED) {
    if (request.matchedResponseId === responseId) {
      return ok({
        requestId,
        responseId,
        status: REQUEST_STATUS.MATCHED,
        alreadySelected: true,
        matchedResponderOpenid: request.matchedResponderOpenid
      })
    }
    fail(ERROR.FORBIDDEN, '这条需求已经选定了其他人，选定不可撤销')
  }

  const response = await responsesDao.findById(responseId)
  if (!response) fail(ERROR.RESPONSE_NOT_FOUND, '这条响应不存在或已被删除')
  if (response.requestId !== requestId) {
    fail(ERROR.BAD_PARAMS, '这条响应不属于该需求单')
  }
  if (response.responderOpenid === openid) {
    fail(ERROR.BAD_PARAMS, '不能选定自己')
  }

  const result = await applyTransition({
    requestId,
    to: REQUEST_STATUS.MATCHED,
    actorRole: ACTOR_ROLE.OWNER,
    actorOpenid: openid,
    reason: 'select_responder',
    patch: {
      matchedResponseId: responseId,
      matchedResponderOpenid: response.responderOpenid,
      matchedAt: new Date()
    },
    isTest
  })

  // 状态已提交，再刷响应的选中标记：标记只影响列表展示，失败不该回滚状态
  await responsesDao.markSelected(requestId, responseId)

  await trackService.reportSafely({
    openid,
    name: 'responder_selected',
    params: { requestId, responseId },
    isTest
  })

  return ok({
    requestId,
    responseId,
    from: result.from,
    status: REQUEST_STATUS.MATCHED,
    matchedResponderOpenid: response.responderOpenid,
    responderNickName: response.responderNickName || ''
  })
}

/** 双方确认完成的字段名：按角色分开记时间，才能还原"谁在什么时候确认的" */
const DONE_FIELD = Object.freeze({
  [ACTOR_ROLE.OWNER]: 'ownerDoneAt',
  [ACTOR_ROLE.RESPONDER]: 'responderDoneAt'
})

/**
 * 确认完成（M1-12）：matched → done，**双方各自确认才推进**。
 * 单方重复确认幂等：返回成功但不写第二次时间、不推进状态。
 */
const confirmDone = async ({ openid, params = {}, isTest = false }) => {
  const { requestId } = params
  if (!requestId || typeof requestId !== 'string') fail(ERROR.BAD_PARAMS, '缺 requestId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')

  if (request.status === REQUEST_STATUS.DONE || request.status === REQUEST_STATUS.RATED) {
    return ok({ requestId, status: request.status, alreadyDone: true })
  }
  if (request.status !== REQUEST_STATUS.MATCHED) {
    fail(ERROR.ILLEGAL_TRANSITION, '只有已选定的需求才能确认完成')
  }

  const actorRole = await resolveActorRole(request, openid)
  if (actorRole !== ACTOR_ROLE.OWNER && actorRole !== ACTOR_ROLE.RESPONDER) {
    fail(ERROR.FORBIDDEN, '只有需求方与被选定的响应者能确认完成')
  }

  const myField = DONE_FIELD[actorRole]
  const otherField = actorRole === ACTOR_ROLE.OWNER ? DONE_FIELD[ACTOR_ROLE.RESPONDER] : DONE_FIELD[ACTOR_ROLE.OWNER]
  const alreadyConfirmed = Boolean(request[myField])

  if (!alreadyConfirmed) {
    await requestsDao.updateById(requestId, { [myField]: new Date() })
    await trackService.reportSafely({
      openid,
      name: 'request_done_confirmed',
      params: { requestId, byRole: actorRole },
      isTest
    })
  }

  const bothConfirmed = Boolean(request[otherField])
  if (!bothConfirmed) {
    return ok({
      requestId,
      status: REQUEST_STATUS.MATCHED,
      confirmedByMe: true,
      waitingFor: actorRole === ACTOR_ROLE.OWNER ? ACTOR_ROLE.RESPONDER : ACTOR_ROLE.OWNER,
      repeated: alreadyConfirmed
    })
  }

  // 两边都确认了，由这一次调用触发唯一的 matched → done 转移
  const result = await applyTransition({
    requestId,
    to: REQUEST_STATUS.DONE,
    actorRole,
    actorOpenid: openid,
    reason: 'both_confirmed',
    isTest
  })

  return ok({ requestId, from: result.from, status: REQUEST_STATUS.DONE, confirmedByMe: true })
}

/**
 * 取消（M1-12）。owner 在 open/responded/matched 都能取消，被选定的 responder 只能在 matched 取消
 * —— 这条限制由权限矩阵保证，本函数不重复实现。
 *
 * 必须记录取消方与取消次数（PRD 4.1 规则 3），为 M3 的信用分留数据。
 */
const cancel = async ({ openid, params = {}, isTest = false }) => {
  const { requestId, reason } = params
  if (!requestId || typeof requestId !== 'string') fail(ERROR.BAD_PARAMS, '缺 requestId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')
  if (request.status === REQUEST_STATUS.CANCELLED) {
    return ok({ requestId, status: REQUEST_STATUS.CANCELLED, alreadyCancelled: true })
  }

  const actorRole = await resolveActorRole(request, openid)
  if (actorRole !== ACTOR_ROLE.OWNER && actorRole !== ACTOR_ROLE.RESPONDER) {
    fail(ERROR.FORBIDDEN, '只有需求方或被选定的响应者能取消')
  }

  const cancelReason = typeof reason === 'string' ? reason.trim().slice(0, 200) : ''
  const result = await applyTransition({
    requestId,
    to: REQUEST_STATUS.CANCELLED,
    actorRole,
    actorOpenid: openid,
    reason: cancelReason || 'cancel',
    patch: {
      cancelledBy: actorRole,
      cancelledByOpenid: openid,
      cancelledAt: new Date(),
      cancelReason
    },
    isTest
  })

  // 取消次数记在人身上：单子会被清理，人的行为记录要留下（M3 信用分的输入）
  try {
    await usersDao.incCounter(openid, 'cancelCount', 1)
  } catch (err) {
    console.warn('[cancel] 取消次数累加失败（不影响取消本身）', err && err.message)
  }

  return ok({ requestId, from: result.from, status: REQUEST_STATUS.CANCELLED, cancelledBy: actorRole })
}

module.exports = {
  cityConfigKey,
  loadCityConfig,
  create,
  applyTransition,
  resolveActorRole,
  transitionRequest,
  selectResponder,
  confirmDone,
  cancel,
  getDetail
}
