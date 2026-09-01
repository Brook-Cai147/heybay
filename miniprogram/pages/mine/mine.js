/**
 * 我的（M1-14）。M1 只做主干闭环需要的最小集：
 *   - 登录建档（幂等，可反复点）
 *   - 补全常驻城市与性别 —— 「仅同性响应」的判定依赖性别（D-26），
 *     没有这个入口，M1-10 的性别规则在界面上就无从验证
 *
 *   - 填写联系方式（D-36）—— 达成共识后由云端下发给对方，是双方能真正联系上的前提
 *   - 「我发布的」与「我响应的」两个列表 —— 响应之后必须有地方能把那条单找回来，
 *     否则响应者退出页面就再也回不去（M1-17 后续补的缺口）
 *
 * 信任分展示、增信任务、会员、设置等属 M3~M5，本页不提前做。
 */

const userService = require('../../services/user')
const requestService = require('../../services/request')
const { GENDER, CONTACT_TYPE } = require('../../models/enums')

/** 性别选项：值来自枚举，中文只是展示（UI 文案不进枚举，避免端云两份枚举因文案而漂移） */
const GENDER_OPTIONS = [
  { value: GENDER.MALE, label: '男' },
  { value: GENDER.FEMALE, label: '女' }
]

/** M1 只开伦敦（D-10），其余城市在 M3 开城后从 configs 下发 */
const CITY_OPTIONS = [{ value: 'london', label: '伦敦' }]

/** 联系方式类型（D-36）。不校验格式：全球号码与各类 ID 差异太大，误拦比放过更烦人 */
const CONTACT_TYPE_OPTIONS = [
  { value: CONTACT_TYPE.WECHAT, label: '微信号' },
  { value: CONTACT_TYPE.PHONE, label: '电话' },
  { value: CONTACT_TYPE.OTHER, label: '其他' }
]

Page({
  data: {
    loading: true,
    user: null,
    nickName: '',
    genderOptions: GENDER_OPTIONS,
    cityOptions: CITY_OPTIONS,
    contactTypeOptions: CONTACT_TYPE_OPTIONS,
    contactType: CONTACT_TYPE.WECHAT,
    contactValue: '',
    hasContact: false,
    /** 我参与过的单子。`tab` 只切显示，数据一次全取回来 */
    mineTab: 'responded',
    published: [],
    responded: [],
    nowMs: Date.now(),
    listLoading: false,
    error: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 })
    }
    this.loadMe()
    this.loadMine()
  },

  async onPullDownRefresh() {
    await Promise.all([this.loadMe(), this.loadMine()])
    wx.stopPullDownRefresh()
  },

  async loadMe() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await userService.getMe()
      this.setData(
        Object.assign(
          { user: res.user, nickName: res.user ? res.user.nickName : '' },
          this.contactFields(res.myContact)
        )
      )
    } catch (err) {
      // 业务错误原样展示，不弹通用"网络错误"
      this.setData({ error: err.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 两个列表一次取回。没建档的人这里会失败，静默即可 —— 上面已经提示要先登录 */
  async loadMine() {
    this.setData({ listLoading: true })
    try {
      const res = await requestService.listMine()
      this.setData({
        published: res.published || [],
        responded: res.responded || [],
        nowMs: res.serverTime || Date.now()
      })
    } catch (err) {
      this.setData({ published: [], responded: [] })
    } finally {
      this.setData({ listLoading: false })
    }
  },

  onSwitchTab(e) {
    this.setData({ mineTab: e.currentTarget.dataset.tab })
  },

  onCardTap(e) {
    wx.navigateTo({ url: `/pages/request-detail/request-detail?id=${e.detail.requestId}` })
  },

  goSquare() {
    wx.switchTab({ url: '/pages/square/square' })
  },

  /** 把云端回的 `myContact` 摊平成表单字段；没填过时保留默认类型，输入框留空 */
  contactFields(myContact) {
    if (!myContact || !myContact.value) {
      return { contactType: CONTACT_TYPE.WECHAT, contactValue: '', hasContact: false }
    }
    return { contactType: myContact.type, contactValue: myContact.value, hasContact: true }
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

  onPickContactType(e) {
    this.setData({ contactType: e.currentTarget.dataset.value })
  },

  onContactInput(e) {
    this.setData({ contactValue: e.detail.value })
  },

  /** 保存联系方式：只在被选定之后下发给对方（D-36），列表与卡片里永远不出现 */
  async onSaveContact() {
    const value = this.data.contactValue.trim()
    if (!value) {
      wx.showToast({ title: '先填内容，或点"清空"', icon: 'none' })
      return
    }
    await this.patchProfile({ contact: { type: this.data.contactType, value } })
  },

  /** 清空是有意保留的能力：用户有权撤回自己的联系方式（已经发出去的收不回，见弹窗说明） */
  async onClearContact() {
    const confirm = await new Promise(resolve => {
      wx.showModal({
        title: '清空联系方式？',
        content: '清空之后新达成共识的人看不到你的联系方式。此前已经看到的人无法收回。',
        success: res => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return
    await this.patchProfile({ contact: null })
  },

  async patchProfile(patch) {
    try {
      const res = await userService.updateProfile(patch)
      this.setData(Object.assign({ user: res.user, error: '' }, this.contactFields(res.myContact)))
      wx.showToast({ title: '已保存', icon: 'none' })
    } catch (err) {
      this.setData({ error: err.message })
      wx.showToast({ title: err.message, icon: 'none' })
    }
  }
})
