/**
 * 解析结果的规范化（M2-06）。**纯函数**，不碰网络与数据库，所以能被单测逐条钉住。
 *
 * 为什么必须有这一层，而不是把模型输出直接给端侧：
 *   1. **四类字段的第一道防线**（PRD 5.4）。M2-02 的 Schema 拦的是"标了 ai 又有值"，
 *      这里做的是更硬的一步 —— 不管模型标了什么，四类字段一律抹成空。
 *      模型偶尔会把金额填进 detail 又忘了标记，只靠 Schema 拦不住。
 *   2. **来源标记由代码推断，不信模型自报**。模型说某字段是 ai 还是 empty 并不可靠，
 *      但"这个字段最后有没有值"是客观事实，按事实推断标记比采信自报稳。
 *   3. **品类白名单是数据结构层的防线**（D-09）。归不进 8 类就明确返回"无法归类"，
 *      让用户改写，绝不自造一个品类混进库里。
 *
 * 刻意没做的一件事：**没有让模型逐字段自报置信度**（计划 M2-06 第 1 条提到"置信度"）。
 * 模型自报的置信度是它对自己的印象，没有校准，拿来当阈值用会稳定地误判。
 * 真正可用的信号是"哪些字段它没敢填"——这个 `fieldSources` 已经如实记着了。
 * 所以这里只给一个**草稿级**置信度，由"核心字段填了几个"推出来，供 M2-07 决定要不要追问。
 */

const { REQUEST_CATEGORY_VALUES, TIMING_TYPE, FIELD_SOURCE } = require('../constants/enums')
const { USER_ONLY_FIELDS, PARSE_OUTPUT_FIELDS } = require('../schemas/parseRequest')

/** 草稿级置信度。只有三档，够 M2-07 判断"要不要追问"就行 */
const DRAFT_CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
})

/** 归不进白名单时给用户的话。不说"AI 失败了"，说清楚下一步怎么做 */
const UNCLASSIFIED_HINT =
  '这条我没法归进现有分类，你换个说法再试试，比如说清是想找人一起做什么、还是想请人帮忙做什么'

const isEmptyValue = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/**
 * 规范化一份模型输出。
 *
 * @param {object} data 已通过 M2-02 校验的解析结果
 * @returns {{draft: object, fieldSources: object, confidence: string,
 *            unclassified: boolean, hint: string, aiFilledFields: string[]}}
 */
const normalizeDraft = (data = {}) => {
  const draft = {}
  const fieldSources = {}

  for (const field of PARSE_OUTPUT_FIELDS) {
    // 四类字段：不看模型标了什么，一律抹空。这是 PRD 5.4 在 service 层的第一道防线
    if (USER_ONLY_FIELDS.includes(field)) {
      draft[field] = null
      fieldSources[field] = FIELD_SOURCE.EMPTY
      continue
    }
    const value = data[field]
    draft[field] = isEmptyValue(value) ? null : value
    // 来源按"最后有没有值"这个客观事实推断，不采信模型自报
    fieldSources[field] = draft[field] === null ? FIELD_SOURCE.EMPTY : FIELD_SOURCE.AI
  }

  // 品类白名单（D-09）：归不进去就明确说归不进去，绝不自造
  const unclassified = !REQUEST_CATEGORY_VALUES.includes(draft.category)
  if (unclassified) {
    draft.category = null
    fieldSources.category = FIELD_SOURCE.EMPTY
  }

  // 即时型缺时长：留空让用户选，不替他猜一个档位（猜错直接影响单子什么时候过期）
  if (draft.timing === TIMING_TYPE.INSTANT && draft.instantDuration === null) {
    fieldSources.instantDuration = FIELD_SOURCE.EMPTY
  }

  const aiFilledFields = PARSE_OUTPUT_FIELDS.filter(
    field => fieldSources[field] === FIELD_SOURCE.AI
  )

  return {
    draft,
    fieldSources,
    confidence: confidenceOf(draft, unclassified),
    unclassified,
    hint: unclassified ? UNCLASSIFIED_HINT : '',
    // AI 给出建议的字段清单 —— M2-08 算字段级采纳率时的分母
    aiFilledFields
  }
}

/**
 * 草稿级置信度：只看三个核心字段填没填。
 * 这三个是"这张单子能不能发出去"的必要条件，其余字段空着都不影响发布。
 */
const confidenceOf = (draft, unclassified) => {
  if (unclassified || !draft.title) return DRAFT_CONFIDENCE.LOW
  if (!draft.timing) return DRAFT_CONFIDENCE.MEDIUM
  if (draft.timing === TIMING_TYPE.INSTANT && !draft.instantDuration) {
    return DRAFT_CONFIDENCE.MEDIUM
  }
  return DRAFT_CONFIDENCE.HIGH
}

module.exports = {
  DRAFT_CONFIDENCE,
  UNCLASSIFIED_HINT,
  normalizeDraft,
  confidenceOf
}
