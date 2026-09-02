/**
 * 小螺对话的执行层（M2-13）。**规划在 `ai/orchestrator.js`（纯函数），这里只负责执行。**
 *
 * 五个工具全部**复用已有的 service**，一个都不重写：
 *   parseRequest      → `parseRequestService.parse`
 *   searchKnowledge   → `fallbackAnswerService.answer`（拒答与来源标注都在那一层）
 *   generateChecklist → `checklistService.generate`
 *   matchResponders   → `matchService.recommend`
 *   createRequest     → `requestService.create`（内部经 `transitionRequest` 单一入口）
 *
 * 三条护栏因此天然生效（计划 M2-13 第 5 条：复用不重写）：追问上限在 orchestrator，
 * 拒答边界与来源标注在 `fallbackAnswerService`，四类字段拒填在 `requestValidator`。
 *
 * **`createRequest` 是唯一有副作用的工具**，只在 `confirmed === true` 且带着上一轮草稿时才会被执行。
 */

const { ok } = require('../constants/errors')
const { REQUEST_CATEGORY_LABEL, VISIBILITY } = require('../constants/enums')
const orchestrator = require('../ai/orchestrator')
const { TRAVEL_TYPE_VALUES } = require('./checklistService')
const parseRequestService = require('./parseRequestService')
const fallbackAnswerService = require('./fallbackAnswerService')
const checklistService = require('./checklistService')
const matchService = require('./matchService')
const requestService = require('./requestService')
const requestsDao = require('../dao/requests')

/** 回复的形态。端侧按这个字段决定渲染哪种气泡，不靠猜内容 */
const REPLY_KIND = Object.freeze({
  ANSWER: 'answer',         // 兜底作答（带来源标注）
  DRAFT: 'draft',           // 需求单草稿，等用户确认
  CREATED: 'created',       // 已建单
  CHECKLIST: 'checklist',
  CANDIDATES: 'candidates',
  CLARIFY: 'clarify',       // 追问一次
  OPTIONS: 'options',       // 给三个按钮
  NEED_PARAMS: 'need_params', // 缺必要信息（如出行类型）
  SOFT_FAIL: 'soft_fail'    // 工具降级，但对话不断
})

/** 首屏声明（PRD 5.4 身份明示 / 计划第 4 条）。**放在服务端**，端侧不另写一份文案 */
const GREETING = '我是 AI 助手小螺。我能帮你把一句话整理成需求单、打听站里有人聊过的事、列一份落地清单，也能看看谁可能帮得上你。签证、医疗、法律、移民这四类我不给判断，会直接指你去官方渠道。'

/** 每条回复都带这个标记，端侧据此显示「AI 协助」（不让端侧自己判断哪条是 AI 说的） */
const AI_ASSISTED = true

/**
 * 建单必填项（与 `requestValidator` 同一份清单，缺一项都发不出去）。
 * `visibility` 不在其中：对话里没有选可见范围的地方，助手一律按「城市社区公开」填，
 * 用户要改就去表单改 —— 这比在对话里再塞一个选择器实在。
 */
const REQUIRED_FOR_CREATE = Object.freeze(['category', 'title', 'detail', 'timing', 'rewardType'])

const missingForCreate = draft =>
  REQUIRED_FOR_CREATE.filter(field => {
    const value = draft ? draft[field] : null
    return value === undefined || value === null || String(value).trim() === ''
  })

const reply = (kind, text, extra = {}) =>
  Object.assign({ kind, text, aiAssisted: AI_ASSISTED }, extra)

/** 这个人有没有在架的单。有才谈得上"谁能帮我" */
const activeRequestOf = async (openid, city) => {
  const mine = await requestsDao.listByOwner({ ownerOpenid: openid, includeTest: true, limit: 10 })
  const active = mine.filter(
    item => requestsDao.ACTIVE_STATUSES.includes(item.status) && (!city || item.city === city)
  )
  return active.length ? active[0] : null
}

/** 把兜底答案拼成一条可读的气泡文本：结论 + 来源标注（PRD 5.4） */
const answerText = res => {
  const parts = [res.answer]
  if (res.attribution) parts.push(res.attribution)
  return parts.filter(Boolean).join('\n')
}

