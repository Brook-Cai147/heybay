/**
 * aiGateway 的编排层（M2-04）——**全项目唯一的模型出口**。
 *
 * tech-stack 6.1 的八步，顺序不可调换：
 *   1 鉴权取 openid（handler 做）  2 额度检查   3 缓存查询（M2-04 直通，M2-05 接上）
 *   4 Prompt 组装                 5 模型调用   6 输出校验
 *   7 降级                        8 记账写 aiLogs
 *
 * 为什么额度在缓存之前：缓存命中不该扣额度，但"这个人今天还能不能用"要先于一切副作用判断，
 * 否则被拦下的用户仍然会在日志里留下一次调用记录，用量统计就不干净了。
 *
 * **本文件不抛错给端侧**（D-15）。模型超时、返回乱码、校验不过，一律翻译成
 * `{ ok: false, code: AI_FALLBACK, fallback: {...} }`，让调用页退回纯表单/纯手动，功能一项不少。
 */

const { ERROR, ok } = require('../constants/errors')
const { AI_CAPABILITY, QUOTA_TIER } = require('../constants/aiCapabilities')
const registry = require('../ai/registry')
const modelClient = require('../ai/modelClient')
const aiCache = require('../ai/cache')
const { buildVars } = require('../ai/promptVars')
const { checkQuota, computeCost, QUOTA_RESULT } = require('./aiQuota')
const { localDayKey } = require('./requestExpiry')
const { validate, decideFallback, FALLBACK_DECISION, MAX_RETRIES } = require('./aiSchemaValidator')
const { schemaOf } = require('../schemas')
const aiLogsDao = require('../dao/aiLogs')
const aiCacheDao = require('../dao/aiCache')
const eventsDao = require('../dao/events')
const configsDao = require('../dao/configs')
const trackService = require('./trackService')

/** 联调期把 AI 调用也标成测试数据，和 M1 的口径一致，便于一次性清理 */
const INCLUDE_TEST_DATA = true

/** 记一次调用的结果分类，落在 `aiLogs.result` 上 */
const AI_RESULT = Object.freeze({
  SUCCESS: 'success',
  CACHED: 'cached',
  QUOTA_BLOCKED: 'quota_blocked',
  FALLBACK: 'fallback'
})

const cityConfigKey = city => `city_${String(city || '').toLowerCase()}`

/** 单价从环境变量取（元 / 百万 token）。缺配置时按 0 记账，宁可少记也不要编一个价 */
const priceOf = modelTier => ({
  inputPricePerMTokens: Number(
    process.env[modelTier === registry.MODEL_TIER.LONG_OUTPUT ? 'AI_LONG_PRICE_IN' : 'AI_PRIMARY_PRICE_IN'] ||
      process.env.AI_PRIMARY_PRICE_IN ||
      0
  ),
  outputPricePerMTokens: Number(
    process.env[modelTier === registry.MODEL_TIER.LONG_OUTPUT ? 'AI_LONG_PRICE_OUT' : 'AI_PRIMARY_PRICE_OUT'] ||
      process.env.AI_PRIMARY_PRICE_OUT ||
      0
  )
})

/** 写日志失败不能连带整次调用失败：AI 已经成功了，用户不该因为记账出错而看到报错 */
const safeLog = async log => {
  try {
    return await aiLogsDao.insert(log, INCLUDE_TEST_DATA)
  } catch (err) {
    console.error('[aiGateway] 写 aiLogs 失败（不影响本次返回）', err)
    return null
  }
}

/** 每次调用都上报一条埋点（事件字典 ② AI 组，PRD 7.3）。埋点不阻断业务 */
const trackCall = ({ openid, capability, durationMs, tokenIn, tokenOut, fromCache }) =>
  trackService.reportSafely({
    openid,
    name: 'ai_capability_called',
    params: { capability, durationMs, tokenIn, tokenOut, fromCache },
    isTest: INCLUDE_TEST_DATA
  })

