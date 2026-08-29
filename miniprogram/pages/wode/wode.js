Page({
  data: {
    activeTab: 'posts', // 默认选中发布标签
    likes: {
      post1: false,
      post2: false,
      post3: false,
      post4: false,
      post5: false,
      collection1: false,
      collection2: false,
      like1: true,
      like2: true
    }
  },

  // 编辑资料
  editProfile() {
    wx.showToast({
      title: '编辑资料',
      icon: 'none'
    });
  },

  // 跳转到设置页面
  goToSettings() {
    wx.navigateTo({
      url: '/pages/wode/settings/settings'
    });
  },

  // 显示发帖数
  showPosts() {
    wx.showToast({
      title: '查看发帖',
      icon: 'none'
    });
  },

  // 显示获赞数
  showLikes() {
    wx.showToast({
      title: '查看获赞',
      icon: 'none'
    });
  },

  // 显示关注数
  showFollowing() {
    wx.showToast({
      title: '查看关注',
      icon: 'none'
    });
  },

  // 显示粉丝数
  showFollowers() {
    wx.showToast({
      title: '查看粉丝',
      icon: 'none'
    });
  },

  // 跳转到我的草稿
  goToDrafts() {
    wx.showToast({
      title: '查看我的草稿',
      icon: 'none'
    });
  },

  // 跳转到我的交易
  goToTransactions() {
    wx.showToast({
      title: '我的交易（后续迭代）',
      icon: 'none'
    });
  },

  // 切换标签
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      activeTab: tab
    });
  },

  // 切换点赞状态
  toggleLike(e) {
    const postId = e.currentTarget.dataset.id;
    const newLikes = {...this.data.likes};
    newLikes[postId] = !newLikes[postId];
    this.setData({
      likes: newLikes
    });
  },

  // 搜索内容
  searchContent() {
    // 跳转到搜索发过帖子的子页面
    wx.navigateTo({
      url: '/pages/wode/search/search'
    });
  },

  // 页面加载
  onLoad() {
    // 页面加载时的初始化
  },

  // 页面显示
  onShow() {
    // 更新TabBar状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 4
      });
    }
  },

  // 页面隐藏
  onHide() {
    // 页面隐藏时的处理
  },

  // 页面卸载
  onUnload() {
    // 页面卸载时的处理
  }
});