/**
 * 需求单详情（M1-17）。**M1 的验收核心**：一个页面里把「响应 → 选定 → 交换联系方式 → 双方确认完成」走完。
 *
 * 同一页面按身份切三种视角：
 *   - 需求方：响应列表 + 选定 / 撤销选定
 *   - 其他人：响应入口（一句话 + 付费类报价，PRD 6.4 要求 10 秒内可完成）
 *   - 被选定的响应者：对方联系方式 + 确认完成
 *
 * 三条纪律：
 *   1. 「谁在什么状态下能看到什么按钮」一律走 `models/viewRules.js`，页面里不再手写条件 ——
 *      条件写错的表现是"按钮不出现"，和"功能没做"长得一样，M1-17 已经因此漏过一次
 *   2. 选定前安全提示卡**强制展示一次**（PRD 4.5）；选定可以撤销（D-35），但已经看到的联系方式收不回
 *   3. 所有失败原样呈现云函数给的业务提示（"你已响应过""已选定他人"），不吞错、不弹通用"网络错误"
 */

const requestService = require('../../services/request')
const responseService = require('../../services/response')
const { track } = require('../../utils/track')
const { REQUEST_STATUS, REWARD_TYPE } = require('../../models/enums')
const { resolveDetailActions } = require('../../models/viewRules')
const {
  STATUS_LABEL,
  CATEGORY_LABEL,
  REWARD_LABEL,
  TRUST_LEVEL_LABEL,
  TIMING_LABEL,
  INSTANT_DURATION_LABEL,
  CONTACT_TYPE_LABEL
} = require('../../models/labels')

/** 安全提示卡的四条（PRD 4.5），选定前强制看一次 */
const SAFETY_TIPS = [
  '首次见面选咖啡馆、商场这类公共场所',
  '不提前转账、不付定金',
  '不交出证件、不留住址',
  '把行程和对方信息告诉一个朋友'
]

