// app.js
const { CLOUD_ENV_ID } = require('./config/env')

App({
  onLaunch() {
    this.initCloud()
  },

  /**
   * 云能力初始化（M1-06）。环境 ID 只从 config/env.js 读，不在页面里散落。
   * 初始化失败不抛错、不阻断启动，只在控制台给出可操作的报错 —— 页面仍要能渲染。
   */
  initCloud() {
    if (!wx.cloud) {
      console.error('[HeyBay] 当前调试基础库不支持云开发，请在 详情 → 本地设置 → 调试基础库 里选 2.2.3 以上版本')
      return
    }
    if (!CLOUD_ENV_ID) {
      console.error('[HeyBay] 云环境 ID 未配置：请把云开发控制台里的环境 ID 填进 miniprogram/config/env.js')
      return
    }
    wx.cloud.init({
      env: CLOUD_ENV_ID,
      // 把用户访问记录到云开发控制台的用户管理里，便于联调时确认 openid
      traceUser: true
    })
    this.globalData.cloudReady = true
  },

  globalData: {
    userInfo: null,
    // 云能力是否就绪。页面在调云函数前应先看这个标志，避免在未初始化时报难懂的底层错误
    cloudReady: false
  }
})
