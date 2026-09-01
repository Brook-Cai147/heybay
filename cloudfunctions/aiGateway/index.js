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
const { AI_CAPABILITY } = require('./_shared/constants/aiCapabilities')
const aiService = require('./_shared/service/aiService')

const badParams = message => ({ ok: false, code: ERROR.BAD_PARAMS, message })

exports.main = createHandler({
  /** 一句话 → 结构化需求单草稿。只解析，不建单（建单仍走 requestFlow.create） */
  parseRequest: ({ openid, params }) => {
    const text = typeof params.text === 'string' ? params.text.trim() : ''
    if (!text) return badParams('先说一句你想找什么，我来帮你整理')
    return aiService.invoke({
      openid,
      capability: AI_CAPABILITY.PARSE_REQUEST,
      params: { text, city: params.city }
    })
  },

  /** 基于站内语料的兜底作答。`snippets` 由 M2-09 的关键词检索给出，本步允许为空 */
  searchKnowledge: ({ openid, params }) => {
    const question = typeof params.question === 'string' ? params.question.trim() : ''
    if (!question) return badParams('想打听什么？说一句就行')
    return aiService.invoke({
      openid,
      capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
      params: {
        question,
        city: params.city,
        snippets: Array.isArray(params.snippets) ? params.snippets.slice(0, 5) : []
      }
    })
  }
})
