/**
 * 小螺对话页（M2-13）。PRD 5.2「底层能力 + 对话入口双轨」里对话入口那一轨。
 *
 * 这一页刻意做得很薄：**编排规则在服务端**（`ai/orchestrator.js`），页面只负责
 * 显示气泡、收集用户的确认、把会话状态（澄清轮数与待确认草稿）带回服务端。
 *
 * 三条纪律：
 *   1. **服务端不存会话**，所以 `clarifyCount` 与 `pendingDraft` 必须由这一页原样回传。
 *   2. **每条 AI 消息都带「AI 协助」标识**（PRD 5.4 身份明示），由服务端的 `aiAssisted` 决定，
 *      页面不自己判断哪条是 AI 说的。
 *   3. **不在对话里再造一套表单**：草稿缺必填项时交给发布页补齐（同 M2-07 解析卡片的判断）。
 */

const aiService = require('../../services/ai')
const { CATEGORY_LABEL } = require('../../models/labels')
const { track } = require('../../utils/track')

/** 与发布页共用的交接 key（M2-13）。改这里要同时改 publish.js */
const ASSISTANT_HANDOFF_KEY = 'assistant_draft_handoff'

/** 气泡角色 */
const ROLE = { ME: 'me', AI: 'ai' }

Page({
  data: {
    city: 'london',
    input: '',
    sending: false,
    messages: [],
    /** 服务端不存会话状态，这两项由本页持有并回传 */
    clarifyCount: 0,
    pendingDraft: null,
    /** 落地清单要两个信息，分两步收：先选出行类型，再让用户说到达时间 */
    travelTypeOptions: [],
    travelType: '',
    seq: 0,
    scrollInto: '',

    /**
     * 自主性档位（M2-14 / D-14）。**这一块必须让用户看得见、随时能改。**
     * 档位与「为什么是这一档」都由服务端给，页面不自己推断 —— 显示错的档位比不显示更糟，
     * 用户正是靠这行字判断"AI 会不会替我发东西"。
     */
    level: '',
    levelName: '',
    levelReason: '',
    ladder: [],
    never: null,
    selectable: [],
    ladderVisible: false,
    switching: false
  },

  onLoad() {
    this.greet()
    this.loadAutonomy()
  },

  /** 拉档位。失败就整块不显示（level 为空），不猜一个默认值糊上去 */
  async loadAutonomy() {
    const res = await aiService.autonomyInfo()
    if (!res.ok) return
    const ladder = (res.ladder || []).map(item =>
      Object.assign({}, item, { current: item.level === res.level })
    )
    this.setData({
      level: res.level || '',
      levelName: this.nameOf(ladder, res.level),
      levelReason: res.levelReason || '',
      ladder,
      never: res.never || null,
      selectable: res.selectable || []
    })
  },

  nameOf(ladder, level) {
    const hit = ladder.find(item => item.level === level)
    return hit ? hit.name : ''
  },

  onToggleLadder() {
    this.setData({ ladderVisible: !this.data.ladderVisible })
  },

  /** 挡住蒙层的点透：点面板内部不该把面板关掉 */
  noop() {},


  /** 切档位。L0 ⇄ L1 双向都走这里 —— 可回退是 PRD 5.4 的硬要求，不是善意 */
  async onPickLevel(e) {
    const level = e.currentTarget.dataset.level
    if (!level || level === this.data.level || this.data.switching) return
    this.setData({ switching: true })
    const res = await aiService.setAutonomy(level)
    this.setData({ switching: false })
    if (!res.ok) {
      wx.showModal({ title: '没能切换', content: res.message, showCancel: false })
      return
    }
    await this.loadAutonomy()
    this.setData({ ladderVisible: false })
    this.push(ROLE.AI, {
      kind: 'clarify',
      text: `已切到「${(res.info && res.info.name) || level}」档。${(res.info && res.info.summary) || ''}`,
      aiAssisted: true
    })
  },


  /** 首屏身份声明（PRD 5.4）。文案来自服务端，取不到用兜底文案，绝不留空 */
  async greet() {
    const greeting = await aiService.assistantGreeting()
    this.push(ROLE.AI, { kind: 'greeting', text: greeting, aiAssisted: true })
  },

  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  /** 追加一条气泡并滚到底 */
  push(role, payload) {
    const seq = this.data.seq + 1
    const message = Object.assign({ id: `m${seq}`, role }, payload)
    this.setData({
      messages: this.data.messages.concat(message),
      seq,
      scrollInto: message.id
    })
    return message
  },

  onSend() {
    const text = this.data.input.trim()
    if (!text || this.data.sending) return
    this.push(ROLE.ME, { kind: 'text', text })
    this.setData({ input: '' })
    this.turn({ text })
  },

  /** 认不出意图时给的三个按钮：点了就按它走，不再猜这句话 */
  onPickOption(e) {
    const intent = e.currentTarget.dataset.intent
    const label = e.currentTarget.dataset.label
    this.push(ROLE.ME, { kind: 'text', text: label })
    this.turn({ text: label, forcedIntent: intent })
  },

  /** 落地清单缺的两项：先选出行类型，再等用户说到达时间 */
  onPickTravelType(e) {
    const travelType = e.currentTarget.dataset.value
    this.setData({ travelType })
    this.push(ROLE.ME, { kind: 'text', text: travelType })
    this.push(ROLE.AI, {
      kind: 'clarify',
      text: '好，大概什么时候到？写个大概时间就行，比如「10 月 3 日晚上」。',
      aiAssisted: true
    })
  },

  /**
   * 走一轮对话。
   *
   * 这里**没有失败分支**：`services/ai.js` 永不抛错，软失败也带 `message`，
   * 一律当成一条普通的 AI 气泡显示 —— 对话不能因为某个工具失败就断掉（D-15）。
   */
  async turn(extra = {}) {
    this.setData({ sending: true })

    const res = await aiService.assistantChat(
      Object.assign(
        {
          city: this.data.city,
          clarifyCount: this.data.clarifyCount,
          pendingDraft: this.data.pendingDraft,
          travelType: this.data.travelType,
          arriveAt: this.data.travelType ? extra.text : ''
        },
        extra
      )
    )

    this.setData({ sending: false })

    if (!res.ok) {
      this.push(ROLE.AI, { kind: 'soft_fail', text: res.message, aiAssisted: true })
      return
    }

    this.renderReply(res)
  },

  /** 把服务端的一条 reply 变成一条气泡 + 相应的交互 */
  renderReply(res) {
    const reply = res.reply || {}
    const patch = { clarifyCount: res.clarifyCount || 0 }

    // 草稿：存起来等用户确认；缺必填项就不给"确认发布"，改为交给发布页
    if (reply.kind === 'draft') {
      patch.pendingDraft = reply.missingFields && reply.missingFields.length
        ? null
        : Object.assign({}, reply.draft, {
            fieldSources: reply.fieldSources,
            aiMeta: reply.aiMeta
          })
      this.lastParse = reply
    }
    if (reply.kind === 'created') {
      patch.pendingDraft = null
    }
    if (reply.kind === 'need_params') {
      patch.travelTypeOptions = reply.travelTypeOptions || []
    }

    this.setData(patch)

    this.push(ROLE.AI, {
      kind: reply.kind,
      text: reply.text,
      aiAssisted: reply.aiAssisted === true,
      options: reply.options || [],
      sources: reply.sources || [],
      groups: reply.groups || [],
      candidates: reply.candidates || [],
      travelTypeOptions: reply.travelTypeOptions || [],
      missingFields: reply.missingFields || [],
      needsConfirm: reply.needsConfirm === true,
      categoryLabel: reply.draft ? CATEGORY_LABEL[reply.draft.category] || '' : '',
      requestId: reply.requestId || ''
    })
  },

  /**
   * 确认发布。**这是 `createRequest` 唯一的触发点**（计划 M2-13 第 3 条）——
   * 助手绝不会自己走到这一步，必须由用户点这个按钮。
   */
  onConfirmDraft() {
    if (!this.data.pendingDraft || this.data.sending) return
    this.push(ROLE.ME, { kind: 'text', text: '确认发布' })
    track('request_publish_submitted', {
      category: this.data.pendingDraft.category,
      city: this.data.pendingDraft.city || this.data.city,
      timing: this.data.pendingDraft.timing,
      rewardType: this.data.pendingDraft.rewardType
    })
    this.turn({ text: '', confirmed: true })
  },

  /** 放弃这份草稿。可回退是 PRD 5.4 明确要求的 */
  onDropDraft() {
    this.setData({ pendingDraft: null })
    this.push(ROLE.AI, { kind: 'clarify', text: '好，这条不发了。你可以重新说一句。', aiAssisted: true })
  },

  /** 缺必填项 → 把草稿交给发布页补齐，不在对话里再造一套表单 */
  onHandoffPublish() {
    const parse = this.lastParse
    if (!parse) return
    try {
      wx.setStorageSync(ASSISTANT_HANDOFF_KEY, {
        draft: parse.draft,
        fieldSources: parse.fieldSources,
        confidence: parse.confidence,
        unclassified: parse.unclassified,
        hint: parse.text,
        aiFilledFields: parse.aiFilledFields,
        meta: parse.aiMeta ? { logId: parse.aiMeta.logId } : null
      })
    } catch (err) {
      wx.showToast({ title: '带不过去，麻烦直接去表单填', icon: 'none' })
      return
    }
    wx.switchTab({ url: '/pages/publish/publish' })
  },

  onOpenRequest(e) {
    const requestId = e.currentTarget.dataset.id
    if (!requestId) return
    wx.navigateTo({ url: `/pages/request-detail/request-detail?id=${requestId}` })
  }
})
