/**
 * AI 额度判定与成本记账（M2-01）。**纯逻辑，不查库、不取系统时间**。
 *
 * 为什么"当前时间"和"当日已用量"都必须由调用方传入：跨天重置是这块最容易写错的地方，
 * 而它只有在能被测试的前提下才可能写对。函数内部一取 `Date.now()`，跨天用例就没法造。
 *
 * 网关的第 2 步（额度检查）与第 8 步（记账）都只依赖本文件。
 */

const {
  AI_CAPABILITY_VALUES,
  QUOTA_TIER,
  CAPABILITY_TIER,
  DAILY_LIMITS
} = require('../constants/aiCapabilities')
const { endOfLocalDayMs, localDayKey } = require('./requestExpiry')

/** 额度判定的结果码。**不用布尔** —— 端侧要据此给可解释的提示，而不是笼统报错 */
const QUOTA_RESULT = Object.freeze({
  ALLOWED: 'allowed',
  QUOTA_EXCEEDED: 'quota_exceeded',
  UNKNOWN_CAPABILITY: 'unknown_capability'
})

/** 成本保留到 0.0001 元：单次调用常在千分之几元，四位小数才不会被抹成 0 */
const COST_DECIMALS = 4

/** 模型报价的常用单位是"元 / 百万 token" */
const TOKENS_PER_UNIT = 1000000

const isKnownCapability = capability => AI_CAPABILITY_VALUES.includes(capability)

/** 能力的额度类别；未登记的能力返回 null（网关据此拒绝，而不是默认放行） */
const tierOf = capability => (isKnownCapability(capability) ? CAPABILITY_TIER[capability] || null : null)

/** 某能力对某档用户的当日上限；无限档返回 `Infinity`，未登记返回 null */
const dailyLimitOf = (capability, isMember = false) => {
  const tier = tierOf(capability)
  if (!tier) return null
  if (tier !== QUOTA_TIER.DAILY) return Infinity
  const limits = DAILY_LIMITS[capability]
  if (!limits) return null
  return isMember ? limits.member : limits.free
}

/**
 * 额度检查。
 *
 * @param {object} input
 * @param {string} input.capability      能力名
 * @param {number} input.usedToday       该用户今日（**当地日期**）已用次数
 * @param {number} input.nowMs           当前时间戳，显式传入
 * @param {boolean} [input.isMember]     是否会员
 * @param {string} [input.timeZone]      城市 IANA 时区，用于算"下次可用时间"
 * @param {number} [input.utcOffsetMinutes] 运行时不支持 IANA 时区时的退路
 * @returns {object} `{ result, allowed, tier, limit, usedToday, remaining, ... }`
 */
const checkQuota = ({
  capability,
  usedToday = 0,
  nowMs,
  isMember = false,
  timeZone,
  utcOffsetMinutes
} = {}) => {
  const tier = tierOf(capability)
  if (!tier) {
    return {
      result: QUOTA_RESULT.UNKNOWN_CAPABILITY,
      allowed: false,
      capability: capability === undefined ? null : capability,
      message: '这个 AI 能力还没登记，不能调用'
    }
  }

  const limit = dailyLimitOf(capability, isMember)
  const used = Number.isFinite(usedToday) && usedToday > 0 ? Math.floor(usedToday) : 0

  // 无限免费与系统调用一律放行：这两档的存在意义就是"永远不因额度失败"
  if (limit === Infinity) {
    return {
      result: QUOTA_RESULT.ALLOWED,
      allowed: true,
      capability,
      tier,
      limit: Infinity,
      usedToday: used,
      remaining: Infinity
    }
  }

  if (used >= limit) {
    const resetAtMs = typeof nowMs === 'number'
      ? endOfLocalDayMs(nowMs, { timeZone, utcOffsetMinutes }) + 1
      : null
    return {
      result: QUOTA_RESULT.QUOTA_EXCEEDED,
      allowed: false,
      capability,
      tier,
      limit,
      usedToday: used,
      remaining: 0,
      resetAtMs,
      // 免费用户还有"升级会员"这条路，会员到顶就只能等重置 —— 提示语必须区分这两种
      upgradable: !isMember,
      message: isMember
        ? '今天这项功能的次数用完了，明天当地零点后恢复'
        : '今天这项功能的免费次数用完了，明天当地零点后恢复；开会员可以提高上限'
    }
  }

  return {
    result: QUOTA_RESULT.ALLOWED,
    allowed: true,
    capability,
    tier,
    limit,
    usedToday: used,
    remaining: limit - used
  }
}

/**
 * 本次调用的成本（人民币元）。
 *
 * 报价按"元 / 百万 token"，输入与输出分开计（多数模型输出比输入贵）。
 * 结果保留四位小数，供 `aiLogs` 记账与 PRD 5.5「每次成功撮合的 AI token 成本 ≤0.10 元」核算。
 */
const computeCost = ({
  inputTokens = 0,
  outputTokens = 0,
  inputPricePerMTokens = 0,
  outputPricePerMTokens = 0
} = {}) => {
  const safe = n => (Number.isFinite(n) && n > 0 ? n : 0)
  const raw =
    (safe(inputTokens) * safe(inputPricePerMTokens) +
      safe(outputTokens) * safe(outputPricePerMTokens)) /
    TOKENS_PER_UNIT
  // 用整数中转再除，避免 toFixed 的浮点表现问题
  const factor = Math.pow(10, COST_DECIMALS)
  return Math.round(raw * factor) / factor
}

/** 日用量的计数键：能力 + 当地日期。用量文档按此键累加（M2-05 接真实用量时用） */
const usageKey = ({ capability, nowMs, timeZone, utcOffsetMinutes }) =>
  `${capability}:${localDayKey(nowMs, { timeZone, utcOffsetMinutes })}`

module.exports = {
  QUOTA_RESULT,
  COST_DECIMALS,
  TOKENS_PER_UNIT,
  isKnownCapability,
  tierOf,
  dailyLimitOf,
  checkQuota,
  computeCost,
  usageKey
}
