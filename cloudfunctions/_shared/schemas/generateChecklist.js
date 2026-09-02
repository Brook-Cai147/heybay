/**
 * `generateChecklist` 的输出 Schema（M2-12）。
 *
 * 分组是**固定的五组**（计划第 1 条），不让模型自己起组名：
 * 组名一旦自由生成，端侧就没法按组渲染图标与折叠，也没法统计"哪一组的条目最常被勾掉"。
 *
 * 条目数量卡上限是产品约束：落地清单写到二十条就没人看了，
 * 而长输出档按 token 计费，每多一条都在花钱（PRD 5.6 唯一"真正贵"的能力）。
 */

/** 五个固定分组（计划 M2-12 第 1 条） */
const CHECKLIST_GROUP = Object.freeze({
  ARRIVAL_DAY: 'arrival_day',          // 落地当天
  DOCUMENTS_MONEY: 'documents_money',  // 证件与钱
  TRANSPORT: 'transport',              // 交通
  CONNECTIVITY: 'connectivity',        // 通讯
  SAFETY: 'safety'                     // 安全
})

const CHECKLIST_GROUP_VALUES = Object.freeze(Object.values(CHECKLIST_GROUP))

/** 分组的中文名。UI 与 Prompt 共用，避免两处各写一套 */
const CHECKLIST_GROUP_LABEL = Object.freeze({
  [CHECKLIST_GROUP.ARRIVAL_DAY]: '落地当天',
  [CHECKLIST_GROUP.DOCUMENTS_MONEY]: '证件与钱',
  [CHECKLIST_GROUP.TRANSPORT]: '交通',
  [CHECKLIST_GROUP.CONNECTIVITY]: '通讯',
  [CHECKLIST_GROUP.SAFETY]: '安全'
})

const ITEMS_PER_GROUP_MAX = 6

/**
 * 长度上限。**必须同时注入 Prompt**（见 promptVars 的 generateChecklist 组装器）——
 * Schema 卡上限而 Prompt 不说，模型就会写超，然后每次都要重试一轮。
 * M2-04 的"Prompt 不告诉模型输出键名"是同一类错，代价是成本与耗时翻倍。
 */
const TEXT_MAX = 60
const NOTE_MAX = 80
const REMINDER_MAX = 200

const generateChecklistSchema = Object.freeze({
  type: 'object',
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      maxItems: CHECKLIST_GROUP_VALUES.length,
      items: {
        type: 'object',
        required: ['group', 'items'],
        properties: {
          group: { type: 'string', enum: CHECKLIST_GROUP_VALUES },
          items: {
            type: 'array',
            maxItems: ITEMS_PER_GROUP_MAX,
            items: {
              type: 'object',
              required: ['text'],
              properties: {
                text: { type: 'string', minLength: 2, maxLength: TEXT_MAX },
                /** 补充说明。可空 —— 大多数条目一句话就够，硬要求备注只会诱导模型注水 */
                note: { type: 'string', maxLength: NOTE_MAX, nullable: true }
              }
            }
          }
        }
      }
    },
    /** 末尾提醒。政策与价格会变，这句话是给用户的"以官方为准" */
    reminder: { type: 'string', maxLength: REMINDER_MAX, nullable: true }
  }
})

module.exports = {
  CHECKLIST_GROUP,
  CHECKLIST_GROUP_VALUES,
  CHECKLIST_GROUP_LABEL,
  ITEMS_PER_GROUP_MAX,
  TEXT_MAX,
  NOTE_MAX,
  REMINDER_MAX,
  generateChecklistSchema
}
