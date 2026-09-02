/**
 * 定向邀请（M2-14）。**L1 一键代发的落点，也是 D-14 那条主张能不能被验证的地方。**
 *
 * 链路（计划 M2-14 第 2 条，顺序不可换）：
 *   `matchResponders` 出候选与依据 → `draftInvite` 起草文案 → **用户勾选** → 统一发出
 *
 * 两条不能松的：
 *   1. **Agent 绝不自动发送**。`draft` 只返回文案，`send` 必须由用户带着勾选结果调进来。
 *      这不是实现细节，这就是 L0 与 L1 的全部差别，也是 L3 为什么不做的同一个理由（D-14）。
 *   2. **L0 档调 `send` 直接拒绝**。档位如果只是个显示用的标签，那它就不是产品主张而是装饰。
 */

const { ERROR, fail, ok } = require('../constants/errors')
const { AI_CAPABILITY } = require('../constants/aiCapabilities')
const autonomy = require('../ai/autonomy')
const { INVITE_MAX } = require('../schemas/draftInvite')
const aiService = require('./aiService')
const matchService = require('./matchService')
const trackService = require('./trackService')
const requestsDao = require('../dao/requests')
const usersDao = require('../dao/users')
const invitesDao = require('../dao/invites')

/** 与 aiService 一致：联调期都打测试标记 */
const INCLUDE_TEST_DATA = true

/** 一次最多邀请几个人。与 `matchResponders` 的 Top 5 对齐，不给"全城群发"留口子 */
const MAX_TARGETS = 5

/** 模型不可用时的兜底文案。不好看，但每个字都由需求单本身来（不编事实） */
const templateInvite = ({ request, evidence = [] }) => {
  const why = evidence.map(item => item.text).join('、')
  const base = `有人在${request.city === 'london' ? '伦敦' : request.city}发了一条需求：${request.title}。`
  return `${base}${why ? `看到你${why}，想问问你方不方便。` : '想问问你方不方便。'}`.slice(0, INVITE_MAX)
}

/** 取当前档位。**档位是服务端算的**，不读端侧传来的 level（端侧不可信） */
const levelOfUser = async openid => {
  const user = await usersDao.findByOpenid(openid)
  const mine = await requestsDao.listByOwner({ ownerOpenid: openid, includeTest: true, limit: 20 })
  return Object.assign(
    autonomy.levelOf({
      userLevel: (user && user.autonomyLevel) || '',
      publishedCount: mine.length
    }),
    { user }
  )
}

const loadOwnRequest = async ({ openid, requestId }) => {
  const id = String(requestId || '').trim()
  if (!id) fail(ERROR.BAD_PARAMS, '缺少需求单 id')
  const request = await requestsDao.findById(id)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求单不存在或已被删除')
  if (request.ownerOpenid !== openid) fail(ERROR.FORBIDDEN, '只有发单人能给这条单发邀请')
  return request
}

/**
 * L1 → L2 的**一次性**询问（D-14）。
 *
 * 触发条件按 `invite_responded` 的定义来：**定向邀请真的换来过一次响应**，
 * 用户才会被问"以后要不要让 AI 自动分发"。在这之前问，用户没有判断依据；
 * 问过一次就不再问（`users.l2PromptAnsweredAt`）—— 反复劝用户提升自主性是诱导，不是选择。
 *
 * 放在邀请面板里而不是别处：这是唯一一个"用户刚看到 L1 效果"的位置。
 */
const l2PromptOf = async ({ user, level, requestId }) => {
  if (level !== autonomy.AUTONOMY.L1) return null
  if (user && user.l2PromptAnsweredAt) return null
  const responded = await invitesDao.countResponded(requestId)
  if (!responded) return null
  return {
    show: true,
    question: `这条单的定向邀请已经换来 ${responded} 次响应。以后要不要让 AI 按条件自动分发（不用你逐个勾选）？`,
    note: `自动分发是「${autonomy.AUTONOMY_INFO[autonomy.AUTONOMY.L2].name}」档，现在还没做（M5）。这里只记录你的选择，不会改你当前的档位。`
  }
}


