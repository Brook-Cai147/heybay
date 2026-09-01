/**
 * `searchKnowledge` 的输出 Schema（M2-02）。
 *
 * 两条产品约束直接写在结构里，不靠 Prompt 自觉：
 *   1. `sources` 必填 —— PRD 5.4 要求兜底答案必须标注来源（"根据伦敦小组 3 条历史回答，请自行核实"）。
 *      没有来源的答案在这个产品里等于编造，Schema 层就不允许它通过。
 *   2. `refused` 显式存在 —— 签证/医疗/法律/移民必须拒答（PRD 5.4）。让"拒答"成为一种**合法输出**
 *      而不是一次失败，网关才能区分"模型坏了"和"模型正确地拒绝了"。
 */

/** 拒答原因，与 PRD 5.4 的事实性边界一一对应 */
const REFUSAL_REASON = Object.freeze({
  VISA: 'visa',
  MEDICAL: 'medical',
  LEGAL: 'legal',
  IMMIGRATION: 'immigration',
  OUT_OF_SCOPE: 'out_of_scope'
})

const REFUSAL_REASON_VALUES = Object.freeze(Object.values(REFUSAL_REASON))

const searchKnowledgeSchema = Object.freeze({
  type: 'object',
  required: ['answer', 'sources', 'refused'],
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 800 },
    /** 命中的语料来源。空数组是合法的（表示没找到，端侧据此显示"没查到相关经验"） */
    sources: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['refId', 'kind'],
        properties: {
          refId: { type: 'string', minLength: 1, maxLength: 64 },
          kind: { type: 'string', enum: ['request', 'post', 'preset'] },
          excerpt: { type: 'string', maxLength: 120, nullable: true }
        }
      }
    },
    refused: { type: 'boolean' },
    refusalReason: { type: 'string', enum: REFUSAL_REASON_VALUES, nullable: true },
    /** 模型对答案可靠度的自评，用于端侧决定要不要加重"请自行核实"的提示 */
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], nullable: true }
  }
})

module.exports = {
  REFUSAL_REASON,
  REFUSAL_REASON_VALUES,
  searchKnowledgeSchema
}
