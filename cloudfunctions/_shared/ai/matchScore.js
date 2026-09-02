/**
 * 匹配打分与推荐理由校验（M2-11 的纯逻辑部分）。**打分用代码算，不用模型**（计划第 1 条）。
 *
 * 为什么打分不给模型做：这是"分发匹配"，按 D-20 属于必须有单测的一类逻辑。
 * 模型算的分不可复现、改一版 Prompt 排序就变，而排序错了没有任何报错。
 *
 * 模型只做一件事：把 `evidence` 里的依据字段写成一句人话。
 * 理由里出现的每个事实都必须能追溯到依据字段（PRD 5.4 可解释性红线），
 * 这条由 `verifyReason` 在服务端强制，不依赖模型自觉。
 *
 * **对计划的一处偏离（重要）**：计划第 3 条要求候选池取"该城市 + 有对应能力标签或历史同品类完成记录"。
 * 但 M1 的数据结构里**还没有任何地方写入能力标签与同品类完成记录**（能力标签属 M3 增信体系，
 * 同品类完成记录要等评价体系落地）。把它们当硬门槛，候选池会恒为空，这条能力等于没做。
 * 所以这里把两项降级为**加分项**，硬门槛只保留城市与性别规则。等 M3 有了标签写入方再收紧。
 */

const { GENDER, PREFERENCE_FLAG, REQUEST_CATEGORY_LABEL } = require('../constants/enums')

/**
 * 打分权重。显式加权，不用黑箱公式 —— 排序不合理时要能一眼看出是哪一项加错了分。
 * 每一项都对应一个**可展示给用户的事实**，没有事实支撑的项不允许存在。
 */
const WEIGHTS = Object.freeze({
  /** 常驻同城：唯一的硬条件，同时也是最有说服力的一条依据 */
  SAME_CITY: 2,
  /** 标注过对应能力标签（M3 起才有数据，见文件头注释） */
  ABILITY_TAG: 4,
  /** 做过同品类的单，每次 3 分，最多算 3 次 */
  SAME_CATEGORY_DONE: 3,
  /** 完成过的单数，每单 1 分，最多算 5 次 */
  DONE_COUNT: 1,
  /** 响应快：半小时内 3 分，两小时内 1 分（没有这个数据时不给分，不编） */
  FAST_RESPONSE: 3,
  MEDIUM_RESPONSE: 1,
  /** 最近活跃过：不活跃的人推给他也是白推 */
  RECENT_ACTIVE: 2
})

const SAME_CATEGORY_CAP = 3
const DONE_COUNT_CAP = 5
const FAST_RESPONSE_MINUTES = 30
const MEDIUM_RESPONSE_MINUTES = 120
const RECENT_ACTIVE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** 候选被排除的原因，用于验证时说清"为什么这个人没进名单" */
const SKIP_REASON = Object.freeze({
  IS_OWNER: 'is_owner',
  OTHER_CITY: 'other_city',
  GENDER_UNSET: 'gender_unset',
  GENDER_MISMATCH: 'gender_mismatch',
  NO_EVIDENCE: 'no_evidence'
})

const cityNameOf = cityCode => (cityCode === 'london' ? '伦敦' : cityCode)

/**
 * 给一个候选打分并列出依据。
 *
 * @returns {{score: number, evidence: Array<{field: string, value: *, text: string, points: number}>}}
 *          `evidence[].text` 是唯一允许出现在推荐理由里的说法。
 */
const scoreCandidate = ({ candidate = {}, request = {}, nowMs = 0 }) => {
  const evidence = []
  const add = (field, value, text, points) => evidence.push({ field, value, text, points })

  if (candidate.city && candidate.city === request.city) {
    add('city', candidate.city, `常驻${cityNameOf(candidate.city)}`, WEIGHTS.SAME_CITY)
  }

  const tags = Array.isArray(candidate.abilityTags) ? candidate.abilityTags : []
  if (request.category && tags.includes(request.category)) {
    add(
      'abilityTags',
      request.category,
      `标注过能做${REQUEST_CATEGORY_LABEL[request.category] || request.category}`,
      WEIGHTS.ABILITY_TAG
    )
  }

  const sameCategoryDone = Number(candidate.sameCategoryDoneCount) || 0
  if (sameCategoryDone > 0) {
    const counted = Math.min(sameCategoryDone, SAME_CATEGORY_CAP)
    add(
      'sameCategoryDoneCount',
      sameCategoryDone,
      `做过 ${sameCategoryDone} 次${REQUEST_CATEGORY_LABEL[request.category] || '同类'}`,
      counted * WEIGHTS.SAME_CATEGORY_DONE
    )
  }

  const doneCount = Number(candidate.doneCount) || 0
  if (doneCount > 0) {
    add(
      'doneCount',
      doneCount,
      `完成过 ${doneCount} 单`,
      Math.min(doneCount, DONE_COUNT_CAP) * WEIGHTS.DONE_COUNT
    )
  }

  // 平均响应时长：M1 没有这个数据源（architecture.md 已注明），字段缺失时**不给分也不编话**
  const avgMinutes = Number.isFinite(candidate.avgResponseMinutes) ? candidate.avgResponseMinutes : null
  if (avgMinutes !== null && avgMinutes >= 0) {
    if (avgMinutes <= FAST_RESPONSE_MINUTES) {
      add('avgResponseMinutes', avgMinutes, `平均 ${Math.round(avgMinutes)} 分钟内响应`, WEIGHTS.FAST_RESPONSE)
    } else if (avgMinutes <= MEDIUM_RESPONSE_MINUTES) {
      add('avgResponseMinutes', avgMinutes, `平均 ${Math.round(avgMinutes)} 分钟响应`, WEIGHTS.MEDIUM_RESPONSE)
    }
  }

  const lastActiveMs = candidate.lastActiveAt ? new Date(candidate.lastActiveAt).getTime() : 0
  if (lastActiveMs && nowMs && nowMs - lastActiveMs <= RECENT_ACTIVE_DAYS * DAY_MS) {
    const days = Math.max(0, Math.floor((nowMs - lastActiveMs) / DAY_MS))
    add('lastActiveAt', candidate.lastActiveAt, days <= 1 ? '今天还在用' : `${days} 天内活跃过`, WEIGHTS.RECENT_ACTIVE)
  }

  return { score: evidence.reduce((sum, item) => sum + item.points, 0), evidence }
}

