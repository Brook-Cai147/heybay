/**
 * 落地清单（M2-12）。这是 PRD 5.6 里唯一"真正贵"的一类能力，所以它同时在验证三件事：
 * 长输出档模型能不能用、每日限免 1 次拦不拦得住、缓存能不能把重复请求的钱省下来。
 *
 * **高风险事实不让模型编**（计划第 3 条）：紧急号码、使领馆信息从 `configs` 的城市配置里取，
 * 其余经验类内容从 `knowledge` 检索。模型只做组织与表达。
 * 号码这类信息模型"记得"的版本往往是对的，但错一次的代价用户承担不起，不值得赌。
 */

const { ERROR, fail } = require('../constants/errors')
const { AI_CAPABILITY } = require('../constants/aiCapabilities')
const { search } = require('./knowledgeSearch')
const aiService = require('./aiService')
const configsDao = require('../dao/configs')

/** 出行类型白名单。开放输入会让缓存键炸开，也会让 Prompt 收到"随便"这种没法用的值 */
const TRAVEL_TYPE = Object.freeze({
  STUDY: '留学',
  TRAVEL: '旅游',
  WORK: '工作',
  VISIT: '探亲',
  RELOCATE: '搬家定居'
})

const TRAVEL_TYPE_VALUES = Object.freeze(Object.values(TRAVEL_TYPE))

const ARRIVE_AT_MAX = 40

/** 检索给清单用的经验语料：按出行类型拼一句检索词，够把安全与证件类语料捞出来 */
const RETRIEVAL_QUERY = '落地第一周要办电话卡银行卡证件注册交通报警'

/**
 * 把城市配置里的高风险事实整理成"键：值"，交给 Prompt 照抄。
 * 配置缺失时返回空对象 —— 宁可清单里没有紧急号码，也不要让模型补一个。
 */
const factsOf = city => {
  const emergency = (city && city.emergency) || {}
  const facts = {}
  if (emergency.police) facts['报警电话'] = emergency.police
  if (emergency.medical) facts['医疗求助'] = emergency.medical
  if (emergency.fire) facts['火警急救'] = emergency.fire
  if (emergency.embassy) facts['使领馆'] = emergency.embassy
  return facts
}

/**
 * 生成落地清单。
 *
 * @param {object} input
 * @param {string} input.openid
 * @param {object} input.params `{ city, arriveAt, travelType }`
 * @returns {object} 成功时 `{ ok: true, groups, reminder, facts, meta }`；
 *          超额度与降级原样透传 `aiService` 的返回（端侧只认一套形状）。
 */
const generate = async ({ openid, params = {} }) => {
  const cityCode = params.city || 'london'
  const arriveAt = String(params.arriveAt || '').trim().slice(0, ARRIVE_AT_MAX)
  const travelType = String(params.travelType || '').trim()

  if (!arriveAt) fail(ERROR.BAD_PARAMS, '什么时候到？写个大概时间就行')
  if (!TRAVEL_TYPE_VALUES.includes(travelType)) {
    fail(ERROR.BAD_PARAMS, `出行类型只能是这几种：${TRAVEL_TYPE_VALUES.join('、')}`)
  }

  const city = (await configsDao.getValue(`city_${cityCode.toLowerCase()}`)) || {}
  const facts = factsOf(city)
  const found = await search({ city: cityCode, question: RETRIEVAL_QUERY })

  const res = await aiService.invoke({
    openid,
    capability: AI_CAPABILITY.GENERATE_CHECKLIST,
    params: { city: cityCode, arriveAt, travelType, facts, snippets: found.snippets }
  })

  // 额度耗尽（每日限免 1 次）与降级都原样返回：端侧据此给"明天再来或开通会员"的文案（计划第 4 条）
  if (!res.ok) return res

  const data = res.data || {}
  return {
    ok: true,
    capability: AI_CAPABILITY.GENERATE_CHECKLIST,
    groups: data.groups || [],
    reminder: data.reminder || null,
    // 把注入的事实一起回给端侧：它是"这些号码不是模型编的"的凭据
    facts,
    retrieval: { hitCount: found.snippets.length },
    meta: res.meta
  }
}

module.exports = {
  TRAVEL_TYPE,
  TRAVEL_TYPE_VALUES,
  ARRIVE_AT_MAX,
  factsOf,
  generate
}