/**
 * 走一轮对话。
 *
 * @param {object} input
 * @param {string} input.openid
 * @param {object} input.params
 *   `text`         用户这句话
 *   `city`         当前城市 code
 *   `clarifyCount` 已澄清轮数（端侧带上来，服务端不存会话状态）
 *   `pendingDraft` 上一轮的草稿（端侧带回来，服务端不存会话状态）
 *   `confirmed`    是否刚点了"确认发布"
 *   `forcedIntent` 点了三个按钮之一
 *   `arriveAt` / `travelType` 落地清单要的两个信息
 * @returns {object} 永远 `ok: true` 且带一条 `reply` —— 对话不能因为某个工具失败就断掉（D-15）
 */
const chat = async ({ openid, params = {} }) => {
  const text = String(params.text || '').trim()
  const city = params.city || 'london'
  const clarifyCount = Number(params.clarifyCount) || 0

  const active = await activeRequestOf(openid, city)

  const step = orchestrator.plan({
    text,
    clarifyCount,
    hasActiveRequest: !!active,
    pendingDraft: params.pendingDraft || null,
    confirmed: params.confirmed === true,
    forcedIntent: params.forcedIntent || ''
  })

  if (step.action === 'clarify') {
    return ok({
      intent: step.intent,
      clarifyCount: step.clarifyCount,
      reply: reply(REPLY_KIND.CLARIFY, step.question)
    })
  }

  if (step.action === 'offer_options') {
    return ok({
      intent: step.intent,
      clarifyCount,
      reply: reply(REPLY_KIND.OPTIONS, '直接选一个吧，我照着做：', { options: step.options })
    })
  }

  const base = { intent: step.intent, tool: step.tool, matchedBy: step.matchedBy || '', clarifyCount: 0 }

  if (step.tool === orchestrator.TOOL.SEARCH_KNOWLEDGE) {
    const res = await fallbackAnswerService.answer({ openid, params: { question: text, city } })
    if (!res.ok) {
      return ok(Object.assign({}, base, { reply: reply(REPLY_KIND.SOFT_FAIL, res.message) }))
    }
    return ok(
      Object.assign({}, base, {
        reply: reply(REPLY_KIND.ANSWER, answerText(res), {
          sources: res.sources,
          refused: res.refused,
          refusalReason: res.refusalReason,
          confidence: res.confidence
        })
      })
    )
  }

  if (step.tool === orchestrator.TOOL.PARSE_REQUEST) {
    const res = await parseRequestService.parse({ openid, params: { text, city } })
    if (!res.ok) {
      // 解析失败不在对话里硬撑：明确告诉用户去用表单（D-15）
      return ok(
        Object.assign({}, base, {
          reply: reply(REPLY_KIND.SOFT_FAIL, `${res.message}\n你也可以直接去「喊一声」用表单填，一样能发出去。`)
        })
      )
    }
    const category = REQUEST_CATEGORY_LABEL[res.draft.category] || '还没归类'
    const missing = missingForCreate(res.draft)
    return ok(
      Object.assign({}, base, {
        reply: reply(
          REPLY_KIND.DRAFT,
          `${res.hint || res.draft.summary || '我理解成这样'}\n品类：${category}`,
          {
            // 端侧拿它渲染确认卡片，并在确认时原样回传 —— 服务端不存会话状态
            draft: res.draft,
            fieldSources: res.fieldSources,
            confidence: res.confidence,
            unclassified: res.unclassified,
            aiFilledFields: res.aiFilledFields,
            aiMeta: res.meta ? { logId: res.meta.logId, aiFilledFields: res.aiFilledFields } : null,
            /**
             * 缺必填项时**不给"确认发布"按钮**，改为把这份草稿交给发布页补齐 ——
             * 在对话里再造一套表单，就会有两处要维护、用户还分不清改哪份算
             * （与 M2-07 解析卡片"不复制表单"是同一个判断）。
             */
            missingFields: missing,
            handoff: missing.length ? 'publish' : '',
            // **必须二次确认才建单**（计划第 3 条）
            needsConfirm: missing.length === 0
          }
        )
      })
    )
  }

  if (step.tool === orchestrator.TOOL.CREATE_REQUEST) {
    const draft = step.draft
    const missing = missingForCreate(draft)
    if (missing.length) {
      return ok(
        Object.assign({}, base, {
          reply: reply(REPLY_KIND.SOFT_FAIL, '还差几项才能发出去，去表单补一下更快。', {
            missingFields: missing,
            handoff: 'publish',
            draft
          })
        })
      )
    }

    /**
     * 走到这里说明端侧已经拿到用户的确认。建单仍走 `requestService.create`
     *（内部经 `transitionRequest` 单一入口），**不给助手开后门**。
     * `sources` 必须原样带上：四类字段一旦标成 `ai`，`requestValidator` 会当场拒收 —— 这正是要的。
     */
    try {
      const created = await requestService.create({
        openid,
        params: Object.assign({}, draft, {
          city: draft.city || city,
          visibility: draft.visibility || VISIBILITY.CITY,
          preference: draft.preference || {},
          fieldSources: draft.fieldSources || null,
          aiMeta: draft.aiMeta || null
        }),
        isTest: params.isTest === true
      })
      return ok(
        Object.assign({}, base, {
          reply: reply(REPLY_KIND.CREATED, '发出去了，我把它挂到了需求广场上。', {
            requestId: created.requestId,
            status: created.status,
            expireAt: created.expireAt
          })
        })
      )
    } catch (err) {
      // 建单被拒（字段不合规、在架上限、四类字段被标 ai）都是**可预期的失败**：
      // 原样把人话给用户，对话不断（D-15）
      return ok(
        Object.assign({}, base, {
          reply: reply(REPLY_KIND.SOFT_FAIL, err.message || '这条没能发出去，去表单看看哪里不对？', {
            code: err.code || 'UNEXPECTED',
            errors: err.errors || [],
            handoff: 'publish',
            draft
          })
        })
      )
    }
  }

  if (step.tool === orchestrator.TOOL.GENERATE_CHECKLIST) {
    const travelType = String(params.travelType || '').trim()
    const arriveAt = String(params.arriveAt || '').trim()
    // 缺信息就问，不替用户假设一个出行类型 —— 猜错了整份清单都偏
    if (!travelType || !arriveAt) {
      return ok(
        Object.assign({}, base, {
          reply: reply(REPLY_KIND.NEED_PARAMS, '你大概什么时候到？是哪种出行？', {
            need: [!arriveAt ? 'arriveAt' : null, !travelType ? 'travelType' : null].filter(Boolean),
            travelTypeOptions: TRAVEL_TYPE_VALUES
          })
        })
      )
    }
    const res = await checklistService.generate({ openid, params: { city, arriveAt, travelType } })
    if (!res.ok) {
      return ok(Object.assign({}, base, { reply: reply(REPLY_KIND.SOFT_FAIL, res.message) }))
    }
    return ok(
      Object.assign({}, base, {
        reply: reply(REPLY_KIND.CHECKLIST, res.reminder || '清单在这儿：', {
          groups: res.groups,
          facts: res.facts
        })
      })
    )
  }

  if (step.tool === orchestrator.TOOL.MATCH_RESPONDERS) {
    const res = await matchService.recommend({ openid, params: { requestId: active._id } })
    if (!res.ok) {
      return ok(Object.assign({}, base, { reply: reply(REPLY_KIND.SOFT_FAIL, res.message) }))
    }
    return ok(
      Object.assign({}, base, {
        reply: reply(
          REPLY_KIND.CANDIDATES,
          res.candidates.length ? `这几位可能帮得上「${active.title}」：` : res.message,
          { candidates: res.candidates, requestId: active._id }
        )
      })
    )
  }

  // 到不了这里：orchestrator 只会给出上面这几种工具。真到了就是接线漏了，明确说出来而不是静默
  return ok({
    intent: step.intent,
    reply: reply(REPLY_KIND.SOFT_FAIL, '这个我还没学会，换句话说说看？'),
    debug: `未接线的工具：${step.tool}`
  })
}

module.exports = {
  REPLY_KIND,
  GREETING,
  chat
}
