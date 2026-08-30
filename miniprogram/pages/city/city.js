/** 城市 Tab（M1-14 占位）。城市社区属 M3，本页只说明进度，不提前做内容流。 */
Page({
  data: {
    milestone: 'M3'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  }
})
