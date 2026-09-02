/**
 * 需求广场（首页，M1-16）。
 *
 * 列表只能走云函数：`requests` 的权限是「所有用户不可读写」，端侧连读都被拒（M1-07 实测 -502003）。
 *
 * M1 只做品类筛选 + 城市切换器，**不做搜索、不做推荐内容模块**（计划 M1-16 第 3 条）。
 * 倒计时统一由本页每 30 秒推一次 `nowMs`，卡片组件自己不开定时器。
 */

const requestService = require('../../services/request')
const { track } = require('../../utils/track')
const { REQUEST_CATEGORY_VALUES } = require('../../models/enums')
const { CATEGORY_LABEL, CITY_LABEL } = require('../../models/labels')

const TICK_MS = 30 * 1000

/** M1 只开伦敦（D-10）；其余城市点了显示"尚未开城"，不发请求 */
const CITY_OPTIONS = [
  { value: 'london', label: CITY_LABEL.london, open: true },
  { value: 'manchester', label: '曼彻斯特', open: false },
  { value: 'paris', label: '巴黎', open: false }
]

const CATEGORY_FILTERS = [{ value: '', label: '全部' }].concat(
  REQUEST_CATEGORY_VALUES.map(value => ({ value, label: CATEGORY_LABEL[value] }))
)

Page({
  data: {
    cityOptions: CITY_OPTIONS,
    categoryFilters: CATEGORY_FILTERS,
    city: 'london',
    cityLabel: CITY_LABEL.london,
    cityOpen: true,
    category: '',
    items: [],
    page: 1,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: '',
    nowMs: Date.now()
  },

  onLoad() {
    this.timer = null
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 每次回到首页都重新拉：发完一条单子回来就该看到它
    this.refresh()
    this.startTick()
  },

  onHide() {
    this.stopTick()
  },

  onUnload() {
    this.stopTick()
  },

  startTick() {
    this.stopTick()
    this.timer = setInterval(() => this.setData({ nowMs: Date.now() }), TICK_MS)
  },

  stopTick() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /** 下拉刷新 */
  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  /** 触底加载下一页 */
  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadMore()
  },

  async refresh() {
    if (!this.data.cityOpen) {
      this.setData({ items: [], hasMore: false, loading: false })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const res = await requestService.list({ city: this.data.city, category: this.data.category, page: 1 })
      this.setData({
        items: res.items,
        page: 1,
        hasMore: res.hasMore,
        cityOpen: res.cityOpen,
        nowMs: res.serverTime || Date.now()
      })
    } catch (err) {
      this.setData({ error: err.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadMore() {
    this.setData({ loadingMore: true })
    try {
      const next = this.data.page + 1
      const res = await requestService.list({ city: this.data.city, category: this.data.category, page: next })
      this.setData({
        items: this.data.items.concat(res.items),
        page: next,
        hasMore: res.hasMore
      })
    } catch (err) {
      this.setData({ error: err.message })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  onPickCity(e) {
    const { value, open } = e.currentTarget.dataset
    const option = CITY_OPTIONS.find(city => city.value === value)
    const isOpen = open === true || open === 'true'
    this.setData({
      city: value,
      cityLabel: option ? option.label : value,
      cityOpen: isOpen,
      items: [],
      hasMore: false,
      error: ''
    })
    if (isOpen) this.refresh()
  },

  onPickCategory(e) {
    this.setData({ category: e.currentTarget.dataset.value })
    this.refresh()
  },

  onCardTap(e) {
    const { requestId } = e.detail
    // 卡片点击是分发效果的观测点（事件字典 ③ 分发组）；position 记它在列表里的位次
    const position = Number(e.currentTarget.dataset.index) || 0
    track('request_card_clicked', { requestId, position, source: 'community' })
    wx.navigateTo({ url: `/pages/request-detail/request-detail?id=${requestId}` })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  },

  /** 小螺对话页（M2-13 / PRD 6.1 的悬浮球入口） */
  goAssistant() {
    wx.navigateTo({ url: '/pages/assistant/assistant' })
  }
})