/** 降级也要留痕：D-15 的护栏如果静默生效，就没人知道 AI 其实一直在失败 */
const trackFallback = ({ openid, capability, reason }) =>
  trackService.reportSafely({
    openid,
    name: 'ai_fallback_triggered',
    params: { capability, reason: reason || 'unknown' },
    isTest: INCLUDE_TEST_DATA
  })

/**
 * 把模型返回的文本解析成对象。
 * 容忍两种常见脏输出：外面套 ```json 代码块、前后带解释文字。
 * **不容忍**结构错误 —— 那是校验器的活，这里只负责"能不能读成 JSON"。
 */
const parseModelJson = text => {
  const raw = String(text || '').trim()
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped
  try {
    const value = JSON.parse(candidate)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: '模型返回的不是 JSON 对象' }
    }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, message: `模型返回的不是合法 JSON：${candidate.slice(0, 200)}` }
  }
}

/** 城市配置缺失时按 UTC 算「当日」：宁可日界差几小时，也不要因为配置缺失整条能力不可用 */
const zoneInfoOf = city =>
  city && city.timeZone ? { timeZone: city.timeZone } : { utcOffsetMinutes: 0 }

/** 当日全局成本上限（元）。配置缺失或关闭时返回 0 = 不设限 */
const loadCostCeiling = async () => {
  const config = await configsDao.getValue('ai_daily_cost_limit')
  if (!config || config.enabled !== true) return 0
  const limit = Number(config.limitCny)
  return Number.isFinite(limit) && limit > 0 ? limit : 0
}

/** 触发成本护栏时记一条告警事件：护栏静默生效等于线上「AI 突然不好用了」，必须留痕 */
const raiseCostAlert = async payload => {
  try {
    await eventsDao.insert(
      Object.assign({ name: 'ai_cost_ceiling_hit', openid: '' }, payload),
      INCLUDE_TEST_DATA
    )
  } catch (err) {
    console.error('[aiGateway] 成本告警事件写入失败（不影响降级返回）', err && err.message)
  }
}

/**
 * 统一的降级返回（D-15：**返回值而不是异常**）。
 * 成本护栏、模型失败、校验失败三条路都走这里，保证端侧只需要认一种形状。
 */
const fallbackResult = async ({
  record,
  capability,
  openid,
  dayKey,
  reasonCode,
  message,
  totals,
  attempts,
  errors = [],
  model = ''
}) => {
  const cost = computeCost(Object.assign({}, totals, priceOf(record.modelTier)))
  const logId = await safeLog({
    openid,
    capability,
    dayKey,
    // 降级不计额度：这次没给用户拿到东西，扣次数是双重惩罚
    quotaCounted: false,
    modelTier: record.modelTier,
    model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cost,
    latencyMs: totals.latencyMs,
    attempts,
    result: AI_RESULT.FALLBACK,
    errorCode: reasonCode
  })
  await trackFallback({ openid, capability, reason: reasonCode })
  return {
    ok: false,
    code: ERROR.AI_FALLBACK,
    message,
    fallback: {
      strategy: record.fallback,
      reasonCode,
      attempts,
      errors: errors.slice(0, 5),
      logId
    }
  }
}

