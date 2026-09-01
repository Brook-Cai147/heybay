/**
 * 需求单过期判定与在架上限（纯逻辑）。
 *
 * PRD 4.1 规则 1：**需求单必然会终结**，不存在永久挂着的需求 —— 这是解决 V1.0"死水内容堆积"
 * 的第一层施压（PRD 4.7）。算错的后果是单子永不过期，死水问题原地复活，所以这块有测试（D-29）。
 *
 * 铁律：**当前时间必须由调用方显式传入**，本文件不取系统时间、不查库、不用随机数。
 * 否则时间边界无法测试，而这里的全部风险都在边界上。
 */

const { TIMING_TYPE, INSTANT_DURATION } = require('../constants/enums')

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** 预约型的宽限期：期望时间之后 24 小时才过期（PRD 4.1） */
const SCHEDULED_GRACE_MS = 24 * HOUR_MS

/** 即时型各档位的有效时长；TODAY 不是固定时长，按当地日期算到当天结束 */
const INSTANT_DURATION_MS = Object.freeze({
  [INSTANT_DURATION.H1]: 1 * HOUR_MS,
  [INSTANT_DURATION.H3]: 3 * HOUR_MS
})

/** 同城同时在架的需求单上限（PRD 4.1 规则 4）。M1 一律按 FREE，会员归 M5 */
const ACTIVE_LIMIT = Object.freeze({
  FREE: 3,
  MEMBER: 10
})

const EXPIRY_ERROR = Object.freeze({
  INVALID_TIMING: 'INVALID_TIMING',               // 时效类型不在枚举内
  MISSING_EXPECT_TIME: 'MISSING_EXPECT_TIME',     // 预约型缺期望时间（数据异常）
  MISSING_DURATION: 'MISSING_DURATION',           // 即时型缺有效时长（数据异常）
  INVALID_DURATION: 'INVALID_DURATION',           // 有效时长不在档位内
  INVALID_TIME: 'INVALID_TIME',                   // 时间值无法解析
  MISSING_TIMEZONE: 'MISSING_TIMEZONE'            // 「今天内」缺城市时区信息
})

const fail = (code, message, extra = {}) => {
  const err = new Error(message)
  err.code = code
  Object.assign(err, extra)
  throw err
}

/** 把 Date / 毫秒数 / ISO 字符串统一成毫秒时间戳；无法解析即抛错 */
const toMs = (value, field) => {
  if (value instanceof Date) {
    const ms = value.getTime()
    if (Number.isNaN(ms)) fail(EXPIRY_ERROR.INVALID_TIME, `${field} 是一个无效的 Date`, { field })
    return ms
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(EXPIRY_ERROR.INVALID_TIME, `${field} 不是有效数字`, { field })
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value.trim())
    if (Number.isNaN(ms)) fail(EXPIRY_ERROR.INVALID_TIME, `${field} 无法解析为时间：${value}`, { field })
    return ms
  }
  return fail(EXPIRY_ERROR.INVALID_TIME, `${field} 缺失或格式不对`, { field })
}

/**
 * 求某个时刻在指定时区的 UTC 偏移（毫秒）。用 Intl 而不是硬编码偏移，这样夏令时自动正确 ——
 * 伦敦一年里有半年是 UTC+1，写死偏移会有半年算错。
 *
 * 云函数运行时若缺完整 ICU（timeZone 不被支持），Intl 会忽略 timeZone 参数而回落到运行时本地时区，
 * 结果就悄悄错了。所以这里用一个已知答案自检：夏季伦敦必须是 +60 分钟，不满足就报错，
 * 逼调用方改传 utcOffsetMinutes，而不是给出一个看不出错的答案。
 */
const utcOffsetMsAt = (ms, { timeZone, utcOffsetMinutes } = {}) => {
  if (Number.isFinite(utcOffsetMinutes)) return utcOffsetMinutes * MINUTE_MS
  if (!timeZone) {
    return fail(
      EXPIRY_ERROR.MISSING_TIMEZONE,
      '「今天内」需要城市时区（timeZone 或 utcOffsetMinutes），请检查 cities 配置'
    )
  }
  if (!isTimeZoneSupported()) {
    return fail(
      EXPIRY_ERROR.MISSING_TIMEZONE,
      '当前运行时不支持 IANA 时区（缺完整 ICU），请改传 utcOffsetMinutes'
    )
  }
  return wallClockOffsetMs(ms, timeZone)
}

/** 用 formatToParts 取出目标时区的墙上时间，与真实 UTC 时刻相减即得偏移 */
const wallClockOffsetMs = (ms, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(ms))

  const pick = type => Number(parts.find(part => part.type === type).value)
  const hour = pick('hour') % 24 // 某些实现会把午夜给成 24
  const wallAsUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), hour, pick('minute'), pick('second'))
  return wallAsUtc - Math.floor(ms / 1000) * 1000
}

/** 运行时是否真的支持 IANA 时区（用夏季伦敦 +1h 这个已知答案自检） */
const isTimeZoneSupported = () => {
  try {
    const probe = Date.UTC(2026, 6, 1, 12, 0, 0) // 2026-07-01 12:00Z，伦敦为 BST
    return wallClockOffsetMs(probe, 'Europe/London') === HOUR_MS
  } catch (err) {
    return false
  }
}

