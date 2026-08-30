/**
 * 需求单详情（M1-14 骨架）。
 *
 * 本步只做"能看到这条单子发出去了"这一件事，用于验证 M1-15 的发布跳转。
 * 双视角（响应入口 / 响应列表 / 选定 / 双方确认完成 / 安全提示卡）在 M1-17 实现。
 */

const requestService = require('../../services/request')

/** 状态的中文展示。UI 文案不进枚举文件，避免端云两份枚举因文案而漂移 */
const STATUS_LABEL = {
  draft: '草稿',
  open: '招募中',
  responded: '待选定',
  matched: '已确定',
  done: '已完成',
  rated: '已评价',
  expired: '已过期',
  cancelled: '已取消',
  removed: '已下架'
}

Page({
  data: {
    loading: true,
    error: '',
    request: null,
    statusLabel: '',
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
