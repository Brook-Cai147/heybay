/**
 * AI 采纳率的计算（M2-08）。**纯函数**，口径写在这里而不是散在 service 里。
 *
 * 口径（同步写进 `architecture.md`，防止以后漂移）：
 *   **字段级采纳率 = 未被修改的 AI 建议字段数 / AI 给出建议的字段数**
 *
 * 判定依据是端侧提交时的 `fieldSources`：
 *   某字段解析时是 `ai`，提交时还是 `ai`  → 用户没改，算采纳
 *   某字段解析时是 `ai`，提交时变 `user`  → 用户改了，算未采纳
 *   某字段解析时是 `ai`，提交时变 `empty` → 用户删了，也算未采纳
 *
 * 为什么不比对字段值：服务端手里没有"AI 原本给的值"，要比对就得把整份草稿存一遍或让端侧回传，
 * 前者多一次写库、后者的数据同样来自端侧。用 `fieldSources` 的变化判断，信息量一样但零额外成本。
 *
 * 分母为 0（AI 一个字段都没给出建议）时采纳率是 `null` 而不是 0 ——
 * "没得可采纳"和"给了但全被改掉"是两件完全不同的事，混成一个 0 会让 PRD 5.5 的指标失真。
 */

const { FIELD_SOURCE } = require('../constants/enums')

const RATE_DECIMALS = 4

/**
 * @param {object} input
 * @param {string[]} input.aiFilledFields 解析时 AI 给出了建议的字段（来自 parseDraft）
 * @param {object} input.fieldSources 提交时端侧带上来的来源标记
 * @returns {{aiFieldCount: number, adoptedFields: string[], modifiedFields: string[],
 *            adoptionRate: number|null, adopted: boolean|null}}
 */
const computeAdoption = ({ aiFilledFields, fieldSources } = {}) => {
  const suggested = Array.isArray(aiFilledFields) ? aiFilledFields.filter(f => typeof f === 'string') : []
  const sources = fieldSources && typeof fieldSources === 'object' ? fieldSources : {}

  const adoptedFields = suggested.filter(field => sources[field] === FIELD_SOURCE.AI)
  const modifiedFields = suggested.filter(field => sources[field] !== FIELD_SOURCE.AI)

  if (!suggested.length) {
    return {
      aiFieldCount: 0,
      adoptedFields: [],
      modifiedFields: [],
      adoptionRate: null,
      adopted: null
    }
  }

  const factor = Math.pow(10, RATE_DECIMALS)
  return {
    aiFieldCount: suggested.length,
    adoptedFields,
    modifiedFields,
    adoptionRate: Math.round((adoptedFields.length / suggested.length) * factor) / factor,
    // 整次调用层面的"是否被采纳"：只要有一个字段被留用，这次 AI 调用就产生了价值
    adopted: adoptedFields.length > 0
  }
}

module.exports = {
  RATE_DECIMALS,
  computeAdoption
}