/**
 * 起草邀请（不发送）。**L0 也能用** —— L0 是"只读建议"，看得到草稿正是它的价值。
 *
 * @returns {object} `{ ok: true, level, targets: [{ openid, user, reason, evidence, text, textSource }] }`
 */
const draft = async ({ openid, params = {} }) => {
  const request = await loadOwnRequest({ openid, requestId: params.requestId })
  const { level, reason, user } = await levelOfUser(openid)
  const l2Prompt = await l2PromptOf({ user, level, requestId: request._id })

  const matched = await matchService.recommend({ openid, params: { requestId: request._id } })
  if (!matched.ok) return matched
  if (!matched.candidates.length) {
    return ok({
      capability: AI_CAPABILITY.DRAFT_INVITE,
      level,
      levelReason: reason,
      levelName: autonomy.AUTONOMY_INFO[level].name,
      targets: [],
      l2Prompt,
      message: matched.message || '暂时没有可邀请的人'
    })
  }

  // 已经邀请过的人不再出现在名单里 —— 重复邀请在对方眼里就是骚扰
  const invited = new Set((await invitesDao.listByRequest(request._id)).map(item => item.inviteeOpenid))
  const candidates = matched.candidates.filter(item => !invited.has(item.user.openid)).slice(0, MAX_TARGETS)
  if (!candidates.length) {
    return ok({
      capability: AI_CAPABILITY.DRAFT_INVITE,
      level,
      levelReason: reason,
      levelName: autonomy.AUTONOMY_INFO[level].name,
      targets: [],
      l2Prompt,
      message: '能想到的人都已经邀请过了'
    })
  }

  const res = await aiService.invoke({
    openid,
    capability: AI_CAPABILITY.DRAFT_INVITE,
    params: {
      city: request.city,
      category: request.category,
      title: request.title,
      detail: request.detail,
      candidates
    }
  })

  const byIndex = new Map(
    (res.ok && res.data && Array.isArray(res.data.invites) ? res.data.invites : [])
      .filter(item => item && Number.isInteger(item.index))
      .map(item => [item.index, String(item.text || '')])
  )

  const targets = candidates.map((item, i) => {
    const text = byIndex.get(i + 1) || ''
    return {
      openid: item.user.openid,
      user: item.user,
      reason: item.reason,
      evidence: item.evidence,
      text: text || templateInvite({ request, evidence: item.evidence }),
      textSource: text ? 'ai' : 'template'
    }
  })

  trackService.reportSafely({
    openid,
    name: 'invite_drafted',
    params: { requestId: request._id, count: targets.length },
    isTest: INCLUDE_TEST_DATA
  })

  return ok({
    capability: AI_CAPABILITY.DRAFT_INVITE,
    level,
    levelReason: reason,
    levelName: autonomy.AUTONOMY_INFO[level].name,
    // L0 档看得到草稿但发不出去，端侧据此把"发出"按钮换成"升到 L1 才能发"
    canSend: autonomy.canSendInvites(level),
    targets,
    l2Prompt,
    degraded: !res.ok,
    meta: res.ok ? res.meta : null
  })
}

/**
 * 发出用户勾选的邀请。
 *
 * @param {object} input
 * @param {object} input.params `{ requestId, targets: [{ openid, text }] }`
 *        **targets 必须由用户勾选产生**：服务端不会"把上一次起草的全发出去"，
 *        因为那等于把"勾选"这一步偷偷跳过了。
 */
