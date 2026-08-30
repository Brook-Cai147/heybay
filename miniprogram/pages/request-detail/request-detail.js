/**
 * 需求单详情（M1-14 骨架）。
 *
 * 本步只做"能看到这条单子发出去了"这一件事，用于验证 M1-15 的发布跳转。
 * 双视角（响应入口 / 响应列表 / 选定 / 双方确认完成 / 安全提示卡）在 M1-17 实现。
 */

const requestService = require('../../services/request')
const { STATUS_LABEL, CATEGORY_LABEL, REWARD_LABEL } = require('../../models/labels')
const { REWARD_TYPE } = require('../../models/enums')

Page({
  data: {
    loading: true,
    error: '',
    request: null,
    statusLabel: '',
    categoryLabel: '',
    rewardLabel: '',
    expireText: '',
    isOwner: false
  },

  onLoad(query) {
    this.requestId = query.id || ''
    if (!this.requestId) {
      this.setData({ loading: false, error: '缺少需求单 id' })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await requestService.getDetail(this.requestId)
      const request = res.request || {}
      this.setData({
        request,
        isOwner: res.isOwner,
        statusLabel: STATUS_LABEL[request.status] || request.status,
        categoryLabel: CATEGORY_LABEL[request.category] || request.category,
        rewardLabel: request.rewardType === REWARD_TYPE.PAID && request.amount
          ? `${REWARD_LABEL[request.rewardType]} ${request.amount}`
          : REWARD_LABEL[request.rewardType] || '',
        expireText: this.formatTime(request.expireAt)
      })
    } catch (err) {
      this.setData({ error: err.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 云数据库的日期字段回到端侧是 Date；这里只做展示，不参与任何过期判定（那是服务端的事） */
  formatTime(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  goSquare() {
    wx.switchTab({ url: '/pages/square/square' })
  }
})
