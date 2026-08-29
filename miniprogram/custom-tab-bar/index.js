Component({
  data: {
    selected: 0,
    color: '#999999',
    selectedColor: '#1296db',
    tabList: [
      {
        pagePath: '/pages/home/home',
        text: '首页',
        iconPath: '/images/home_no.png',
        selectedIconPath: '/images/home_yes.png',
        isPost: false
      },
      {
        pagePath: '/pages/group/group',
        text: '组聊',
        iconPath: '/images/group_no.png',
        selectedIconPath: '/images/group_yes.png',
        isPost: false
      },
      {
        pagePath: '/pages/post/post',
        text: '发帖',
        iconPath: '/images/post_no.png',
        selectedIconPath: '/images/post_yes.png',
        isPost: true
      },
      {
        pagePath: '/pages/message/message',
        text: '消息',
        iconPath: '/images/message_no.png',
        selectedIconPath: '/images/message_yes.png',
        isPost: false
      },
      {
        pagePath: '/pages/wode/wode',
        text: '我的',
        iconPath: '/images/wode_no.png',
        selectedIconPath: '/images/wode_yes.png',
        isPost: false
      }
    ]
  },
  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      wx.switchTab({
        url
      })
      this.setData({
        selected: data.index
      })
    }
  }
})