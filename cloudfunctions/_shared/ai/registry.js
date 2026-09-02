/**
 * AI 能力注册表（M2-03）。**新增一个 AI 能力 = 往这张表加一条**，不改网关代码。
 *
 * 网关（M2-04）只认这张表：从这里拿 Prompt 模板、输出 Schema、额度类别、模型档位、
 * 超时、是否可缓存、失败后怎么降级。任何 `if (capability === 'xxx')` 出现在网关里，
 * 都说明这张表少了一个字段，应该补表而不是补 if。
 *
 * PRD 5.2 的 14 项能力**全部登记**，其中本步只实现两条（`parseRequest`、`searchKnowledge`），
 * 其余 12 条是占位：`implemented: false` + 所属里程碑。占位项被调用时必须报错而不是静默返回空，
 * 否则某个页面接了个还没做的能力，会表现成"AI 什么都没说"这种最难查的故障。
 *
 * 关于两条硬约束文案的放法（对 implementation-plan M2-03 第 4 条的一处收敛）：
 * 计划要求"模板必须包含 PRD 5.4 的两条硬约束文案"。但如果每个模板各抄一份，
 * 就与第 3 条"模板里不写重复表述"自相矛盾 —— 改一次文案要改 14 个文件，必然漏。
 * 所以硬约束单独放在 `prompts/_hardConstraints.txt`，模板留 `{{hardConstraints}}` 占位符，
 * 组装时注入。单测断言的是**组装后的 Prompt 一定含这两条**，而不是文件里有没有抄。
 */

const fs = require('fs')
const path = require('path')

const {
  AI_CAPABILITY,
  AI_CAPABILITY_VALUES,
  CAPABILITY_TIER
} = require('../constants/aiCapabilities')
const { schemaOf } = require('../schemas')

const PROMPTS_DIR = path.join(__dirname, 'prompts')
const HARD_CONSTRAINTS_FILE = '_hardConstraints.txt'
const HARD_CONSTRAINTS_KEY = 'hardConstraints'

/**
 * 模型档位。只分两档，因为价格差主要来自输出长度而不是任务难度：
 *   CHEAP        短输入短输出，绝大多数能力用它
 *   LONG_OUTPUT  行程清单、小红书图文这类要吐几百字的，单价更高但只在必要时用
 */
const MODEL_TIER = Object.freeze({
  CHEAP: 'cheap',
  LONG_OUTPUT: 'long_output'
})

const MODEL_TIER_VALUES = Object.freeze(Object.values(MODEL_TIER))

/** 失败后的降级策略（D-15：AI 失败绝不能伤主流程） */
const FALLBACK_STRATEGY = Object.freeze({
  /** 退回纯表单 / 纯手动，让用户自己完成，功能不缺 */
  MANUAL_FORM: 'manual_form',
  /** 退回关键词检索结果，答不了但至少给线索 */
  KEYWORD_ONLY: 'keyword_only',
  /** 静默跳过：用户本来就感知不到这个能力，失败了也不该弹提示 */
  SILENT_SKIP: 'silent_skip',
  /** 转人工/管理员处理，用于内容安全这类不能"跳过"的能力 */
  ESCALATE: 'escalate',
  /** 占位项还没定 */
  UNDECIDED: 'undecided'
})

const FALLBACK_STRATEGY_VALUES = Object.freeze(Object.values(FALLBACK_STRATEGY))

/**
 * 一条注册记录。`outputSchema` 与 `quotaTier` 不手写，**从 M2-02 / M2-01 的表里取** ——
 * 手写就会出现"注册表说 daily、额度表说 unlimited"这种两处不一致，且线上才暴露。
 */
const entry = ({
  capability,
  implemented,
  milestone,
  promptFile = null,
  input = {},
  modelTier = MODEL_TIER.CHEAP,
  timeoutSeconds = 8,
  cacheable = false,
  cacheTtlSeconds = 0,
  fallback = FALLBACK_STRATEGY.UNDECIDED,
  note = ''
}) =>
  Object.freeze({
    capability,
    implemented,
    milestone,
    promptFile,
    input: Object.freeze({
      required: Object.freeze(input.required || []),
      optional: Object.freeze(input.optional || [])
    }),
    outputSchema: schemaOf(capability),
    quotaTier: CAPABILITY_TIER[capability],
    modelTier,
    timeoutSeconds,
    cacheable,
    cacheTtlSeconds,
    fallback,
    note
  })

