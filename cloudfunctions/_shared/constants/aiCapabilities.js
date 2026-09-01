/**
 * AI 能力名与额度类别（M2-01）。**云侧独有**，端侧不需要副本。
 *
 * 这张表是 PRD 5.2 的 14 项能力地图在代码里的唯一登记处。新增能力 = 往这里加一条，
 * 而不是在网关里加 if —— 这是 M2-03 注册表能"加一条就上线"的前提。
 *
 * 额度三档（PRD 5.6）落到数据结构上是"能力类别 × 用户档位"：
 *   UNLIMITED  无限免费 —— 短文本、且在主转化路径上，拦一次的代价远大于省下的钱
 *   DAILY      每日限免 —— 长输出或对外触达，免费用户按 `DAILY_LIMITS` 计，会员放开
 *   SYSTEM     系统调用 —— 定时任务发起，不属于任何用户的额度
 */

/** PRD 5.2 的 14 项能力，键名与工具名（function calling 的 name）一致 */
const AI_CAPABILITY = Object.freeze({
  PARSE_REQUEST: 'parseRequest',
  CREATE_REQUEST: 'createRequest',
  SEARCH_KNOWLEDGE: 'searchKnowledge',
  MATCH_RESPONDERS: 'matchResponders',
  DRAFT_INVITE: 'draftInvite',
  BROADCAST: 'broadcast',
  GENERATE_CHECKLIST: 'generateChecklist',
  MODERATE: 'moderate',
  RISK_HINT: 'riskHint',
  GENERATE_XHS_POST: 'generateXhsPost',
  EMERGENCY_CARD: 'emergencyCard',
  DAILY_TOPIC: 'dailyTopic',
  SUMMARIZE_REVIEWS: 'summarizeReviews',
  TRANSLATE: 'translate'
})

const AI_CAPABILITY_VALUES = Object.freeze(Object.values(AI_CAPABILITY))

/** 额度类别 */
const QUOTA_TIER = Object.freeze({
  UNLIMITED: 'unlimited',
  DAILY: 'daily',
  SYSTEM: 'system'
})

const QUOTA_TIER_VALUES = Object.freeze(Object.values(QUOTA_TIER))

/**
 * 能力 → 额度类别。
 *
 * 归类依据是 PRD 5.6 的额度设计，其中五项 PRD 没有点名，按同一原则归入 UNLIMITED 并在此说明：
 *   - `createRequest` 只写库不调模型，没有 token 成本
 *   - `matchResponders` / `draftInvite` 在主转化路径上（发布后立刻要用、L1 是全局默认档），
 *     限额会直接压低撮合成功率，而它们是短文本、成本低
 *   - `emergencyCard` 是应急场景，**任何情况下都不能因为额度被拦**
 *   - `translate`、`summarizeReviews`、`moderate`、`riskHint` PRD 已明确无限免费
 */
const CAPABILITY_TIER = Object.freeze({
  [AI_CAPABILITY.PARSE_REQUEST]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.CREATE_REQUEST]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.MODERATE]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.RISK_HINT]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.TRANSLATE]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.SUMMARIZE_REVIEWS]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.MATCH_RESPONDERS]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.DRAFT_INVITE]: QUOTA_TIER.UNLIMITED,
  [AI_CAPABILITY.EMERGENCY_CARD]: QUOTA_TIER.UNLIMITED,

  [AI_CAPABILITY.SEARCH_KNOWLEDGE]: QUOTA_TIER.DAILY,
  [AI_CAPABILITY.GENERATE_CHECKLIST]: QUOTA_TIER.DAILY,
  [AI_CAPABILITY.GENERATE_XHS_POST]: QUOTA_TIER.DAILY,
  [AI_CAPABILITY.BROADCAST]: QUOTA_TIER.DAILY,

  [AI_CAPABILITY.DAILY_TOPIC]: QUOTA_TIER.SYSTEM
})

/**
 * 每日限免的额度（PRD 5.6）。会员是"×10 或不限"，这里一律取 ×10 ——
 * "不限"在没有成本护栏之前是危险承诺，M2-05 的全局成本上限才是真正的兜底。
 */
const DAILY_LIMITS = Object.freeze({
  [AI_CAPABILITY.SEARCH_KNOWLEDGE]: Object.freeze({ free: 5, member: 50 }),
  [AI_CAPABILITY.GENERATE_CHECKLIST]: Object.freeze({ free: 1, member: 10 }),
  [AI_CAPABILITY.GENERATE_XHS_POST]: Object.freeze({ free: 1, member: 10 }),
  [AI_CAPABILITY.BROADCAST]: Object.freeze({ free: 1, member: 10 })
})

module.exports = {
  AI_CAPABILITY,
  AI_CAPABILITY_VALUES,
  QUOTA_TIER,
  QUOTA_TIER_VALUES,
  CAPABILITY_TIER,
  DAILY_LIMITS
}
