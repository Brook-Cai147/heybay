Page({
  data: {
    hotSearchList: [
      '#伦敦搭子',
      '#巴黎徒步',
      '#海外二手',
      '#北欧极光',
      '#东南亚海岛'
    ],
    historyList: [
      '伦敦旅游',
      '巴黎美食',
      '罗马景点'
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

  cancelSearch() {
    // 取消搜索，返回上一页
    wx.navigateBack()
  },

  searchTag(e) {
    // 搜索标签
    const tag = e.currentTarget.dataset.tag || e.currentTarget.children[1].textContent
    console.log('搜索:', tag)
    // 这里可以添加搜索逻辑
    wx.showToast({
      title: `搜索: ${tag}`,
      icon: 'none'
    })
  },

  clearHistory() {
    // 清除历史记录
    this.setData({
      historyList: []
    })
    wx.showToast({
      title: '历史记录已清除',
      icon: 'success'
    })
  }
})