const invoke = async ({ openid, capability, params = {} }) => {
  // 第 1 步：能力必须已登记且已实现。占位项在这里被拦住，而不是走到模型调用才炸
  let record
  try {
    record = registry.assertCallable(capability)
  } catch (err) {
    return {
      ok: false,
      code: ERROR.AI_NOT_AVAILABLE,
      message: '这个功能还没上线',
      debug: String(err && err.message).slice(0, 200)
    }
  }

  const nowMs = Date.now()
  const city = (await configsDao.getValue(cityConfigKey(params.city || 'london'))) || {}
  const dayKey = localDayKey(nowMs, zoneInfoOf(city))

  // 第 2 步：额度检查。只有每日限免档才需要真去数一次，其余两档不查库
  let usedToday = 0
  if (record.quotaTier === QUOTA_TIER.DAILY) {
    usedToday = await aiLogsDao.countUsedToday({ openid, capability, dayKey })
  }
  // isMember 恒为 false：会员体系在 M5，此处**不读端侧传来的 isMember**（端侧不可信）
  const quota = checkQuota({
    capability,
    usedToday,
    nowMs,
    isMember: false,
    timeZone: city.timeZone,
    utcOffsetMinutes: city.timeZone ? undefined : 0
  })
  if (!quota.allowed) {
    await safeLog({
      openid,
      capability,
      dayKey,
      quotaCounted: false,
      modelTier: record.modelTier,
      result: quota.result === QUOTA_RESULT.QUOTA_EXCEEDED ? AI_RESULT.QUOTA_BLOCKED : AI_RESULT.FALLBACK,
      errorCode: quota.result
    })
    return { ok: false, code: ERROR.AI_QUOTA_EXCEEDED, message: quota.message, quota }
  }

  // 第 3 步：缓存查询（M2-05）。命中不扣额度、不花钱、不写 aiLogs 的成本
  const cacheKey = aiCache.isCacheable(record)
    ? aiCache.cacheKeyOf({ capability, city: city.code || params.city, params })
    : null
  if (cacheKey) {
    const hit = await aiCacheDao.findFresh(cacheKey, nowMs)
    if (hit) {
      await aiCacheDao.bumpHits(hit._id)
      await safeLog({
        openid,
        capability,
        dayKey,
        quotaCounted: false,
        modelTier: record.modelTier,
        result: AI_RESULT.CACHED,
        fromCache: true
      })
      await trackCall({
        openid,
        capability,
        durationMs: 0,
        tokenIn: 0,
        tokenOut: 0,
        fromCache: true
      })
      return ok({
        capability,
        data: hit.value,
        meta: { fromCache: true, attempts: 0, latencyMs: 0, cost: 0, cacheKey }
      })
    }
  }

  // 成本护栏（M2-05）：只拦非免费档。免费档（解析、机审）被拦会直接伤主转化路径，
  // 而它们恰恰是最便宜的那批 —— 拦它们省不下多少钱，代价却是发布流程变难用。
  if (record.quotaTier !== QUOTA_TIER.UNLIMITED) {
    const ceiling = await loadCostCeiling()
    if (ceiling > 0) {
      const spent = await aiLogsDao.sumCostByDay(dayKey)
      if (spent >= ceiling) {
        await raiseCostAlert({ dayKey, spent, ceiling, capability })
        return fallbackResult({
          record,
          capability,
          openid,
          dayKey,
          reasonCode: 'cost_ceiling',
          message: '今天的 AI 用量已经到上限了，这个功能明天恢复；你可以先用普通表单继续',
          totals: { inputTokens: 0, outputTokens: 0, latencyMs: 0 },
          attempts: 0,
          errors: []
        })
      }
    }
  }

  // 第 4 步：Prompt 组装。占位符没填满会抛错，这是接线 bug，不该静默
  const prompt = registry.renderPrompt(capability, buildVars(capability, { params, city }))
  const schema = schemaOf(capability)

  // 第 5~7 步：调用 → 校验 → 决定重试还是降级。重试次数由 M2-02 的 MAX_RETRIES 统一定
  const totals = { inputTokens: 0, outputTokens: 0, latencyMs: 0 }
  let attempt = 0
  let lastErrors = []
  let lastErrorCode = null
  let usedModel = ''
  // 重试时用的 Prompt：原样重发一遍等于白花一次钱，要把上次的字段级错误回喂给模型
  let currentPrompt = prompt

  while (attempt < MAX_RETRIES + 1) {
    attempt += 1
    let call
    try {
      call = await modelClient.chat({
        modelTier: record.modelTier,
        prompt: currentPrompt,
        timeoutMs: record.timeoutSeconds * 1000
      })
    } catch (err) {
      lastErrorCode = err.code || 'MODEL_UNKNOWN_ERROR'
      lastErrors = [{ path: '', code: lastErrorCode, message: String(err && err.message).slice(0, 300) }]
      console.error(`[aiGateway] ${capability} 第 ${attempt} 次调用失败`, lastErrorCode, err && err.message)
      // 没配环境变量重试一万次也一样，直接降级
      if (lastErrorCode === modelClient.MODEL_ERROR.NOT_CONFIGURED) break
      continue
    }

    totals.inputTokens += call.inputTokens
    totals.outputTokens += call.outputTokens
    totals.latencyMs += call.latencyMs
    usedModel = call.model

    const parsed = parseModelJson(call.text)
    const validation = parsed.ok
      ? validate(schema, parsed.value)
      : { valid: false, errors: [{ path: '', code: 'not_json', message: parsed.message }], warnings: [], value: null }

    const decision = decideFallback({
      valid: validation.valid,
      attempt,
      maxRetries: MAX_RETRIES,
      errors: validation.errors
    })

    if (decision.decision === FALLBACK_DECISION.PASS) {
      const cost = computeCost(Object.assign({}, totals, priceOf(record.modelTier)))
      // 缓存写入放在返回之前、且失败不影响返回：缓存是优化，不是正确性的一部分
      if (cacheKey) {
        try {
          await aiCacheDao.upsert(
            {
              cacheKey,
              capability,
              city: city.code || params.city || '',
              value: validation.value,
              expireAtMs: aiCache.expireAtMsOf(record, nowMs)
            },
            INCLUDE_TEST_DATA
          )
        } catch (err) {
          console.error('[aiGateway] 写缓存失败（忽略）', err && err.message)
        }
      }
      const logId = await safeLog({
        openid,
        capability,
        dayKey,
        // 只有真花了钱的调用才计额度
        quotaCounted: record.quotaTier === QUOTA_TIER.DAILY,
        modelTier: record.modelTier,
        model: usedModel,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cost,
        latencyMs: totals.latencyMs,
        attempts: attempt,
        result: AI_RESULT.SUCCESS,
        fromCache: false
      })
      await trackCall({
        openid,
        capability,
        durationMs: totals.latencyMs,
        tokenIn: totals.inputTokens,
        tokenOut: totals.outputTokens,
        fromCache: false
      })
      return ok({
        capability,
        data: validation.value,
        meta: {
          attempts: attempt,
          fromCache: false,
          latencyMs: totals.latencyMs,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cost,
          model: usedModel,
          logId,
          // 多余字段已被剥掉，但要让调用方知道模型多吐了什么，便于改 Prompt
          warnings: validation.warnings,
          quota: { tier: record.quotaTier, limit: quota.limit, remaining: quota.remaining }
        }
      })
    }

    lastErrors = validation.errors
    lastErrorCode = decision.reasonCode
    if (decision.decision === FALLBACK_DECISION.RETRY) {
      // 只在原始 Prompt 后追加错误清单，不累积多轮 —— 避免第二次的 Prompt 里带着第一次的噪音
      currentPrompt = decision.retryHint
        ? `${prompt}\n\n【上一次的输出有这些问题，请修正后重新输出完整 JSON】\n${decision.retryHint}`
        : prompt
      continue
    }
    break
  }

  // 第 7 步：降级
  return fallbackResult({
    record,
    capability,
    openid,
    dayKey,
    reasonCode: lastErrorCode,
    message: '这次没能自动整理好，你可以直接用表单填，一样能发出去',
    totals,
    attempts: attempt,
    errors: lastErrors,
    model: usedModel
  })
}

module.exports = {
  AI_RESULT,
  invoke
}