Page({
  data: {
    loading: true,
    error: '',

    request: null,
    owner: null,
    responses: [],
    viewerRole: 'visitor',
    isOwner: false,
    isMatchedResponder: false,
    myResponseId: null,
    doneConfirm: { owner: false, responder: false },

    // 对方联系方式（D-36）：只有达成共识后云端才会下发，端侧不做任何兜底推断
    peerContact: null,
    peerNickName: '',
    peerContactLabel: '',

    // 展示文案
    statusLabel: '',
    categoryLabel: '',
    rewardLabel: '',
    timingLabel: '',
    expireText: '',

    // 响应表单
    pitch: '',
    quote: '',
    needQuote: false,
    submitting: false,

    // 选定流程
    safetyVisible: false,
    pendingResponseId: '',
    selecting: false,
    unselecting: false,

    /** 全部动作可见性由 viewRules 统一给出，页面不再自己算（见文件头纪律 1） */
    actions: {},
    safetyTips: SAFETY_TIPS,
    // 模板里比较状态用这两个常量，不写字符串字面量
    STATUS_DONE: REQUEST_STATUS.DONE,
    STATUS_RESPONDED: REQUEST_STATUS.RESPONDED
  },

  onLoad(query) {
    this.requestId = query.id || ''
    if (!this.requestId) {
      this.setData({ loading: false, error: '缺少需求单 id' })
      return
    }
    this.load()
  },

  /**
   * 每次回到页面都重新拉一次。
   * 双人流程里另一端随时可能改状态（选定/撤销/确认完成），只在 onLoad 拉一次的话，
   * 切到另一个账号再切回来看到的是旧数据 —— M1-17 的「响应方看不到我这边已完成」就是这个原因。
   */
  onShow() {
    if (this.requestId && !this.data.loading) this.load()
  },

  /** 双人流程没有推送（私信属 M3），下拉刷新是用户唯一的主动同步手段 */
  async onPullDownRefresh() {
    if (this.requestId) await this.load()
    wx.stopPullDownRefresh()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await requestService.getDetail(this.requestId)
      const request = res.request || {}
      const actions = resolveDetailActions({
        status: request.status,
        viewerRole: res.viewerRole,
        hasMyResponse: Boolean(res.myResponseId),
        doneConfirm: res.doneConfirm
      })

      this.setData({
        request,
        owner: res.owner,
        responses: res.responses.map(item =>
          Object.assign({}, item, {
            trustLabel: TRUST_LEVEL_LABEL[item.responderTrustLevel] || TRUST_LEVEL_LABEL.newcomer
          })
        ),
        viewerRole: res.viewerRole,
        isOwner: res.isOwner,
        isMatchedResponder: res.isMatchedResponder,
        myResponseId: res.myResponseId,
        doneConfirm: res.doneConfirm,

        peerContact: res.peerContact || null,
        peerNickName: res.peerNickName || '',
        peerContactLabel: res.peerContact
          ? (CONTACT_TYPE_LABEL[res.peerContact.type] || CONTACT_TYPE_LABEL.other)
          : '',

        statusLabel: STATUS_LABEL[request.status] || request.status,
        categoryLabel: CATEGORY_LABEL[request.category] || request.category,
        rewardLabel: request.rewardType === REWARD_TYPE.PAID && request.amount
          ? `${REWARD_LABEL[request.rewardType]} ${request.amount}`
          : REWARD_LABEL[request.rewardType] || '',
        timingLabel: request.instantDuration
          ? INSTANT_DURATION_LABEL[request.instantDuration]
          : TIMING_LABEL[request.timing] || '',
        expireText: this.formatTime(request.expireAt),

        needQuote: request.rewardType === REWARD_TYPE.PAID,
        actions
      })
    } catch (err) {
      this.setData({ error: err.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  formatTime(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  onPitchInput(e) {
    this.setData({ pitch: e.detail.value })
  },

  onQuoteInput(e) {
    this.setData({ quote: e.detail.value })
  },

  /** 响应：一句话自荐 +（付费类）报价，两个输入框，10 秒内能完成 */
  async onSubmitResponse() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const res = await responseService.submit(this.requestId, {
        pitch: this.data.pitch,
        quote: this.data.needQuote ? this.data.quote : undefined
      })
      wx.showToast({ title: '已响应，等对方选定', icon: 'none' })
      this.setData({ pitch: '', quote: '', error: '' })
      await this.load()
      return res
    } catch (err) {
      // 业务错误原样展示：包含"你已响应过""补全性别后可响应""需求方已选定别人"等
      this.setData({ error: err.message })
      wx.showModal({ title: '没能响应', content: err.message, showCancel: false })
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 点「选定」先弹安全提示卡，用户看完才进二次确认 —— 提示卡是强制的，不能跳过 */
  onTapSelect(e) {
    const responseId = e.currentTarget.dataset.id
    this.setData({ safetyVisible: true, pendingResponseId: responseId })
    track('safety_tip_shown', { requestId: this.requestId })
  },

  onCancelSelect() {
    this.setData({ safetyVisible: false, pendingResponseId: '' })
  },

  async onConfirmSelect() {
    const responseId = this.data.pendingResponseId
    if (!responseId || this.data.selecting) return

    const confirm = await new Promise(resolve => {
      wx.showModal({
        title: '确认选定他',
        content: '选定之后你们会互相看到对方的联系方式，自己去约。选定期间别人不能再响应；如果约不上，你可以撤销选定重新挑人（撤销会被记录）。',
        confirmText: '确定选定',
        success: res => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return

    this.setData({ selecting: true })
    try {
      await requestService.selectResponder(this.requestId, responseId)
      wx.showToast({ title: '已选定', icon: 'success' })
      this.setData({ safetyVisible: false, pendingResponseId: '', error: '' })
      await this.load()
    } catch (err) {
      this.setData({ error: err.message })
      wx.showModal({ title: '没能选定', content: err.message, showCancel: false })
    } finally {
      this.setData({ selecting: false })
    }
  },

  /**
   * 撤销选定（D-35）：退回待选定，可以重新挑人。
   * 弹窗里必须说清两件事 —— 已经看到的联系方式收不回；撤销会被记录。
   */
  async onUnselect() {
    if (this.data.unselecting) return
    const confirm = await new Promise(resolve => {
      wx.showModal({
        title: '撤销选定？',
        content: '这条需求会退回"待选定"，你可以重新挑人。对方已经看到的联系方式无法收回，撤销次数会被记录。',
        confirmText: '撤销选定',
        success: res => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return

    this.setData({ unselecting: true })
    try {
      await requestService.unselectResponder(this.requestId, '')
      wx.showToast({ title: '已撤销，可重新挑人', icon: 'none' })
      this.setData({ error: '' })
      await this.load()
    } catch (err) {
      this.setData({ error: err.message })
      wx.showModal({ title: '没能撤销', content: err.message, showCancel: false })
    } finally {
      this.setData({ unselecting: false })
    }
  },

  /** 联系方式一律给复制按钮：手抄微信号/号码极易出错，出错的代价是双方约不上 */
  onCopyContact() {
    const contact = this.data.peerContact
    if (!contact || !contact.value) return
    wx.setClipboardData({ data: contact.value })
  },


  /** 确认完成：双方各自确认，两边都点了才真的进 done */
  async onConfirmDone() {
    try {
      const res = await requestService.confirmDone(this.requestId)
      if (res.status === REQUEST_STATUS.DONE) {
        wx.showToast({ title: '双方已确认，完成', icon: 'success' })
      } else if (res.repeated) {
        wx.showToast({ title: '你已经确认过了，等对方确认', icon: 'none' })
      } else {
        wx.showToast({ title: '已确认，等对方确认', icon: 'none' })
      }
      await this.load()
    } catch (err) {
      this.setData({ error: err.message })
      wx.showModal({ title: '没能确认', content: err.message, showCancel: false })
    }
  },

  /** 取消：需求方任何阶段可取消，被选定的响应者在已确定后可取消 */
  async onCancel() {
    const confirm = await new Promise(resolve => {
      wx.showModal({
        title: '取消这条需求？',
        content: '整条需求会关闭，其他人也无法再响应。取消记录会保留（信用主要看双方真实评价，不是取消次数）。',
        success: res => resolve(res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return

    try {
      await requestService.cancel(this.requestId, '')
      wx.showToast({ title: '已取消', icon: 'none' })
      await this.load()
    } catch (err) {
      this.setData({ error: err.message })
      wx.showModal({ title: '没能取消', content: err.message, showCancel: false })
    }
  },

  goSquare() {
    wx.switchTab({ url: '/pages/square/square' })
  }
})
