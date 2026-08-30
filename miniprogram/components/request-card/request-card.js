/**
 * 需求卡片（M1-16）。
 *
 * 只读冗余字段（`ownerNickName` / `ownerTrustLevel` 等），**不联查 `users`** ——
 * tech-stack 第 4 节的"冗余优于联查"，代价是用户改昵称后历史卡片仍显示旧名（可接受）。
 *
 * 倒计时由外部传入 `nowMs` 驱动，组件自己不开定时器：一个页面十几张卡片各开一个 timer
 * 是纯浪费，页面统一每 30 秒推一次就够了。
 */

const {
  CATEGORY_LABEL,
  REWARD_LABEL,
  TRUST_LEVEL_LABEL,
  STATUS_LABEL
} = require('../../models/labels')
const { REWARD_TYPE } = require('../../models/enums')

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** 剩余时间的人话表达。已过期只说"已过期"，不显示负数 */
const remainText = (expireAt, nowMs) => {
  if (!expireAt) return ''
  const end = new Date(expireAt).getTime()
  if (Number.isNaN(end)) return ''
  const left = end - nowMs
  if (left <= 0) return '已过期'
  if (left < HOUR_MS) return `剩 ${Math.max(1, Math.floor(left / MINUTE_MS))} 分钟`
  if (left < DAY_MS) return `剩 ${Math.floor(left / HOUR_MS)} 小时`
  return `剩 ${Math.floor(left / DAY_MS)} 天`
}

Component({
  properties: {
    item: { type: Object, value: {} },
    nowMs: { type: Number, value: 0 }
  },

  data: {
    categoryLabel: '',
    rewardLabel: '',
    trustLabel: '',
    statusLabel: '',
    remain: '',
    urgent: false
  },

  observers: {
    'item, nowMs': function (item, nowMs) {
      if (!item || !item._id) return
      const end = item.expireAt ? new Date(item.expireAt).getTime() : 0
      const rewardLabel = item.rewardType === REWARD_TYPE.PAID && item.amount
        ? `${REWARD_LABEL[item.rewardType]} ${item.amount}`
        : REWARD_LABEL[item.rewardType] || ''

      this.setData({
        categoryLabel: CATEGORY_LABEL[item.category] || item.category,
        rewardLabel,
        trustLabel: TRUST_LEVEL_LABEL[item.ownerTrustLevel] || TRUST_LEVEL_LABEL.newcomer,
        statusLabel: STATUS_LABEL[item.status] || item.status,
        remain: remainText(item.expireAt, nowMs),
        // 1 小时内到期的标红：即时型需求的价值几乎全在时效上
        urgent: Boolean(end) && end - nowMs > 0 && end - nowMs < HOUR_MS
      })
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('cardtap', { requestId: this.data.item._id })
    }
  }
})
