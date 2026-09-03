/**
 * 草稿补全规则（M2-13 修复）。**纯函数**：算"这份草稿还差什么、哪一项能在对话里点一下补上"。
 *
 * 为什么单独一个文件：这套规则必须与 `service/requestValidator.js` **完全一致**，
 * 包括条件必填（预约型要期望时间、即时型要有效时长、搭子同行要人数、付费要金额）。
 * 第一次真机验证时它只查了五项固定必填，于是对话给出了「确认发布」按钮，
 * 点下去服务端回「需求单有 2 处不合规」—— 用户点了才知道发不出去，这是最差的一种失败。
 *
 * 放在 `ai/` 下是为了能被单测钉住：`assistantService` 一 require dao 就连带
 * `wx-server-sdk`，本地 `node:test` 起不来（同 `ai/parseDraft.js`、`ai/matchScore.js`）。
 * 这份规则与 `requestValidator` 的一致性由 `tests/draftCompletion.test.js` 里的
 * parity 用例保证 —— 两处规则不靠人记得同步，靠测试红。
 */

const {
  REQUEST_CATEGORY,
  TIMING_TYPE,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE,
  FIELD_SOURCE
} = require('../constants/enums')

/** 无条件必填。与 `requestValidator` 的必填表同源（`city` / `visibility` 由服务端补，不问用户） */
const REQUIRED_FOR_CREATE = Object.freeze(['category', 'title', 'detail', 'timing', 'rewardType'])

/**
 * 缺了还能在对话里**点一下**补上的字段。只有这三项，且都是"选一个"，没有自由输入。
 *
 * **`expectTime` / `amount` / `area` / `contact` 永远不在这个名单里**（PRD 5.4 四类字段）。
 * 其中 `expectTime` 还有一条硬理由：它要被 `computeExpireAt` 解析成时间戳，
 * 「这周六下午」这种自由文本算不出过期时刻 —— 那是日期选择器该干的事，属于表单。
 */
const CONVERSATIONAL_FIELDS = Object.freeze(['rewardType', 'instantDuration', 'headcount'])

/**
 * 对话里可以点选的报酬类型。**不含付费** —— 付费必须填参考金额，
 * 而金额只能本人在表单里填。想选付费的人会被引到表单，这不是绕路，是那条红线的正常后果。
 */
const CHAT_REWARD_TYPES = Object.freeze([REWARD_TYPE.FREE, REWARD_TYPE.MEAL, REWARD_TYPE.GOODS])

/** 人数给几个常见值；要更多的人去表单填（`requestValidator` 允许 1~20） */
const HEADCOUNT_CHOICES = Object.freeze([1, 2, 3, 4, 5])
const HEADCOUNT_MIN = 1
const HEADCOUNT_MAX = 20

/** 每一项问一句什么。文案放服务端，端侧只把选项渲染成按钮 */
const ASK_QUESTION = Object.freeze({
  rewardType: '这次的报酬怎么算？选一个我就发。',
  instantDuration: '这条要挂多久？过了就自动下架。',
  headcount: '要找几个人？'
})

/** 只能去表单补的字段，各自的原因。不说原因，用户只会觉得是产品做得不行 */
const FORM_ONLY_REASON = Object.freeze({
  expectTime: '预约型的期望时间得你自己选个日期，我不能替你定（这个时间还要用来算什么时候过期）。去表单点一下更快。',
  amount: '付费的参考金额只能你自己填。',
  area: '见面地点只能你自己填。',
  contact: '联系方式只能你自己填。'
})

const isBlank = value => value === undefined || value === null || String(value).trim() === ''

const isValidHeadcount = value => {
  const n = Number(value)
  return Number.isInteger(n) && n >= HEADCOUNT_MIN && n <= HEADCOUNT_MAX
}

