/**
 * `draftInvite` 的输出 Schema（M2-14）。
 *
 * 与 `matchResponders` 同一个套路：模型只写文案，**用序号而不是 openid**（D-33）。
 * 一条邀请文案要能直接发给一个陌生人看，所以约束比推荐理由更严：
 * 不许承诺报酬、不许替需求方答应任何条件（那是 L3 才会做的事，本产品不做）。
 */

/** 邀请文案字数上限。**必须同时注入 Prompt**，否则模型写超要多跑一轮重试 */
const INVITE_MAX = 120

const draftInviteSchema = Object.freeze({
  type: 'object',
  required: ['invites'],
  properties: {
    invites: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['index', 'text'],
        properties: {
          index: { type: 'integer', minimum: 1, maximum: 5 },
          text: { type: 'string', minLength: 10, maxLength: INVITE_MAX }
        }
      }
    }
  }
})

module.exports = {
  INVITE_MAX,
  draftInviteSchema
}
