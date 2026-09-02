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
const { publicUser, contactOf } = require('./userService')
const usersDao = require('../dao/users')
const aiLogsDao = require('../dao/aiLogs')
const { computeAdoption } = require('../ai/adoption')

/** 城市配置的 key 规则（D-34：M1~M2 城市配置暂存 configs，M3 迁 cities 集合） */
const cityConfigKey = city => `city_${String(city).toLowerCase()}`

const ADMIN_CONFIG_KEY = 'admin_openids'

/**
 * 广场列表是否包含 `_isTest` 数据。**联调期唯一的开关，就在这一处**。
 * M1-19 收尾前改成 false，之后正式统计与展示都不会再看到联调数据。
 */
const INCLUDE_TEST_DATA = true

/** 广场列表每页条数 */
const SQUARE_PAGE_SIZE = 20

/** 读城市配置；未配置即视为未开城（D-10：只开伦敦，其余显示"尚未开城"） */
const loadCityConfig = async city => {
  const config = await configsDao.getValue(cityConfigKey(city))
  if (!config || config.isOpen !== true) {
    fail(ERROR.CITY_NOT_OPEN, `${city} 还没有开城，暂时不能在这里发需求`)
  }
  return config
}

/**
 * 发布成功后把 AI 解析的采纳情况回填进 `aiLogs`（M2-08）。
 *
 * 端侧发布时带上 `aiMeta: { logId, aiFilledFields }`（都来自 `aiGateway.parseRequest` 的返回）。
 * 没带就是纯表单发布，直接跳过 —— 纯表单不该在 AI 的统计里留下痕迹，否则采纳率会被稀释。
 *
 * **这里刻意不上报 `ai_field_modified` 事件**，尽管 M2-08 的计划提到了"是否被修改"。
 * 原因是同一个指标两处上报必然口径漂移：
 *   `events.ai_field_modified` 由端侧在**用户真的改动那一刻**上报，含最终没发布的草稿——
 *      它衡量的是"用户改不改"这个行为
 *   `aiLogs.adoptionRate` 在**发布成功时**由服务端算，只覆盖真的发出去的单——
 *      它衡量的是"AI 的建议最终留下了多少"
 * 两个数分工明确、都需要，但绝不能混成一个。口径写进了 `architecture.md`。
 *
 * 整段包在 try 里：回填是统计需求，而这行代码之后需求单已经发布成功了。
 * 让一个统计动作把已经成功的发布变成报错，是本末倒置。
 */
