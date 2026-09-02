/**
 * `matchResponders` 的输出 Schema（M2-11）。
 *
 * 模型在这条能力里**只负责把依据字段写成一句人话**，不负责挑人、也不负责打分。
 * 所以输出结构刻意做得很窄：只有「第几号候选」+「一句理由」。
 *
 * 为什么用序号而不是 openid：openid 是身份标识，没有任何理由把它送进模型的上下文（D-33）。
 * 序号在服务端映射回候选，模型编一个不存在的序号会被 maximum 挡下来。
 */

/**
 * 理由字数上限。**必须同时注入 Prompt**（见 promptVars）——
 * Schema 卡上限而 Prompt 不说，模型写超就要多跑一轮重试。
 *
 * 60 字是产品约束不是技术约束：推荐理由要能在一行卡片里显示完，
 * 写长了就会开始加"相信他一定能帮到你"这类无据之言（PRD 5.4 禁止）。
 */
const REASON_MAX = 60

const matchRespondersSchema = Object.freeze({
  type: 'object',
  required: ['reasons'],
  properties: {
    reasons: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['index', 'reason'],
        properties: {
          index: { type: 'integer', minimum: 1, maximum: 5 },
          reason: { type: 'string', minLength: 4, maxLength: REASON_MAX }
        }
      }
    }
  }
})

module.exports = {
  REASON_MAX,
  matchRespondersSchema
}
