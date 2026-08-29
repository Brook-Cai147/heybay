Page({
  data: {
    // 当前城市
    currentCity: '伦敦',
    // 我的组聊列表
    myGroups: [
      {
        name: '伦敦徒步搭子',
        unread: 8
      },
      {
        name: '巴黎华人互助',
        unread: 15
      },
      {
        name: '柏林二手交易',
        unread: 3
      },
      {
        name: '罗马美食分享',
        unread: 0
      }
    ],
    // 专栏标签
    columnTabs: ['搭子出行', '打听求助', '地陪跑腿', '二手交易', '租房住宿', '旅游攻略', '语言交流'],
    // 当前选中的标签
    activeTab: 0,
    // 排序方式
    activeSort: 'new', // new: 最新, hot: 热门
    // 热帖列表
    hotPosts: [
      {
        id: 1,
        author: {
          name: '伦敦留学生小李',
          tag: '留学生'
        },
        content: '周末想找个搭子一起去海德公园散步，有没有人一起呀？听说最近樱花开得特别美，想拍照打卡～',
        images: [],
        likes: 23,
        comments: 8,
        favorites: 5,
        liked: false,
        favorited: false
      },
      {
        id: 2,
        author: {
          name: '巴黎旅游爱好者',
          tag: '旅行者'
        },
        content: '刚到巴黎，想找个当地地陪带我们游览景点，有没有推荐的？最好能讲中文，我们对巴黎不太熟悉。',
        images: [],
        likes: 15,
        comments: 12,
        favorites: 3,
        liked: false,
        favorited: false
      },
      {
        id: 3,
        author: {
          name: '柏林生活达人',
          tag: '本地居民'
        },
        content: '出一台几乎全新的iPhone 13，去年买的，因为换了新手机所以转让，价格可议，柏林地区可面交。',
        images: ['/images/postings/VCG211333201276.jpg', '/images/postings/VCG211348953220.jpg'],
        likes: 45,
        comments: 23,
        favorites: 12,
        liked: false,
        favorited: false
      },
      {
        id: 4,
        author: {
          name: '罗马美食探店',
          tag: '美食博主'
        },
        content: '分享一家超级好吃的意大利餐厅，位于罗马市中心，提拉米苏是他们家的招牌，强烈推荐！',
        images: ['/images/postings/VCG211368749144.jpg', '/images/postings/VCG211376475322.jpg'],
        likes: 67,
        comments: 34,
        favorites: 28,
        liked: false,
        favorited: false
      },
      {
        id: 5,
        author: {
          name: '伦敦租房小能手',
          tag: '留学生'
        },
        content: '有没有人知道伦敦东区有什么性价比高的学生公寓？9月份要去伦敦留学，现在开始找房子了。',
        images: [],
        likes: 31,
        comments: 18,
        favorites: 9,
        liked: false,
        favorited: false
      },
      {
        id: 6,
        author: {
          name: '巴黎艺术爱好者',
          tag: '旅行者'
        },
        content: '卢浮宫真的太震撼了！特别是蒙娜丽莎，虽然人很多，但真的值得一看。推荐大家提前网上买票，避免排队。',
        images: ['/images/postings/VCG211378100967.jpg', '/images/postings/VCG211385876247.jpg'],
        likes: 56,
        comments: 27,
        favorites: 21,
        liked: false,
        favorited: false
      },
      {
        id: 7,
        author: {
          name: '柏林语言交换',
          tag: '语言学习者'
        },
        content: '寻找德语-中文语言交换伙伴，我会说流利的德语，可以教你，希望你能教我中文，柏林地区可以线下见面。',
        images: [],
        likes: 22,
        comments: 15,
        favorites: 7,
        liked: false,
        favorited: false
      }
    ],
    loading: false
  },

  // 显示城市选择器
  showCityPicker() {
    // 这里可以实现城市选择器的逻辑
    console.log('显示城市选择器');
  },

  // 跳转到搜索页面
  goToSearch() {
    wx.navigateTo({
      url: '/pages/search/search'
    });
  },

  // 跳转到组内搜索页面
  goToGroupSearch() {
    wx.navigateTo({
      url: '/pages/group-search/group-search'
    });
  },

  // 跳转到全部小组页面
  goToAllGroups() {
    // 这里可以跳转到全部小组页面
    console.log('跳转到全部小组页面');
  },

  // 发现小组
  discoverGroups() {
    // 这里可以跳转到发现小组页面
    console.log('跳转到发现小组页面');
  },

  // 进入小组
  enterGroup(e) {
    const index = e.currentTarget.dataset.index;
    const group = this.data.myGroups[index];
    // 这里可以跳转到小组详情页面
    console.log('进入小组:', group.name);
  },

  // 切换专栏标签
  switchTab(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({
      activeTab: index
    });
  },

  // 切换排序方式
  switchSort(e) {
    const sort = e.currentTarget.dataset.sort;
    this.setData({
      activeSort: sort
    });
  },

  // 跳转到帖子详情页面
  goToPostDetail(e) {
    const index = e.currentTarget.dataset.index;
    const post = this.data.hotPosts[index];
    // 这里可以跳转到帖子详情页面
    console.log('跳转到帖子详情:', post.id);
  },

  // 点赞/取消点赞
  toggleLike(e) {
    const index = e.currentTarget.dataset.index;
    const hotPosts = [...this.data.hotPosts];
    const post = hotPosts[index];
    if (post.liked) {
      post.likes--;
    } else {
      post.likes++;
    }
    post.liked = !post.liked;
    this.setData({ hotPosts });
  },

  // 收藏/取消收藏
  toggleFavorite(e) {
    const index = e.currentTarget.dataset.index;
    const hotPosts = [...this.data.hotPosts];
    const post = hotPosts[index];
    if (post.favorited) {
      post.favorites--;
    } else {
      post.favorites++;
    }
    post.favorited = !post.favorited;
    this.setData({ hotPosts });
  },

  // 加载更多帖子
  loadMore() {
    if (this.data.loading) return;
    
    this.setData({ loading: true });
    
    // 模拟加载更多数据
    setTimeout(() => {
      const newPosts = [
        {
          id: this.data.hotPosts.length + 1,
          author: {
            name: '伦敦摄影爱好者',
            tag: '摄影师'
          },
          content: '分享一组伦敦夜景照片，泰晤士河畔的夜景真的太美了，特别是伦敦眼和大本钟的灯光秀。',
          images: ['/images/postings/VCG211399070942.jpg', '/images/postings/VCG211404238172.jpg'],
          likes: 18,
          comments: 9,
          favorites: 6,
          liked: false,
          favorited: false
        },
        {
          id: this.data.hotPosts.length + 2,
          author: {
            name: '巴黎时尚达人',
            tag: '时尚博主'
          },
          content: '巴黎时装周真的太精彩了！分享一些街头时尚照片，巴黎人的穿搭真的很有品味。',
          images: ['/images/postings/VCG211416820277.jpg', '/images/postings/VCG211431781403.jpg'],
          likes: 42,
          comments: 21,
          favorites: 15,
          liked: false,
          favorited: false
        }
      ];
      
      this.setData({
        hotPosts: [...this.data.hotPosts, ...newPosts],
        loading: false
      });
    }, 1000);
  },

  // 页面加载
  onLoad() {
    console.log('组聊页面加载');
  },

  // 下拉刷新
  onPullDownRefresh() {
    // 模拟刷新数据
    setTimeout(() => {
      wx.stopPullDownRefresh();
      console.log('刷新完成');
    }, 1000);
  }
});