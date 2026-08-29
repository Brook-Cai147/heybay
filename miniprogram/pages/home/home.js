Page({
  data: {
    // 宫格导航数据
    activeNav: 0,
    navLevel2List: [
      '伦敦', '巴黎', '柏林', '罗马'
    ],
    navLevel2Data: [
      ['伦敦', '巴黎', '柏林', '罗马'], // 地域群组
      ['自由行', '徒步', '游轮', '摄影', '美食'], // 其他群组
      ['西欧环线', '北欧极光', '东南亚海岛'], // 路线规划
      ['门票车票', '向导服务', '旅行装备'] // 旅游产品
    ],
    
    // 筛选相关
    showSortDropdown: false,
    activeSort: 'hot',
    
    // 帖子数据
    posts: [
      {
        id: 1,
        nickname: '旅行爱好者',
        title: '伦敦一周游攻略，必去景点推荐和美食指南',
        image: '/images/postings/VCG211333201276.jpg',
        likes: 128,
        liked: false
      },
      {
        id: 2,
        nickname: '背包客小明',
        title: '巴黎自由行，如何在三天内玩转主要景点',
        image: '/images/postings/VCG211348953220.jpg',
        likes: 96,
        liked: false
      },
      {
        id: 3,
        nickname: '摄影达人',
        title: '意大利罗马摄影攻略，最佳拍摄地点分享',
        image: '/images/postings/VCG211368749144.jpg',
        likes: 156,
        liked: false
      },
      {
        id: 4,
        nickname: '美食探索者',
        title: '德国柏林美食之旅，不容错过的当地特色',
        image: '/images/postings/VCG211376475322.jpg',
        likes: 89,
        liked: false
      }
    ],
    loading: false
  },

  onLoad(options) {
    // 页面加载时初始化
  },

  onReady() {
    // 页面初次渲染完成
  },

  onShow() {
    // 页面显示时更新TabBar状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0
      })
    }
  },

  onHide() {
    // 页面隐藏
  },

  onUnload() {
    // 页面卸载
  },

  onPullDownRefresh() {
    // 下拉刷新
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 1000)
  },

  // 跳转到搜索页面
  goToSearch() {
    wx.navigateTo({
      url: '/pages/search/search'
    })
  },

  // 跳转到热搜页面
  goToHotSearch() {
    wx.navigateTo({
      url: '/pages/hot-search/hot-search'
    })
  },

  // 跳转到轮播图详情
  goToBannerDetail() {
    wx.navigateTo({
      url: '/pages/banner-detail/banner-detail'
    })
  },

  // 切换宫格导航一级分类
  switchNav(e) {
    const index = e.currentTarget.dataset.index
    this.setData({
      activeNav: index,
      navLevel2List: this.data.navLevel2Data[index]
    })
  },

  // 导航到详情页面
  navigateToDetail() {
    wx.showToast({
      title: '功能开发中',
      icon: 'none'
    })
  },

  // 显示地点选择器
  showLocationPicker() {
    wx.showToast({
      title: '地点选择',
      icon: 'none'
    })
  },

  // 显示日期选择器
  showDatePicker() {
    wx.showToast({
      title: '日期选择',
      icon: 'none'
    })
  },

  // 显示排序选择器
  showSortPicker() {
    this.setData({
      showSortDropdown: !this.data.showSortDropdown
    })
  },

  // 选择排序选项
  selectSort(e) {
    const sort = e.currentTarget.dataset.sort
    this.setData({
      activeSort: sort,
      showSortDropdown: false
    })
    wx.showToast({
      title: `已选择: ${sort === 'hot' ? '最热' : sort === 'new' ? '最新' : '发现'}`,
      icon: 'none'
    })
  },

  // 跳转到帖子详情页
  goToPostDetail(e) {
    const postId = e.currentTarget.dataset.id || 1
    wx.navigateTo({
      url: `/pages/post-detail/post-detail?id=${postId}`
    })
  },

  // 切换点赞状态
  toggleLike(e) {
    const index = e.currentTarget.dataset.index
    const posts = [...this.data.posts]
    const post = posts[index]
    
    if (post.liked) {
      post.likes--
    } else {
      post.likes++
    }
    post.liked = !post.liked
    
    this.setData({
      posts
    })
  },

  // 上拉加载更多
  loadMore() {
    if (this.data.loading) return
    
    this.setData({ loading: true })
    
    // 模拟加载更多数据
    setTimeout(() => {
      const newPosts = [
        {
          id: Date.now() + 1,
          nickname: '旅行博主',
          title: '北欧极光之旅，最佳观赏时间和地点',
          image: '/images/postings/VCG211378100967.jpg',
          likes: Math.floor(Math.random() * 200),
          liked: false
        },
        {
          id: Date.now() + 2,
          nickname: '自由行达人',
          title: '东南亚海岛游，性价比最高的度假胜地',
          image: '/images/postings/VCG211385876247.jpg',
          likes: Math.floor(Math.random() * 200),
          liked: false
        }
      ]
      
      this.setData({
        posts: [...this.data.posts, ...newPosts],
        loading: false
      })
    }, 1000)
  }
})