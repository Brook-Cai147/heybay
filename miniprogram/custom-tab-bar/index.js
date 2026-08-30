/**
 * 自定义 tabBar（M1-14 改为 PRD 6.1 的五 Tab）。
 *
 * V1.0 的「组聊 / 发帖」等 Tab 已摘除；旧页面文件保留在 `pages/` 下作重构对照，
 * 但已不在 `app.json` 的路由里（前提第 7 条：不删）。
 *
 * 中间的「喊一声」是主动作入口，`isPost: true` 让它在样式上突出。
 */
Component({
  data: {
    selected: 0,
    color: '#999999',
    selectedColor: '#1296db',
    tabList: [
      {
        pagePath: '/pages/square/square',
        text: '首页',
        iconPath: '/images/home_no.png',
        selectedIconPath: '/images/home_yes.png',
        isPost: false
      },
      {
        pagePath: '/pages/city/city',
        text: '城市',
        iconPath: '/images/group_no.png',
        selectedIconPath: '/images/group_yes.png',
        isPost: false
      },
      {
        pagePath: '/pages/publish/publish',
        text: '喊一声',
        iconPath: '/images/post_no.png',
        selectedIconPath: '/images/post_yes.png',
        isPost: true
      },
      {
        pagePath: '/pages/notice/notice',
        text: '消息',
        iconPath: '/images/message_no.png',
        selectedIconPath: '/images/message_yes.png',
        isPost: false
      },
      {
        pagePath: '/pages/mine/mine',
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
      wx.switchTab({ url: data.path })
      this.setData({ selected: data.index })
    }
  }
})
