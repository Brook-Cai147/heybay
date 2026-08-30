/** 消息 Tab（M1-14 占位）。1v1 私信属 M3、订阅消息属 M4，本页只说明进度。 */
Page({
  data: {
    milestone: 'M3'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
  }
})