const send = async ({ openid, params = {} }) => {
  const request = await loadOwnRequest({ openid, requestId: params.requestId })
  const { level } = await levelOfUser(openid)

  // L0 的唯一行为差异就在这一行
  if (!autonomy.canSendInvites(level)) {
    fail(
      ERROR.FORBIDDEN,
      `你现在是「${autonomy.AUTONOMY_INFO[level].name}」档，AI 只出建议不代发。想让它帮你发，先切到「一键代发」。`
    )
  }

  const picked = Array.isArray(params.targets) ? params.targets.slice(0, MAX_TARGETS) : []
  if (!picked.length) fail(ERROR.BAD_PARAMS, '一个人都没勾，先选几位再发')

  const invited = new Set((await invitesDao.listByRequest(request._id)).map(item => item.inviteeOpenid))
  const results = []

  for (const target of picked) {
    const inviteeOpenid = String((target && target.openid) || '').trim()
    const text = String((target && target.text) || '').trim().slice(0, INVITE_MAX)
    if (!inviteeOpenid || !text) {
      results.push({ inviteeOpenid, ok: false, reason: 'bad_target' })
      continue
    }
    if (inviteeOpenid === openid) {
      results.push({ inviteeOpenid, ok: false, reason: 'self' })
      continue
    }
    if (invited.has(inviteeOpenid)) {
      results.push({ inviteeOpenid, ok: false, reason: 'already_invited' })
      continue
    }
    try {
      const inviteId = await invitesDao.insert(
        {
          requestId: request._id,
          requestTitle: request.title,
          requestCategory: request.category,
          city: request.city,
          inviterOpenid: openid,
          inviteeOpenid,
          text,
          // 文案是模型起草还是模板兜底，要能追溯（评测与改 Prompt 都要用）
          textSource: target.textSource === 'ai' ? 'ai' : 'template',
          autonomyLevel: level,
          viewedAt: null,
          respondedAt: null
        },
        INCLUDE_TEST_DATA
      )
      invited.add(inviteeOpenid)
      results.push({ inviteeOpenid, ok: true, inviteId })
    } catch (err) {
      console.error('[invite] 写邀请失败', err && err.message)
      results.push({ inviteeOpenid, ok: false, reason: 'write_failed' })
    }
  }

  const sent = results.filter(item => item.ok).length
  if (sent) {
    trackService.reportSafely({
      openid,
      name: 'invite_sent',
      params: { requestId: request._id, count: sent },
      isTest: INCLUDE_TEST_DATA
    })
  }

  return ok({
    capability: AI_CAPABILITY.DRAFT_INVITE,
    level,
    sent,
    results,
    message: sent ? `发出去 ${sent} 条邀请了。对方在消息里能看到。` : '一条都没发出去'
  })
}

/**
 * 记下 L1→L2 询问的答案。
 *
 * **答"要"也不会把档位改成 L2** —— L2 还没实现（M5），真去改档位就等于承诺了做不到的事。
 * 这里只做两件事：记一次事件（这是 D-14 那条主张唯一的量化依据），把"问过了"落到用户档案上。
 */
const answerL2Prompt = async ({ openid, params = {} }) => {
  const accepted = params.accepted === true
  const requestId = String(params.requestId || '').trim()

  await usersDao.updateByOpenid(openid, { l2PromptAnsweredAt: new Date(), l2PromptAccepted: accepted })
  await trackService.reportSafely({
    openid,
    name: 'l2_prompt_answered',
    params: { requestId, accepted },
    isTest: INCLUDE_TEST_DATA
  })

  return ok({
    accepted,
    message: accepted
      ? '记下了。自动分发要等 M5 才有；到时候会先让你设条件，而不是直接开始发。'
      : '好，那就保持现在这样：AI 起草，你勾选，你点发。'
  })
}

/** 我收到的邀请（消息 Tab）。顺手把"已查看"记上，用于观察邀请的实际打开率 */
const listReceived = async ({ openid }) => {
  const items = await invitesDao.listByInvitee(openid)
  for (const item of items) {
    if (!item.viewedAt) {
      try {
        await invitesDao.markState(item._id, { viewedAt: new Date() })
      } catch (err) {
        // 记不上就算了，不影响用户看邀请
      }
    }
  }
  return ok({ items })
}

module.exports = {
  MAX_TARGETS,
  templateInvite,
  levelOfUser,
  l2PromptOf,
  draft,
  send,
  answerL2Prompt,
  listReceived
}
