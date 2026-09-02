/**
 * aiGateway —— **全项目唯一的模型出口**（M2-04）。
 *
 * handler 只做三件事：取身份（由 `createHandler` 完成）、校验入参形状、按 action 分发。
 * 额度、缓存、Prompt 组装、重试、校验、降级、记账全在 `_shared/service/aiService.js`
 * （`architecture.md` 分层铁律：handler 不写业务逻辑）。
 *
 * 每个 AI 能力**不再新增云函数**，只是这里多一个 action + 注册表里多一条记录。
 *
 * `_shared` 是 `npm run sync` 复制进来的副本，改共享代码后必须重新 sync 再上传。
 * 模型 API Key 只在**云函数环境变量**里，仓库与端侧都碰不到。
 */

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { createHandler } = require('./_shared/service/dispatch')
const { ERROR } = require('./_shared/constants/errors')
const parseRequestService = require('./_shared/service/parseRequestService')
const fallbackAnswerService = require('./_shared/service/fallbackAnswerService')
const matchService = require('./_shared/service/matchService')
const checklistService = require('./_shared/service/checklistService')

const badParams = message => ({ ok: false, code: ERROR.BAD_PARAMS, message })

exports.main = createHandler({
  /**
   * 一句话 → 结构化需求单草稿。只解析，不建单（建单仍走 requestFlow.create）。
   * 编排在 parseRequestService：四类字段抹空、品类白名单、来源标记推断都在那一层。
   */
  parseRequest: ({ openid, params }) => {
    const text = typeof params.text === 'string' ? params.text.trim() : ''
    if (!text) return badParams('先说一句你想找什么，我来帮你整理')
    return parseRequestService.parse({ openid, params: { text, city: params.city } })
  },

  /**
   * 基于站内语料的兜底作答（M2-10）。编排在 fallbackAnswerService：
   * 拒答前置拦截、语料检索、来源白名单都在那一层，**snippets 不再由端侧传入** ——
   * 端侧能塞语料就等于能给答案伪造来源。
   */
  searchKnowledge: ({ openid, params }) => {
    const question = typeof params.question === 'string' ? params.question.trim() : ''
    if (!question) return badParams('想打听什么？说一句就行')
    return fallbackAnswerService.answer({ openid, params: { question, city: params.city } })
  },

  /**
   * 给自己的需求单找可能帮得上的人（M2-11）。**只产出名单与理由，不发送任何东西** ——
   * 自动触达与频控属 M5。打分在代码里，模型只写理由。
   */
  matchResponders: ({ openid, params }) =>
    matchService.recommend({ openid, params: { requestId: params.requestId } }),

  /**
   * 落地清单（M2-12）。长输出档 + 每日限免 1 次，是唯一需要盯着成本看的能力。
   */
  generateChecklist: ({ openid, params }) =>
    checklistService.generate({
      openid,
      params: { city: params.city, arriveAt: params.arriveAt, travelType: params.travelType }
    })
})
