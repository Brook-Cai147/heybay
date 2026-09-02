/**
 * 匹配与可解释推荐（M2-11）。
 *
 * 分工是这一步的全部要点：
 *   **代码**决定推荐谁、排第几（`ai/matchScore.js`，纯函数、有单测）
 *   **模型**只把依据字段写成一句人话，且理由里的数字必须能追溯回依据
 *
 * 本步**只产出名单与理由，不发送任何东西**（计划第 3 条）。L2 自动触达与频控属 M5。
 */

const { ERROR, fail, ok } = require('../constants/errors')
const { AI_CAPABILITY } = require('../constants/aiCapabilities')
const { selectCandidates, verifyReason, templateReason } = require('../ai/matchScore')
const requestsDao = require('../dao/requests')
const usersDao = require('../dao/users')
const aiService = require('./aiService')
const { publicUser } = require('./userService')

/** 候选池上限。取回来再打分，不是"只看前 200 个人"——单城用户到这个量级之前都够用 */
const POOL_LIMIT = 200

/** 推荐名单最多几人（计划第 3 条） */
const TOP_N = 5

/** 理由的来源，回给端侧是为了让"这句话是谁写的"可追溯 */
const REASON_SOURCE = Object.freeze({
  AI: 'ai',
  TEMPLATE: 'template'
})

/**
 * 把模型返回的 reasons 按序号贴回候选，并逐条校验。
 *
 * 校验不过就换成模板拼接的理由 —— **宁可难看，不可无据**（PRD 5.4）。
 */
const attachReasons = (picked, reasons) => {
  const byIndex = new Map(
    (Array.isArray(reasons) ? reasons : [])
      .filter(item => item && Number.isInteger(item.index))
      .map(item => [item.index, String(item.reason || '')])
  )

  return picked.map((item, i) => {
    const raw = byIndex.get(i + 1) || ''
    const verdict = raw ? verifyReason(raw, item.evidence) : { ok: false, unsupported: [] }
    if (raw && verdict.ok) {
      return { entry: item, reason: raw, reasonSource: REASON_SOURCE.AI, unsupported: [] }
    }
    if (raw && !verdict.ok) {
      console.error(
        '[matchService] 推荐理由里出现了依据之外的数字，已改用模板：',
        raw,
        '未支撑的数字：',
        verdict.unsupported.join(', ')
      )
    }
    return {
      entry: item,
      reason: templateReason(item.evidence),
      reasonSource: REASON_SOURCE.TEMPLATE,
      unsupported: verdict.unsupported
    }
  })
}

/** 对外的候选形状。用 `publicUser` 裁剪，联系方式绝不出现在这里（D-36） */
const publicCandidate = ({ entry, reason, reasonSource }) => ({
  user: publicUser(entry.candidate),
  score: entry.score,
  // 依据字段原样回传：这是"可解释"的凭据，端侧要能把它展示在理由旁边
  evidence: entry.evidence.map(fact => ({ field: fact.field, text: fact.text, points: fact.points })),
  reason,
  reasonSource
})

/**
 * 给一条需求单推荐响应者。
 *
 * @param {object} input
 * @param {string} input.openid 调用者
 * @param {object} input.params `{ requestId }`
 * @returns {object} `{ ok: true, candidates: [...], skipped: [...] }`；
 *          候选为 0 人时也是 `ok: true` —— "没有合适的人"是正常结果，不是错误。
 */
const recommend = async ({ openid, params = {} }) => {
  const requestId = String(params.requestId || '').trim()
  if (!requestId) fail(ERROR.BAD_PARAMS, '缺少需求单 id')

  const request = await requestsDao.findById(requestId)
  if (!request) fail(ERROR.REQUEST_NOT_FOUND, '这条需求单不存在或已被删除')
  // 候选名单是别人的信息，只有发单人能看
  if (request.ownerOpenid !== openid) fail(ERROR.FORBIDDEN, '只有发单人能看这条单的推荐名单')

  const owner = await usersDao.findByOpenid(request.ownerOpenid)
  const pool = await usersDao.listByCity({ city: request.city, limit: POOL_LIMIT })

  const { picked, skipped } = selectCandidates({
    candidates: pool,
    request,
    owner: owner || {},
    nowMs: Date.now(),
    limit: TOP_N
  })

  // 一个人都没选出来：不调模型，也不编一句"暂时没有推荐"之外的话
  if (!picked.length) {
    return ok({
      capability: AI_CAPABILITY.MATCH_RESPONDERS,
      candidates: [],
      skipped,
      poolSize: pool.length,
      message: '这座城里暂时没有合适的人可以推荐，等等看有没有人主动响应'
    })
  }

  const res = await aiService.invoke({
    openid,
    capability: AI_CAPABILITY.MATCH_RESPONDERS,
    params: {
      city: request.city,
      category: request.category,
      title: request.title,
      candidates: picked
    }
  })

  // 模型失败不影响名单：名单是代码算的，理由退回模板拼接即可（D-15）
  const reasons = res.ok && res.data ? res.data.reasons : []
  const withReasons = attachReasons(picked, reasons)

  return ok({
    capability: AI_CAPABILITY.MATCH_RESPONDERS,
    candidates: withReasons.map(publicCandidate),
    skipped,
    poolSize: pool.length,
    degraded: !res.ok,
    meta: res.ok ? res.meta : null
  })
}

module.exports = {
  POOL_LIMIT,
  TOP_N,
  REASON_SOURCE,
  attachReasons,
  recommend
}
