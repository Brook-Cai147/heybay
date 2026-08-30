/**
 * 需求单详情（M1-17）。**M1 的验收核心**：一个页面里把「响应 → 选定 → 双方确认完成」走完。
 *
 * 同一页面按身份切三种视角：
 *   - 需求方：响应列表 + 选定按钮
 *   - 其他人：响应入口（一句话 + 付费类报价，PRD 6.4 要求 10 秒内可完成）
 *   - 被选定的响应者：确认完成按钮
 *
 * 两条纪律：
 *   1. 选定不可逆 → 二次确认弹窗 + 安全提示卡**强制展示一次**（PRD 4.5）
 *   2. 所有失败原样呈现云函数给的业务提示（"你已响应过""已选定他人"），不吞错、不弹通用"网络错误"
 */

const requestService = require('../../services/request')
const responseService = require('../../services/response')
const { track } = require('../../utils/track')
const { REQUEST_STATUS, REWARD_TYPE } = require('../../models/enums')
const {
  STATUS_LABEL,
  CATEGORY_LABEL,
  REWARD_LABEL,
  TRUST_LEVEL_LABEL,
  TIMING_LABEL,
  INSTANT_DURATION_LABEL
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

    canRespond: false,
    canConfirmDone: false,
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

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await requestService.getDetail(this.requestId)
      const request = res.request || {}
      const isVisitor = res.viewerRole === 'visitor'
      const accepting = request.status === REQUEST_STATUS.OPEN || request.status === REQUEST_STATUS.RESPONDED

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
        // 游客 + 还没响应过 + 单子在可响应状态，才给响应入口
        canRespond: isVisitor && !res.myResponseId && accepting,
        canConfirmDone:
          request.status === REQUEST_STATUS.MATCHED && (res.isOwner || res.isMatchedResponder)
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
        title: '选定后不可更改',
        content: '选定之后这条需求就锁定给对方了，不能再改选别人。确定吗？',
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
        content: '取消会被记录（取消次数将来会影响信用），确定吗？',
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
