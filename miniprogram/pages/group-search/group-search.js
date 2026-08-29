Page({
  data: {
    // 搜索文本
    searchText: '',
    // 搜索历史
    searchHistory: ['搭子出行', '海德公园', '租房', '二手交易', '美食推荐'],
    // 本组热点内容
    groupHotContent: [
      {
        id: 1,
        title: '伦敦海德公园樱花季，寻找拍照搭子',
        icon: ''
      },
      {
        id: 2,
        title: '东区学生公寓转租，性价比超高',
        icon: '/images/hot.png'
      },
      {
        id: 3,
        title: '出一台iPhone 13，几乎全新',
        icon: ''
      }
    ],
    // 全组热搜榜
    hotSearchList: [
      { keyword: '伦敦租房', heat: '17.8万' },
      { keyword: '巴黎美食', heat: '9.5万' },
      { keyword: '柏林二手', heat: '7.6万' },
      { keyword: '罗马旅游攻略', heat: '7.4万' },
      { keyword: '欧洲签证办理', heat: '6.2万' },
      { keyword: '留学生活分享', heat: '5.9万' },
      { keyword: '语言交换', heat: '5.6万' },
      { keyword: '地陪推荐', heat: '5.1万' },
      { keyword: '机票转让', heat: '5.0万' }
    ],
    // 搜索结果
    searchResults: []
  },

  // 输入搜索内容
  onInput(e) {
    this.setData({
      searchText: e.detail.value
    });
  },

  // 执行搜索
  onSearch(e) {
    const keyword = e.detail.value;
    if (!keyword.trim()) return;

    // 添加到搜索历史
    this.addToHistory(keyword);

    // 模拟搜索
    this.performSearch(keyword);
  },

  // 点击历史记录
  onHistoryClick(e) {
    const text = e.currentTarget.dataset.text;
    this.setData({
      searchText: text
    });
    this.performSearch(text);
  },

  // 点击热搜
  onHotSearchClick(e) {
    const text = e.currentTarget.dataset.text;
    this.setData({
      searchText: text
    });
    this.addToHistory(text);
    this.performSearch(text);
  },

  // 添加到搜索历史
  addToHistory(keyword) {
    let history = [...this.data.searchHistory];
    // 如果已存在，先移除
    const index = history.indexOf(keyword);
    if (index > -1) {
      history.splice(index, 1);
    }
    // 添加到开头
    history.unshift(keyword);
    // 最多保留10条
    if (history.length > 10) {
      history = history.slice(0, 10);
    }
    this.setData({
      searchHistory: history
    });
    // 保存到本地存储
    wx.setStorageSync('groupSearchHistory', history);
  },

  // 清除搜索历史
  clearHistory() {
    this.setData({
      searchHistory: []
    });
    wx.removeStorageSync('groupSearchHistory');
  },

  // 模拟搜索
  performSearch(keyword) {
    // 模拟搜索结果
    const mockResults = [
      {
        id: 1,
        author: {
          name: '伦敦留学生小李'
        },
        title: `关于${keyword}的讨论`,
        content: `最近很多人在问${keyword}相关的问题，我来分享一下我的经验...`
      },
      {
        id: 2,
        author: {
          name: '巴黎旅游爱好者'
        },
        title: `${keyword}攻略分享`,
        content: `刚从${keyword}回来，给大家整理了一份详细的攻略...`
      },
      {
        id: 3,
        author: {
          name: '柏林生活达人'
        },
        title: `${keyword}经验贴`,
        content: `在柏林生活多年，关于${keyword}有一些心得想和大家分享...`
      }
    ];

    this.setData({
      searchResults: mockResults
    });
  },

  // 跳转到帖子详情
  goToPostDetail(e) {
    const id = e.currentTarget.dataset.id;
    console.log('跳转到帖子详情:', id);
    // 这里可以跳转到帖子详情页面
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  },

  // 页面加载
  onLoad() {
    // 从本地存储读取搜索历史
    const history = wx.getStorageSync('groupSearchHistory') || [];
    this.setData({
      searchHistory: history.length > 0 ? history : this.data.searchHistory
    });
  }
});