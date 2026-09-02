/**
 * AI 输出 Schema（M2-02）。**每个能力一个文件**，由 `schemas/index.js` 汇总。
 *
 * 这不是通用 JSON Schema：只支持本项目 `aiSchemaValidator` 认得的子集
 * （type / enum / required / properties / items / 长度上限 / nullable / userOnlyFields），
 * 外加一个非标准关键字 `userOnlyFields` 用来在 Schema 层表达 PRD 5.4 的禁止代填。
 *
 * **枚举值一律引用 `constants/enums.js`**，不在此重写字符串字面量 —— 枚举改了这里自动跟着变，
 * 否则模型会被允许输出一个已经不存在的品类，而校验器还以为是对的。
 */

const {
  REQUEST_CATEGORY_VALUES,
  TIMING_TYPE_VALUES,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE_VALUES,
  FIELD_SOURCE_VALUES
} = require('../constants/enums')

/** 与 `requestValidator.USER_ONLY_FIELDS` 必须一致（单测锁住这一点） */
const USER_ONLY_FIELDS = Object.freeze(['amount', 'expectTime', 'area', 'contact'])

/**
 * 需求单草稿的字段（不含 `fieldSources` 本身）。
 *
 * 单独抽出来是为了让**字段名只有一个真源**：Prompt 里要告诉模型"输出这些键"，
 * `fieldSources` 的键白名单也要用它。第一次真实调用时模型把「见面时间」自己译成了
 * `meetTime`、「见面地点」译成 `meetLocation` —— 因为 Prompt 从没给过 JSON 键名，
 * 只给了中文说明。那是 Prompt 的锅，不是模型的锅。
 */
const OUTPUT_FIELDS = Object.freeze({
  category: { type: 'string', enum: REQUEST_CATEGORY_VALUES },
  title: { type: 'string', minLength: 1, maxLength: 20 },
  detail: { type: 'string', maxLength: 500, nullable: true },
  timing: { type: 'string', enum: TIMING_TYPE_VALUES, nullable: true },
  instantDuration: { type: 'string', enum: INSTANT_DURATION_VALUES, nullable: true },
  rewardType: { type: 'string', enum: REWARD_TYPE_VALUES, nullable: true },
  headcount: { type: 'integer', minimum: 1, maximum: 20, nullable: true },

  // 以下四项即使模型推测出来也必须留空（PRD 5.4），Schema 层与 userOnlyFields 双重把关
  amount: { type: 'number', minimum: 0, nullable: true },
  expectTime: { type: 'string', maxLength: 40, nullable: true },
  area: { type: 'string', maxLength: 60, nullable: true },
  contact: { type: 'string', maxLength: 60, nullable: true },

  /** 模型对自己解析结果的说明，展示为"我理解成这样，对吗？" */
  summary: { type: 'string', maxLength: 120, nullable: true }
})

/** 输出字段名清单。Prompt 组装时注入，模板里不手抄 */
const PARSE_OUTPUT_FIELDS = Object.freeze(Object.keys(OUTPUT_FIELDS))

/**
 * `parseRequest` 的输出：一张待用户确认的需求单草稿。
 *
 * 设计上只有 `category` 与 `title` 是必填 —— 模型抽不出时效或报酬类型是常态，
 * 强制必填只会让本可用的解析结果整条作废，降级成空表单反而更差。
 */
const parseRequestSchema = Object.freeze({
  type: 'object',
  required: ['category', 'title', 'fieldSources'],
  userOnlyFields: USER_ONLY_FIELDS,
  properties: Object.assign({}, OUTPUT_FIELDS, {
    /**
     * 每个字段的来源标记，端侧据此高亮"这几项请你自己确认"。
     * `keyWhitelist` 让键名跑偏的标记被剥掉而不是留在结果里 —— 端侧读
     * `fieldSources.expectTime` 读到 undefined，高亮就静默失效，这类 bug 最难发现。
     */
    fieldSources: {
      type: 'object',
      valueSchema: { type: 'string', enum: FIELD_SOURCE_VALUES },
      keyWhitelist: PARSE_OUTPUT_FIELDS
    }
  })
})

module.exports = {
  USER_ONLY_FIELDS,
  PARSE_OUTPUT_FIELDS,
  parseRequestSchema
}
