/**
 * 需求广场（首页，M1-14 骨架）。
 *
 * 本步只建骨架与 Tab 路由；列表查询、需求卡片、品类筛选与城市切换在 M1-16 接入。
 * 有意不放假数据 —— 空列表比假卡片更能反映当前进度。
 */
Page({
  data: {
    tip: '需求列表在 M1-16 接入（列表查询走云函数，端侧无直读权限）'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  }
})
