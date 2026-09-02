/**
 * 消息 Tab（M2-14 起有内容）。1v1 私信属 M3、订阅消息属 M4（D-30），本页只做「收到的定向邀请」。
 *
 * 为什么邀请落在站内而不是发订阅消息：订阅消息整块归 M4，而 L0/L1 的行为差异要在 M2 就能验证。
 * 一条能在这里被看到的邀请，就足以验证「邀请必经用户勾选」这条红线（D-14）。
 */

const aiService = require('../../services/ai')
const { CATEGORY_LABEL } = require('../../models/labels')

Page({
  data: {
    milestone: 'M3',
    loading: true,
    invites: [],
    message: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    this.load()
  },

  async onPullDownRefresh() {
    await this.load()
    wx.stopPullDownRefresh()
  },

  /** 取不到就显示一行说明，不弹错误 —— 邀请列表是附加信息，不该拦住整个 Tab */
  async load() {
    this.setData({ loading: true })
    const res = await aiService.myInvites()
    if (!res.ok) {
      this.setData({ loading: false, message: res.message })
      return
    }
    this.setData({
      loading: false,
      message: '',
      invites: (res.items || []).map(item =>
        Object.assign({}, item, {
          categoryLabel: CATEGORY_LABEL[item.requestCategory] || '',
          timeText: this.formatTime(item.createdAt)
        })
      )
    })
  },

  formatTime(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  onOpenRequest(e) {
    const requestId = e.currentTarget.dataset.id
    if (!requestId) return
    wx.navigateTo({ url: `/pages/request-detail/request-detail?id=${requestId}` })
  }
})
