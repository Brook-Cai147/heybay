Page({
  data: {
    searchHistory: ['伦敦', '巴黎', '旅行', '美食'], // 模拟搜索历史
    hotKeywords: ['伦敦旅行', '巴黎美食', '意大利景点', '纽约购物'], // 热门搜索词
    searchResults: [], // 搜索结果
    showResults: false, // 是否显示搜索结果
    searchText: '' // 搜索文本
  },

  // 输入事件
  onInput(e) {
    this.setData({
      searchText: e.detail.value
    });
  },

  // 搜索事件
  onSearch() {
    const { searchText, searchHistory } = this.data;
    if (!searchText.trim()) return;

    // 添加到搜索历史
    let newHistory = [searchText, ...searchHistory.filter(item => item !== searchText)];
    if (newHistory.length > 10) {
      newHistory = newHistory.slice(0, 10);
    }

    // 模拟搜索结果
    const results = [
      {
        title: `在${searchText}的旅行体验`,
        preview: `分享我在${searchText}的旅行经历，包括景点推荐和美食攻略...`,
        time: '2024-03-10'
      },
      {
        title: `${searchText}的隐藏景点`,
        preview: `发现了${searchText}的一些小众景点，避开人群，体验当地文化...`,
        time: '2024-03-05'
      }
    ];

    this.setData({
      searchHistory: newHistory,
      searchResults: results,
      showResults: true
    });

    // 保存搜索历史到本地存储
    wx.setStorageSync('searchHistory', newHistory);
  },

  // 搜索标签
  searchTag(e) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({
      searchText: tag
    });
    this.onSearch();
  },

  // 清空搜索历史
  clearHistory() {
    this.setData({
      searchHistory: []
    });
    wx.removeStorageSync('searchHistory');
  },

  // 取消搜索
  cancelSearch() {
    wx.navigateBack();
  },

  // 页面加载
  onLoad() {
    // 从本地存储获取搜索历史
    const history = wx.getStorageSync('searchHistory') || ['伦敦', '巴黎', '旅行', '美食'];
    this.setData({
      searchHistory: history
    });
  },

  // 页面显示
  onShow() {
    // 页面显示时的处理
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