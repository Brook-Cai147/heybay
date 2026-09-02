/**
 * 自主性阶梯（M2-14 / D-14）。**纯函数：只定义档位与规则，不执行任何动作。**
 *
 * 这是本项目 PM 含量最高的一处主张：**自主性由用户选择，不是产品单方决定**。
 * 所以三件事必须是代码里的事实、而不是文档里的说法：
 *   每档"能做什么 / 不能做什么"要能被枚举出来给用户看（PRD 5.4 可解释）
 *   默认档要有明确规则（新用户前 3 单 L0，之后 L1）
 *   **任何档位都能随时回退**（PRD 5.4 可回退）
 *
 * **L3 永不实现**：AI 代替用户与另一个真人协商价格、时间、条件，一旦出错，
 * 承担后果的是用户而不是产品。这不是能力问题，是责任归属问题（D-14）。
 * 这条理由写进档位说明里给用户看，而不是只写在决策日志里。
 */

/** 三档 + 一个明确不做的档 */
const AUTONOMY = Object.freeze({
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3'
})

const AUTONOMY_VALUES = Object.freeze([AUTONOMY.L0, AUTONOMY.L1, AUTONOMY.L2])

/** 用户可选的档位：L2 本步只做入口与说明（实现属 M5），L3 不可选 */
const SELECTABLE = Object.freeze([AUTONOMY.L0, AUTONOMY.L1])

/** 新用户的前几单默认 L0 —— 还没建立信任之前，让 AI 只出建议不出手 */
const L0_FIRST_N_REQUESTS = 3

/** 全局默认档（PRD 5.3） */
const DEFAULT_LEVEL = AUTONOMY.L1

/**
 * 档位说明。`can` / `cannot` 都必须是**具体动作**，不许写"更智能"这种话 ——
 * 用户要能据此判断"这一档会不会替我做我不想让它做的事"。
 */
const AUTONOMY_INFO = Object.freeze({
  [AUTONOMY.L0]: Object.freeze({
    level: AUTONOMY.L0,
    name: '只读建议',
    summary: 'AI 只给建议，一个字都不会代你发出去。',
    can: Object.freeze(['把你的一句话整理成需求单草稿', '告诉你谁可能帮得上，并说明依据', '帮你起草邀请文案给你看']),
    cannot: Object.freeze(['不会发布需求单', '不会给任何人发邀请', '不会代你回复别人']),
    selectable: true,
    defaultFor: `新用户的前 ${L0_FIRST_N_REQUESTS} 单`
  }),
  [AUTONOMY.L1]: Object.freeze({
    level: AUTONOMY.L1,
    name: '一键代发',
    summary: 'AI 起草，你勾选，然后一起发出去。发不发始终是你点的。',
    can: Object.freeze(['整理草稿并在你确认后发布', '生成邀请名单与文案', '把你勾选的邀请一次发出去']),
    cannot: Object.freeze(['不会自动发送任何你没勾选的邀请', '不会代你与对方协商', '不会替你答应或拒绝别人']),
    selectable: true,
    defaultFor: '全局默认档'
  }),
  [AUTONOMY.L2]: Object.freeze({
    level: AUTONOMY.L2,
    name: '自动分发',
    summary: '按你设定的条件自动向合适的人分发，受频控约束。这一档还没做。',
    can: Object.freeze(['（M5 实现）按条件自动分发', '（M5 实现）分发结果汇总给你']),
    cannot: Object.freeze(['不会协商条件', '不会代你确认成交']),
    selectable: false,
    defaultFor: '暂不可选，M5 实现'
  }),
  [AUTONOMY.L3]: Object.freeze({
    level: AUTONOMY.L3,
    name: '自动协商',
    summary: '本产品不做这一档。',
    can: Object.freeze([]),
    cannot: Object.freeze(['不会代你和真人谈价格、时间或条件']),
    selectable: false,
    defaultFor: '永不实现',
    /** 这段理由要展示给用户，不是内部备注（D-14） */
    whyNever: '让 AI 替你和另一个真人谈条件，谈错了要你承担后果。这不是能力做不到，是责任不该这么转移。'
  })
})

/** 档位列表，按 L0 → L2 顺序给端侧渲染；L3 单独作为"不做的那一档"说明 */
const ladder = () => AUTONOMY_VALUES.map(level => AUTONOMY_INFO[level])

/**
 * 这个人当前该用哪一档。
 *
 * @param {object} input
 * @param {string} [input.userLevel]  用户自己设过的档位（`users.autonomyLevel`）
 * @param {number} [input.doneOrPublishedCount] 已发过的单数，用来判断"新用户"
 * @returns {{level: string, reason: string}} `reason` 是"为什么是这一档"，要能给用户看
 */
const levelOf = ({ userLevel = '', publishedCount = 0 } = {}) => {
  if (SELECTABLE.includes(userLevel)) {
    return { level: userLevel, reason: '你自己选的档位' }
  }
  if (publishedCount < L0_FIRST_N_REQUESTS) {
    return {
      level: AUTONOMY.L0,
      reason: `新用户前 ${L0_FIRST_N_REQUESTS} 单默认只读建议，你随时可以调到一键代发`
    }
  }
  return { level: DEFAULT_LEVEL, reason: '全局默认档' }
}

/** 这一档允许"发出邀请"吗。L0 明确不允许 —— 这是 L0 与 L1 唯一的行为差异 */
const canSendInvites = level => level === AUTONOMY.L1 || level === AUTONOMY.L2

/** 想设成不可选的档位时给的解释（不能只说"不支持"） */
const rejectReasonOf = level => {
  if (SELECTABLE.includes(level)) return null
  const info = AUTONOMY_INFO[level]
  if (!info) return `没有 ${level} 这一档`
  if (level === AUTONOMY.L3) return info.whyNever
  return `${info.name}还没做（${info.defaultFor}）`
}

module.exports = {
  AUTONOMY,
  AUTONOMY_VALUES,
  SELECTABLE,
  L0_FIRST_N_REQUESTS,
  DEFAULT_LEVEL,
  AUTONOMY_INFO,
  ladder,
  levelOf,
  canSendInvites,
  rejectReasonOf
}
