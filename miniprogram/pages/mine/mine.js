/**
 * 我的（M1-14）。M1 只做主干闭环需要的最小集：
 *   - 登录建档（幂等，可反复点）
 *   - 补全常驻城市与性别 —— 「仅同性响应」的判定依赖性别（D-26），
 *     没有这个入口，M1-10 的性别规则在界面上就无从验证
 *
 * 信任分展示、增信任务、会员、设置等属 M3~M5，本页不提前做。
 */

const userService = require('../../services/user')
const { GENDER } = require('../../models/enums')

/** 性别选项：值来自枚举，中文只是展示（UI 文案不进枚举，避免端云两份枚举因文案而漂移） */
const GENDER_OPTIONS = [
  { value: GENDER.MALE, label: '男' },
  { value: GENDER.FEMALE, label: '女' }
]

/** M1 只开伦敦（D-10），其余城市在 M3 开城后从 configs 下发 */
const CITY_OPTIONS = [{ value: 'london', label: '伦敦' }]

Page({
  data: {
    loading: true,
    user: null,
    nickName: '',
    genderOptions: GENDER_OPTIONS,
    cityOptions: CITY_OPTIONS,
    error: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
    this.loadMe()
  },

  async loadMe() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await userService.getMe()
      this.setData({ user: res.user, nickName: res.user ? res.user.nickName : '' })
    } catch (err) {
      // 业务错误原样展示，不弹通用"网络错误"
      this.setData({ error: err.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  async onLogin() {
    try {
      const res = await userService.login({ nickName: this.data.nickName })
      this.setData({ user: res.user })
      wx.showToast({ title: res.created ? '已建档' : '已登录', icon: 'none' })
    } catch (err) {
      this.setData({ error: err.message })
    }
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onSaveNickName() {
    await this.patchProfile({ nickName: this.data.nickName })
  },

  async onPickGender(e) {
    await this.patchProfile({ gender: e.currentTarget.dataset.value })
  },

  async onPickCity(e) {
    await this.patchProfile({ city: e.currentTarget.dataset.value })
  },

  async patchProfile(patch) {
    try {
      const res = await userService.updateProfile(patch)
      this.setData({ user: res.user, error: '' })
      wx.showToast({ title: '已保存', icon: 'none' })
    } catch (err) {
      this.setData({ error: err.message })
      wx.showToast({ title: err.message, icon: 'none' })
    }
  }
})
