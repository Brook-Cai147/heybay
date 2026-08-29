Page({
  data: {
    hotSearchList: [
      { title: '#伦敦搭子', count: 12345 },
      { title: '#巴黎徒步', count: 9876 },
      { title: '#海外二手', count: 8765 },
      { title: '#北欧极光', count: 7654 },
      { title: '#东南亚海岛', count: 6543 },
      { title: '#自由行攻略', count: 5432 },
      { title: '#摄影技巧', count: 4321 },
      { title: '#美食推荐', count: 3210 },
      { title: '#旅行装备', count: 2109 },
      { title: '#向导服务', count: 1098 }
    ]
  },

  onLoad(options) {
    // 页面加载时初始化
  },

  onReady() {
    // 页面初次渲染完成
  },

  onShow() {
    // 页面显示
  },

  onHide() {
    // 页面隐藏
  },

  onUnload() {
    // 页面卸载
  },

  // 刷新热搜榜
  refreshHotSearch() {
    wx.showToast({
      title: '刷新成功',
      icon: 'success'
    })
    // 这里可以添加刷新逻辑
  },

  // 点击热搜项
  searchItem(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.hotSearchList[index]
    wx.showToast({
      title: `搜索: ${item.title}`,
      icon: 'none'
    })
    // 这里可以添加搜索逻辑
  }
})