/** 已实现的能力。M2-03 建表时只有两条，M2-11 / M2-12 各接了一条 */
const IMPLEMENTED = [
  entry({
    capability: AI_CAPABILITY.PARSE_REQUEST,
    implemented: true,
    milestone: 'M2-06',
    promptFile: 'parseRequest.txt',
    input: { required: ['text', 'city'], optional: ['category'] },
    modelTier: MODEL_TIER.CHEAP,
    timeoutSeconds: 8,
    // 不缓存：输入是个人化自由文本，命中率极低，而一旦哈希撞上就会把别人的需求单塞给你
    cacheable: false,
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: '解析失败退回纯表单，发布功能一项不少（D-15）'
  }),
  entry({
    capability: AI_CAPABILITY.SEARCH_KNOWLEDGE,
    implemented: true,
    milestone: 'M2-10',
    promptFile: 'searchKnowledge.txt',
    input: { required: ['question', 'city'], optional: ['snippets'] },
    modelTier: MODEL_TIER.CHEAP,
    timeoutSeconds: 8,
    // 可缓存：同城同问题的答案本就该一致，且这是每日限免能力，缓存直接省额度
    cacheable: true,
    cacheTtlSeconds: 24 * 60 * 60,
    fallback: FALLBACK_STRATEGY.KEYWORD_ONLY,
    note: '答不了就只给关键词检索到的原帖，不编造'
  }),
  entry({
    capability: AI_CAPABILITY.MATCH_RESPONDERS,
    implemented: true,
    milestone: 'M2-11',
    promptFile: 'matchReason.txt',
    input: { required: ['requestId'], optional: [] },
    modelTier: MODEL_TIER.CHEAP,
    timeoutSeconds: 8,
    // 不缓存：候选名单随人员活跃度天天变，缓存住等于把昨天的名单当今天的
    cacheable: false,
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: '打分用代码算，模型只把依据字段写成人话；理由不可信时退回模板拼接（PRD 5.4）'
  }),
  entry({
    capability: AI_CAPABILITY.GENERATE_CHECKLIST,
    implemented: true,
    milestone: 'M2-12',
    promptFile: 'generateChecklist.txt',
    input: { required: ['city', 'arriveAt', 'travelType'], optional: [] },
    modelTier: MODEL_TIER.LONG_OUTPUT,
    /**
     * 12 秒：长输出比短文本慢，但**上限受云函数执行超时约束** ——
     * 校验失败会重试一次，两次调用加起来必须留在云函数的 30 秒之内（2×12 + 检索与记账仍有余量）。
     * 设成 20 秒看起来更宽松，实际是把"重试一次"变成"云函数直接被掐断"。
     */
    timeoutSeconds: 12,
    // 可缓存：同城市同出行类型的清单本就该一样，而这是每日限免 1 次的贵能力，缓存直接省额度
    cacheable: true,
    cacheTtlSeconds: 7 * 24 * 60 * 60,
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: '每日限免 1 次；紧急号码等高风险事实由服务端注入，不让模型编（PRD 5.2）'
  })
]

/**
 * 其余占位（PRD 5.2 全表）。登记但 `implemented: false`：
 * 好处是"14 项能力地图"在代码里是可枚举的事实，而不是文档里的一张表；
 * 谁提前接了没做的能力，`assertCallable` 会当场报错并告诉他这条排在哪个里程碑。
 */
const placeholder = ({ capability, milestone, modelTier = MODEL_TIER.CHEAP, fallback = FALLBACK_STRATEGY.UNDECIDED, note = '' }) =>
  entry({ capability, implemented: false, milestone, modelTier, fallback, note })

const PLACEHOLDERS = [
  placeholder({
    capability: AI_CAPABILITY.CREATE_REQUEST,
    milestone: 'M2-13',
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: '只写库不调模型，登记在册是为了让工具编排从同一张表取契约'
  }),
  placeholder({
    capability: AI_CAPABILITY.DRAFT_INVITE,
    milestone: 'M2-14',
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: 'L1 一键代发：只生成文案，发不发由用户勾选（D-14）'
  }),
  placeholder({
    capability: AI_CAPABILITY.MODERATE,
    milestone: 'M3',
    fallback: FALLBACK_STRATEGY.ESCALATE,
    note: '机审失败不能放行也不能静默丢弃，转人工复核'
  }),
  placeholder({
    capability: AI_CAPABILITY.RISK_HINT,
    milestone: 'M3',
    fallback: FALLBACK_STRATEGY.SILENT_SKIP,
    note: '私信反诈提示，失败就不提示，不弹错误'
  }),
  placeholder({
    capability: AI_CAPABILITY.TRANSLATE,
    milestone: 'M3',
    fallback: FALLBACK_STRATEGY.SILENT_SKIP,
    note: '短文本翻译与破冰话术'
  }),
  placeholder({
    capability: AI_CAPABILITY.SUMMARIZE_REVIEWS,
    milestone: 'M3',
    fallback: FALLBACK_STRATEGY.SILENT_SKIP,
    note: '评价聚合成信任标签，聚合不出来就只显示原始评价'
  }),
  placeholder({
    capability: AI_CAPABILITY.DAILY_TOPIC,
    milestone: 'M4',
    modelTier: MODEL_TIER.LONG_OUTPUT,
    fallback: FALLBACK_STRATEGY.SILENT_SKIP,
    note: '定时任务发起，属 SYSTEM 档，不占用户额度'
  }),
  placeholder({
    capability: AI_CAPABILITY.BROADCAST,
    milestone: 'M5',
    fallback: FALLBACK_STRATEGY.SILENT_SKIP,
    note: 'L2 自动分发 + 二次改写投放（≤2 次），受频控约束'
  }),
  placeholder({
    capability: AI_CAPABILITY.GENERATE_XHS_POST,
    milestone: 'M5',
    modelTier: MODEL_TIER.LONG_OUTPUT,
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: '生成文案与图片供用户手动发布，不是"一键同步"（PRD 5.2 #10）'
  }),
  placeholder({
    capability: AI_CAPABILITY.EMERGENCY_CARD,
    milestone: 'M5',
    fallback: FALLBACK_STRATEGY.MANUAL_FORM,
    note: '事实内容来自预置结构化数据，模型只做组织与翻译；额度上永不拦截'
  })
]