/** 某时刻在当地的当天结束（23:59:59.999）对应的 UTC 毫秒 */
const endOfLocalDayMs = (ms, timeZoneInfo) => {
  const offset = utcOffsetMsAt(ms, timeZoneInfo)
  const local = new Date(ms + offset)
  const localEnd = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    23,
    59,
    59,
    999
  )
  return localEnd - offset
}

/**
 * 某时刻在当地的日期键（`YYYY-MM-DD`）。用途：AI 日额度按**当地日期**计数与重置（M2-01）。
 *
 * 为什么不用 UTC 日期：伦敦冬令时与 UTC 同刻，夏令时差 1 小时；用 UTC 会让当地 23:30 的调用
 * 算进第二天的额度，用户看到的"今天还剩 1 次"就是错的。
 */
const localDayKey = (ms, timeZoneInfo) => {
  const local = new Date(ms + utcOffsetMsAt(ms, timeZoneInfo))
  const pad = n => String(n).padStart(2, '0')
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

/**
 * 算出需求单的过期时刻。
 *
 * @param {object} request
 * @param {string} request.timing            TIMING_TYPE 之一
 * @param {*}      [request.expectTime]      预约型的期望时间
 * @param {string} [request.instantDuration] 即时型的时长档位
 * @param {*}      [request.createdAt]       发布时间，即时型的计时起点
 * @param {string} [request.timeZone]        城市 IANA 时区，「今天内」必需
 * @param {number} [request.utcOffsetMinutes] 时区偏移（分钟），运行时不支持 IANA 时区时用
 * @returns {{expireAt: number, rule: string}} expireAt 为毫秒时间戳
 */
const computeExpireAt = request => {
  if (!request || typeof request !== 'object') {
    return fail(EXPIRY_ERROR.INVALID_TIMING, '没有拿到需求单')
  }
  const { timing, expectTime, instantDuration, createdAt, timeZone, utcOffsetMinutes } = request

  if (timing === TIMING_TYPE.SCHEDULED) {
    if (expectTime === undefined || expectTime === null || expectTime === '') {
      return fail(EXPIRY_ERROR.MISSING_EXPECT_TIME, '预约型需求单缺期望时间，属数据异常')
    }
    return {
      expireAt: toMs(expectTime, 'expectTime') + SCHEDULED_GRACE_MS,
      rule: 'scheduled+24h'
    }
  }

  if (timing === TIMING_TYPE.INSTANT) {
    if (!instantDuration) {
      return fail(EXPIRY_ERROR.MISSING_DURATION, '即时型需求单缺有效时长，属数据异常')
    }
    const startedAt = toMs(createdAt, 'createdAt')

    if (instantDuration === INSTANT_DURATION.TODAY) {
      return {
        expireAt: endOfLocalDayMs(startedAt, { timeZone, utcOffsetMinutes }),
        rule: 'instant/today'
      }
    }

    const durationMs = INSTANT_DURATION_MS[instantDuration]
    if (!durationMs) {
      return fail(EXPIRY_ERROR.INVALID_DURATION, `不认识的有效时长档位：${instantDuration}`)
    }
    return { expireAt: startedAt + durationMs, rule: `instant/${instantDuration}` }
  }

  return fail(EXPIRY_ERROR.INVALID_TIMING, `不认识的时效类型：${timing}`)
}

/**
 * 到 nowMs 这一刻，需求单是否已过期。**过期边界本身不算过期**（到点那一毫秒仍有效）。
 * @param {object} request 同 computeExpireAt
 * @param {number} nowMs   当前时间，必须显式传入
 */
const isExpired = (request, nowMs) => {
  if (!Number.isFinite(nowMs)) {
    return fail(EXPIRY_ERROR.INVALID_TIME, 'nowMs 必须显式传入且为有效数字', { field: 'nowMs' })
  }
  return nowMs > computeExpireAt(request).expireAt
}

/**
 * 同城在架上限判定（PRD 4.1 规则 4）。只判断给定数量是否超限，**不查库**。
 * @param {number} activeCount 该用户在该城市当前在架（open / responded）的需求单数
 * @param {object} [options]
 * @param {boolean} [options.isMember=false] M1 一律 false，会员归 M5
 * @param {number}  [options.limit]          显式上限，优先级最高（实际取值来自 configs 集合）
 * @returns {{allowed: boolean, limit: number, remaining: number}}
 */
const checkActiveLimit = (activeCount, options = {}) => {
  const { isMember = false, limit } = options
  if (!Number.isInteger(activeCount) || activeCount < 0) {
    return fail(EXPIRY_ERROR.INVALID_TIME, '在架数量必须是非负整数', { field: 'activeCount' })
  }
  const effectiveLimit = Number.isInteger(limit) && limit >= 0
    ? limit
    : (isMember ? ACTIVE_LIMIT.MEMBER : ACTIVE_LIMIT.FREE)

  return {
    allowed: activeCount < effectiveLimit,
    limit: effectiveLimit,
    remaining: Math.max(0, effectiveLimit - activeCount)
  }
}

module.exports = {
  SCHEDULED_GRACE_MS,
  INSTANT_DURATION_MS,
  ACTIVE_LIMIT,
  EXPIRY_ERROR,
  isTimeZoneSupported,
  // 时区换算只此一份：M2-01 的日额度重置直接复用，不再写第二套（写两套必然漂移）
  endOfLocalDayMs,
  localDayKey,
  computeExpireAt,
  isExpired,
  checkActiveLimit
}
