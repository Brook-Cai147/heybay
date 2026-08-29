Page({
  data: {
    // 互动消息数据
    interactionData: {
      likes: {
        text: '赞',
        unread: 2
      },
      comments: {
        text: '评论',
        unread: 3
      },
      follows: {
        text: '关注',
        unread: 1
      }
    },
    
    // 系统消息数据
    systemMessages: {
      atMe: {
        unread: 1
      },
      system: {
        unread: 2
      }
    },
    
    // 聊天消息数据
    chatMessages: [
      {
        name: '留学生小A',
        preview: '你好，我也在伦敦，想找个旅行搭子',
        time: '今天 14:30',
        unread: 1
      },
      {
        name: '旅行者小B',
        preview: '巴黎的酒店已经订好了，我们一起出发吧',
        time: '昨天',
        unread: 0
      },
      {
        name: '摄影爱好者C',
        preview: '周末一起去拍照怎么样？',
        time: '昨天',
        unread: 2
      },
      {
        name: '美食达人D',
        preview: '推荐一家超好吃的意大利餐厅',
        time: '3天前',
        unread: 0
      }
    ]
  },

  // 跳转到发现群聊
  goToDiscoverGroup() {
    wx.showToast({
      title: '跳转到发现群聊',
      icon: 'none'
    });
  },

  // 跳转到赞的页面
  goToLikes() {
    wx.showToast({
      title: '查看点赞消息',
      icon: 'none'
    });
  },

  // 跳转到评论的页面
  goToComments() {
    wx.showToast({
      title: '查看评论消息',
      icon: 'none'
    });
  },

  // 跳转到关注的页面
  goToFollows() {
    wx.showToast({
      title: '查看关注消息',
      icon: 'none'
    });
  },

  // 跳转到@我的页面
  goToAtMe() {
    wx.showToast({
      title: '查看@我的消息',
      icon: 'none'
    });
  },

  // 跳转到系统通知页面
  goToSystem() {
    wx.showToast({
      title: '查看系统通知',
      icon: 'none'
    });
  },

  // 跳转到聊天页面
  goToChat() {
    wx.showToast({
      title: '进入聊天页面',
      icon: 'none'
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
        selected: 3
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