const backfillAiOutcome = async ({ requestId, params }) => {
  const meta = params && params.aiMeta
  if (!meta || !meta.logId) return null

  const adoption = computeAdoption({
    aiFilledFields: meta.aiFilledFields,
    fieldSources: params.fieldSources
  })

  try {
    await aiLogsDao.markOutcome(meta.logId, Object.assign({}, adoption, { requestId }))
  } catch (err) {
    console.error('[create] 回填 aiLogs 失败（不影响发布）', err && err.message)
  }

  return adoption
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

    // AI 解析的闭环（M2-08）：回填采纳情况。失败一律不影响发布
    await backfillAiOutcome({ requestId, params })

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

/**
 * 需求单详情（M1-17）。一次调用把页面要的都带回来 —— 免费环境的调用次数有限，
 * 详情 + 响应列表拆成两次请求没必要。
 *
 * 可见性按身份区分：需求方看到全部响应，响应者只看到自己那条，游客看不到任何响应内容。
 * 别人的自荐语与报价不该被围观。
 */
const getDetail = async ({ openid, params = {} }) => {
  const { requestId } = params
  if (!requestId) fail(ERROR.BAD_PARAMS, '缺 requestId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')

  const isOwner = request.ownerOpenid === openid
  const isMatchedResponder = Boolean(
    request.matchedResponderOpenid && request.matchedResponderOpenid === openid
  )

  const mine = isOwner ? null : await responsesDao.findByRequestAndResponder(requestId, openid)
  const rawResponses = isOwner
    ? await responsesDao.listByRequest(requestId)
    : (mine ? [mine] : [])

  const owner = await usersDao.findByOpenid(request.ownerOpenid)

  /**
   * 联系方式的下发规则（D-36）：**只在 matched 之后，且只在需求方与被选定的响应者之间双向下发**。
   * 其他任何身份、任何状态都拿不到。这是全项目唯一会把个人联系方式发到端侧的地方。
   */
  let peerContact = null
  let peerNickName = ''
  if (request.status === REQUEST_STATUS.MATCHED || request.status === REQUEST_STATUS.DONE) {
    if (isOwner && request.matchedResponderOpenid) {
      const responder = await usersDao.findByOpenid(request.matchedResponderOpenid)
      peerContact = contactOf(responder)
      peerNickName = responder ? responder.nickName : ''
    } else if (isMatchedResponder) {
      peerContact = contactOf(owner)
      peerNickName = owner ? owner.nickName : ''
    }
  }

  return ok({
    request: publicRequest(request),
    viewerRole: isOwner ? ACTOR_ROLE.OWNER : (isMatchedResponder ? ACTOR_ROLE.RESPONDER : 'visitor'),
    isOwner,
    isMatchedResponder,
    owner: publicUser(owner),
    responses: rawResponses.map(publicResponse),
    myResponseId: mine ? mine._id : null,
    peerContact,
    peerNickName,
    doneConfirm: {
      owner: Boolean(request.ownerDoneAt),
      responder: Boolean(request.responderDoneAt)
    },
    serverTime: Date.now()
  })
}

/** 需求单的对外字段。`ownerOpenid`、`cancelReason` 这类内部字段不发给端侧 */
const publicRequest = request => ({
  _id: request._id,
  category: request.category,
  title: request.title,
  detail: request.detail,
  city: request.city,
  area: request.area || '',
  timing: request.timing,
  instantDuration: request.instantDuration || null,
  expectTime: request.expectTime || null,
  rewardType: request.rewardType,
  amount: request.amount || null,
  headcount: request.headcount || null,
  visibility: request.visibility,
  preference: request.preference || {},
  status: request.status,
  expireAt: request.expireAt,
  responseCount: request.responseCount || 0,
  matchedResponseId: request.matchedResponseId || null,
  reselectCount: Number.isInteger(request.reselectCount) ? request.reselectCount : 0,
  ownerNickName: request.ownerNickName || '',
  ownerAvatarUrl: request.ownerAvatarUrl || '',
  ownerTrustLevel: request.ownerTrustLevel || 'newcomer',
  cancelledBy: request.cancelledBy || null,
  createdAt: request.createdAt,
  isTest: request._isTest === true
})

/** 响应的对外字段。**不含 responderOpenid** —— 页面用 responseId 就够了 */
const publicResponse = response => ({
  _id: response._id,
  pitch: response.pitch || '',
  quote: response.quote || null,
  source: response.source,
  selected: response.selected === true,
  responderNickName: response.responderNickName || '',
  responderAvatarUrl: response.responderAvatarUrl || '',
  responderTrustLevel: response.responderTrustLevel || 'newcomer',
  // M1 能真实拿到的证据只有完成单数（confirmDone 时累加），平均响应时长没有数据源，
  // 因此整块不显示，也不写"暂无"占位（计划 M1-17 第 2 条）
  responderDoneCount: Number.isInteger(response.responderDoneCount) ? response.responderDoneCount : null,
  createdAt: response.createdAt
})

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

  // 幂等：重复选定同一人返回成功但不再转移、不再写日志；改选别人要先撤销选定（D-35）
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
    fail(ERROR.FORBIDDEN, '这条需求已经选定了其他人。要改选，请先撤销选定')
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

  // 完成单数累加到双方身上。这是 M1 唯一真实可得的"证据摘要"（PRD 6.4 的响应者证据），
  // 也是 M3 信任分的输入。累加失败只记日志，不让已完成的单子回滚
  for (const who of [request.ownerOpenid, request.matchedResponderOpenid]) {
    if (!who) continue
    try {
      await usersDao.incCounter(who, 'doneCount', 1)
    } catch (err) {
      console.warn('[confirmDone] 完成单数累加失败（不影响完成本身）', err && err.message)
    }
  }

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

/**
 * 需求广场列表（M1-16）。端侧没有直读权限，列表只能走这里。
 *
 * 只回传卡片需要的字段：既省流量，也避免把 `ownerOpenid`、`cancelReason` 这类
 * 与展示无关的信息发到端侧。
 */
const listSquare = async ({ openid, params = {} }) => {
  const city = typeof params.city === 'string' && params.city.trim()
    ? params.city.trim().toLowerCase()
    : 'london'
  const category = typeof params.category === 'string' && params.category ? params.category : ''
  const page = Number.isInteger(params.page) && params.page > 0 ? params.page : 1

  const cityConfig = await configsDao.getValue(cityConfigKey(city))
  if (!cityConfig || cityConfig.isOpen !== true) {
    // 未开城不是错误，是一个正常的空状态（D-10），端侧据此显示"尚未开城"
    return ok({ city, cityOpen: false, items: [], page, hasMore: false })
  }

  const nowMs = Date.now()
  const rows = await requestsDao.listOpenByCity({
    city,
    category,
    nowMs,
    includeTest: INCLUDE_TEST_DATA,
    limit: SQUARE_PAGE_SIZE + 1, // 多取一条用来判断还有没有下一页，省一次 count 查询
    skip: (page - 1) * SQUARE_PAGE_SIZE
  })

  const hasMore = rows.length > SQUARE_PAGE_SIZE
  const items = rows.slice(0, SQUARE_PAGE_SIZE).map(row => listRow(row, openid))

  return ok({ city, cityOpen: true, items, page, hasMore, serverTime: nowMs })
}

/** 列表卡片的对外字段。广场与「我的」两处共用，避免两边字段慢慢长歪 */
const listRow = (row, openid) => ({
  _id: row._id,
  category: row.category,
  title: row.title,
  city: row.city,
  area: row.area || '',
  timing: row.timing,
  instantDuration: row.instantDuration || null,
  rewardType: row.rewardType,
  amount: row.amount || null,
  status: row.status,
  expireAt: row.expireAt,
  responseCount: row.responseCount || 0,
  ownerNickName: row.ownerNickName || '',
  ownerAvatarUrl: row.ownerAvatarUrl || '',
  ownerTrustLevel: row.ownerTrustLevel || 'newcomer',
  isMine: row.ownerOpenid === openid,
  isTest: row._isTest === true
})

/** 「我的」列表一次最多回多少条。翻页留到有真实数据量时再说 */
const MINE_PAGE_SIZE = 20

/**
 * 「我发布的」与「我响应的」（M1-17 后续补：**响应之后没有任何入口能找回那条单**）。
 *
 * 为什么两个列表一次调用回来：这是「我的」页面进来就要的东西，拆两次请求在免费额度下不划算。
 * 为什么不筛状态、不筛过期：自己参与过的单子，过期、取消、完成之后都得能找回来 ——
 * 广场只展示在架单，那是给别人看的；这里是给本人回看的，两者的取舍相反。
 */
const listMine = async ({ openid }) => {
  const publishedRows = await requestsDao.listByOwner({
    ownerOpenid: openid,
    includeTest: INCLUDE_TEST_DATA,
    limit: MINE_PAGE_SIZE
  })

  const myResponses = await responsesDao.listByResponder(openid, MINE_PAGE_SIZE)
  const respondedRows = await requestsDao.listByIds(myResponses.map(item => item.requestId))
  // 批量取回来的顺序不保证，按"我响应的时间"倒序重排：用户找的是"我刚才响应的那条"
  const rowById = new Map(respondedRows.map(row => [row._id, row]))

  const responded = myResponses
    .map(response => {
      const row = rowById.get(response.requestId)
      if (!row) return null // 需求单被删了，跳过而不是显示一张空卡
      return Object.assign(listRow(row, openid), {
        myResponseId: response._id,
        mySelected: response.selected === true,
        respondedAt: response.createdAt
      })
    })
    .filter(Boolean)

  return ok({
    published: publishedRows.map(row => listRow(row, openid)),
    responded,
    serverTime: Date.now()
  })
}

/**
 * 撤销选定（D-35）：matched → responded，退回待选定，原有响应全部保留。
 *
 * 为什么允许：双方拿到联系方式后线下沟通，变卦、约不上、同时在聊几个人都是常态。
 * 逼着需求方"取消整单再重发"会让其余响应者也白等一轮，代价落在无关的人身上。
 *
 * 三件事必须一起做，否则会留下自相矛盾的数据：
 *   1. 清掉 matched 相关字段（被选定者、选定时间、双方的完成确认）
 *   2. 把响应的 selected 标记全部清掉
 *   3. 记一次 reselectCount —— 撤销不是免费的，次数要留痕
 *
 * **联系方式无法收回**：对方已经看到了。所以端侧必须在二次确认里说明这一点。
 */
const unselectResponder = async ({ openid, params = {}, isTest = false }) => {
  const { requestId, reason } = params
  if (!requestId || typeof requestId !== 'string') fail(ERROR.BAD_PARAMS, '缺 requestId')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求不存在或已被删除')
  if (request.ownerOpenid !== openid) {
    fail(ERROR.FORBIDDEN, '只有需求方本人能撤销选定')
  }
  if (request.status !== REQUEST_STATUS.MATCHED) {
    fail(ERROR.ILLEGAL_TRANSITION, '这条需求当前不是「已确定」状态，没有需要撤销的选定')
  }

  const previousResponseId = request.matchedResponseId || null

  const result = await applyTransition({
    requestId,
    to: REQUEST_STATUS.RESPONDED,
    actorRole: ACTOR_ROLE.OWNER,
    actorOpenid: openid,
    reason: (typeof reason === 'string' && reason.trim()) || 'unselect',
    patch: {
      matchedResponseId: null,
      matchedResponderOpenid: null,
      matchedAt: null,
      // 完成确认必须一起清：否则改选后新的响应者会"继承"上一位留下的确认
      ownerDoneAt: null,
      responderDoneAt: null,
      reselectCount: getReselectCount(request) + 1,
      lastUnselectedAt: new Date()
    },
    isTest
  })

  if (previousResponseId) {
    try {
      await responsesDao.updateById(previousResponseId, { selected: false })
    } catch (err) {
      console.warn('[unselectResponder] 清除响应选中标记失败（不影响状态回退）', err && err.message)
    }
  }

  return ok({
    requestId,
    from: result.from,
    status: REQUEST_STATUS.RESPONDED,
    unselectedResponseId: previousResponseId,
    reselectCount: getReselectCount(request) + 1
  })
}

const getReselectCount = request => (Number.isInteger(request.reselectCount) ? request.reselectCount : 0)

module.exports = {
  cityConfigKey,
  loadCityConfig,
  SQUARE_PAGE_SIZE,
  create,
  applyTransition,
  resolveActorRole,
  transitionRequest,
  selectResponder,
  unselectResponder,
  confirmDone,
  cancel,
  getDetail,
  listSquare,
  listMine
}