/** 这份草稿还差什么才能发出去。顺序即追问顺序 */
const missingForCreate = draft => {
  const missing = REQUIRED_FOR_CREATE.filter(field => isBlank(draft ? draft[field] : null))
  if (!draft) return missing

  if (draft.timing === TIMING_TYPE.SCHEDULED && isBlank(draft.expectTime)) missing.push('expectTime')
  if (draft.timing === TIMING_TYPE.INSTANT && isBlank(draft.instantDuration)) missing.push('instantDuration')
  if (draft.category === REQUEST_CATEGORY.COMPANION && !isValidHeadcount(draft.headcount)) {
    missing.push('headcount')
  }
  if (draft.rewardType === REWARD_TYPE.PAID && !(Number(draft.amount) > 0)) missing.push('amount')

  return missing
}

const choicesOf = field => {
  if (field === 'rewardType') return CHAT_REWARD_TYPES
  if (field === 'instantDuration') return INSTANT_DURATION_VALUES
  if (field === 'headcount') return HEADCOUNT_CHOICES
  return []
}

const formOnlyOf = missing => missing.filter(field => !CONVERSATIONAL_FIELDS.includes(field))

/** 一次只问一项。一口气问三项就是在对话框里画了一张表单 */
const askFor = missing => {
  const field = missing.find(item => CONVERSATIONAL_FIELDS.includes(item))
  if (!field) return null
  return {
    field,
    kind: 'choice',
    question: ASK_QUESTION[field],
    choices: choicesOf(field),
    // 报酬这一项额外给一个"付费"按钮，点了直接去表单（金额只能本人填）
    formChoice: field === 'rewardType' ? REWARD_TYPE.PAID : ''
  }
}

/**
 * 一份草稿的当前状态：还差什么、下一项问什么、能不能确认发布、要不要交给表单。
 *
 * **只有一处算这件事。** 端侧再算一遍就会出现"按钮显示了但发不出去"，
 * 服务端两处各算一遍就会出现两种答案。
 */
const statusOf = draft => {
  const missing = missingForCreate(draft)
  const formOnly = formOnlyOf(missing)
  return {
    missingFields: missing,
    // 有"只能去表单"的字段时不再问选项：先解决那个，否则问完还是发不出去
    ask: formOnly.length ? null : askFor(missing),
    handoff: formOnly.length ? 'publish' : '',
    handoffReason: formOnly.map(field => FORM_ONLY_REASON[field]).filter(Boolean)[0] || '',
    needsConfirm: missing.length === 0
  }
}

/**
 * 把用户点的选项填进草稿。
 *
 * **白名单是这个函数的全部安全性**：只接受 `CONVERSATIONAL_FIELDS` 里的三项，
 * 且值必须在该项的选项表内。金额、期望时间、地点、联系方式一律不接（PRD 5.4）——
 * 否则它就成了绕过"四类字段只能本人在表单填"的后门。
 *
 * @returns {{ok: boolean, reason?: string, draft?: object, fieldSources?: object}}
 */
const applyChoice = ({ draft, fieldSources = {}, field, value }) => {
  if (!draft || typeof draft !== 'object') return { ok: false, reason: 'no_draft' }
  if (!CONVERSATIONAL_FIELDS.includes(field)) return { ok: false, reason: 'field_not_allowed' }
  if (!choicesOf(field).map(String).includes(String(value))) return { ok: false, reason: 'bad_value' }

  const next = Object.assign({}, draft, {
    [field]: field === 'headcount' ? Number(value) : String(value)
  })
  // 用户自己点的，来源就是 user —— 不进 AI 采纳率的分子分母
  const nextSources = Object.assign({}, fieldSources, { [field]: FIELD_SOURCE.USER })
  next.fieldSources = nextSources
  return { ok: true, draft: next, fieldSources: nextSources }
}

module.exports = {
  REQUIRED_FOR_CREATE,
  CONVERSATIONAL_FIELDS,
  CHAT_REWARD_TYPES,
  HEADCOUNT_CHOICES,
  HEADCOUNT_MIN,
  HEADCOUNT_MAX,
  ASK_QUESTION,
  FORM_ONLY_REASON,
  isValidHeadcount,
  missingForCreate,
  choicesOf,
  formOnlyOf,
  askFor,
  statusOf,
  applyChoice
}