const AI_REGISTRY = Object.freeze(
  IMPLEMENTED.concat(PLACEHOLDERS).reduce((acc, record) => {
    acc[record.capability] = record
    return acc
  }, {})
)

const recordOf = capability => AI_REGISTRY[capability] || null

const isCallable = capability => {
  const record = recordOf(capability)
  return !!record && record.implemented === true
}

/**
 * 网关调用前的闸门。抛错而不是返回 null：这是开发期的接线错误，
 * 越早越吵越好，静默降级会把它伪装成"AI 今天不太行"。
 */
const assertCallable = capability => {
  const record = recordOf(capability)
  if (!record) {
    const err = new Error(`未登记的 AI 能力：${capability}`)
    err.code = 'UNKNOWN_CAPABILITY'
    throw err
  }
  if (!record.implemented) {
    const err = new Error(`AI 能力 ${capability} 还没实现，排在 ${record.milestone}`)
    err.code = 'CAPABILITY_NOT_IMPLEMENTED'
    err.milestone = record.milestone
    throw err
  }
  return record
}

const implementedCapabilities = () =>
  AI_CAPABILITY_VALUES.filter(name => AI_REGISTRY[name].implemented)

const placeholderCapabilities = () =>
  AI_CAPABILITY_VALUES.filter(name => !AI_REGISTRY[name].implemented)

const readPromptFile = fileName =>
  fs.readFileSync(path.join(PROMPTS_DIR, fileName), 'utf8')

const loadHardConstraints = () => readPromptFile(HARD_CONSTRAINTS_FILE).trim()

/** 读模板并把两条硬约束注入进去，其余占位符留给 `renderPrompt` */
const loadPrompt = capability => {
  const record = assertCallable(capability)
  if (!record.promptFile) {
    const err = new Error(`AI 能力 ${capability} 没有 Prompt 模板`)
    err.code = 'PROMPT_MISSING'
    throw err
  }
  return readPromptFile(record.promptFile).replace(
    new RegExp(`{{\\s*${HARD_CONSTRAINTS_KEY}\\s*}}`, 'g'),
    loadHardConstraints()
  )
}

/** 找出没被替换掉的占位符，`{{a}}` → ['a'] */
const missingPlaceholders = text => {
  const found = text.match(/{{\s*[\w.]+\s*}}/g) || []
  return Array.from(new Set(found.map(item => item.replace(/[{}\s]/g, ''))))
}

/**
 * 组装最终 Prompt。占位符没填满就抛错 —— 这是接线漏了变量，
 * 而不是数据问题；带着 `{{city}}` 字面量发给模型只会得到一个莫名其妙的结果。
 */
const renderPrompt = (capability, vars = {}) => {
  let text = loadPrompt(capability)
  for (const [key, value] of Object.entries(vars)) {
    const replacement = Array.isArray(value) ? value.join('、') : String(value == null ? '' : value)
    text = text.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), () => replacement)
  }
  const missing = missingPlaceholders(text)
  if (missing.length) {
    const err = new Error(`Prompt 组装缺少变量：${missing.join(', ')}`)
    err.code = 'PROMPT_VARS_MISSING'
    err.missing = missing
    throw err
  }
  return text
}

module.exports = {
  MODEL_TIER,
  MODEL_TIER_VALUES,
  FALLBACK_STRATEGY,
  FALLBACK_STRATEGY_VALUES,
  HARD_CONSTRAINTS_KEY,
  PROMPTS_DIR,
  AI_REGISTRY,
  recordOf,
  isCallable,
  assertCallable,
  implementedCapabilities,
  placeholderCapabilities,
  loadHardConstraints,
  loadPrompt,
  renderPrompt,
  missingPlaceholders
}