/**
 * 硬门槛。返回 null 表示通过。
 *
 * 「仅同性响应」按 D-26 的规则过滤：**未填性别者不进候选** ——
 * 这不是排序问题，是安全开关，宁可少推几个人。
 */
const rejectReason = ({ candidate = {}, request = {}, owner = {} }) => {
  if (candidate.openid && candidate.openid === request.ownerOpenid) return SKIP_REASON.IS_OWNER
  if (candidate.city !== request.city) return SKIP_REASON.OTHER_CITY

  const flags = request.preferences || {}
  if (flags[PREFERENCE_FLAG.SAME_GENDER_ONLY] === true) {
    if (!candidate.gender || candidate.gender === GENDER.UNSET) return SKIP_REASON.GENDER_UNSET
    if (!owner.gender || owner.gender === GENDER.UNSET) return SKIP_REASON.GENDER_UNSET
    if (candidate.gender !== owner.gender) return SKIP_REASON.GENDER_MISMATCH
  }
  return null
}

/**
 * 选出 Top N 候选。
 *
 * **候选不足 N 人时不补空**（计划第 5 条）：凑数推荐会让"推荐"这件事失去意义，
 * 用户看到一个明显不合适的人，对后面几个也不会再信。
 */
const selectCandidates = ({ candidates = [], request = {}, owner = {}, nowMs = 0, limit = 5 }) => {
  const picked = []
  const skipped = []

  for (const candidate of candidates) {
    const reject = rejectReason({ candidate, request, owner })
    if (reject) {
      skipped.push({ openid: candidate.openid, reason: reject })
      continue
    }
    const { score, evidence } = scoreCandidate({ candidate, request, nowMs })
    // 一条依据都没有的人不进名单：没有依据就写不出可解释的理由，等于"猜你喜欢"
    if (!evidence.length) {
      skipped.push({ openid: candidate.openid, reason: SKIP_REASON.NO_EVIDENCE })
      continue
    }
    picked.push({ openid: candidate.openid, score, evidence, candidate })
  }

  picked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // 同分按 openid 排，保证结果稳定可复现
    return String(a.openid).localeCompare(String(b.openid))
  })

  return { picked: picked.slice(0, limit), skipped }
}

/** 依据字段里出现过的所有数字，用于校验理由有没有凭空多出一个数 */
const numbersIn = text => (String(text || '').match(/\d+(?:\.\d+)?/g) || []).map(String)

/**
 * 校验一句推荐理由：**理由里的每个数字都必须能在依据字段里找到**。
 *
 * 为什么只校验数字：模型编造最常见、也最有害的形态就是编一个具体数
 * （"做过 8 次代购"）。措辞可以自由组织，事实不行。纯措辞的越界（"人很好"）
 * 由 Prompt 约束 + 抽查兜住，硬校验数字是性价比最高的一道。
 */
const verifyReason = (reason, evidence = []) => {
  const allowed = new Set()
  for (const item of evidence) {
    for (const num of numbersIn(item.text)) allowed.add(num)
    for (const num of numbersIn(item.value)) allowed.add(num)
  }
  const unsupported = numbersIn(reason).filter(num => !allowed.has(num))
  return { ok: unsupported.length === 0, unsupported }
}

/** 模型不可用或理由不可信时的兜底：直接把依据字段拼成一句话。不好看，但每个字都有据 */
const templateReason = (evidence = []) =>
  evidence
    .slice()
    .sort((a, b) => b.points - a.points)
    .map(item => item.text)
    .join('、')

module.exports = {
  WEIGHTS,
  SAME_CATEGORY_CAP,
  DONE_COUNT_CAP,
  RECENT_ACTIVE_DAYS,
  SKIP_REASON,
  cityNameOf,
  scoreCandidate,
  rejectReason,
  selectCandidates,
  verifyReason,
  templateReason
}
