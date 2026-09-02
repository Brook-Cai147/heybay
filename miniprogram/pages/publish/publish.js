/**
 * 发布页（M1-15 表单 / M2-07 接入 AI 解析）。PRD 6.2 的 P0 页面。
 *
 * PRD 6.4 的形态：**表单是解析后的结果，不是输入的起点**。首屏只有一个输入框，
 * 点「帮我整理」调 `aiGateway.parseRequest`，解析结果填进下面这张表单，每一项都能改。
 *
 * 三条纪律：
 *   1. 枚举一律从 models/enums.js 取，**不写字符串字面量**
 *   2. 金额、见面时间、见面地点三项留空并高亮，配"这几项请你自己确认"（PRD 6.4 / 5.4）
 *   3. 偏好区只有「仅同性响应」，不提供任何异性偏好选项（D-09）
 *
 * 降级是这一页的重点（D-15）：解析失败、超时、额度耗尽、成本护栏四种情况，
 * 表现完全一样 —— 展开纯表单 + 一行说明，**发布功能一项不少**。
 * 所以 `services/ai.js` 永不抛错，这里不需要 try-catch 分支来兜四种失败。
 */

const {
  REQUEST_CATEGORY_VALUES,
  REQUEST_CATEGORY,
  TIMING_TYPE,
  INSTANT_DURATION,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE,
  REWARD_TYPE_VALUES,
  VISIBILITY,
  VISIBILITY_VALUES,
  PREFERENCE_FLAG,
  FIELD_SOURCE
} = require('../../models/enums')
const {
  CATEGORY_LABEL,
  TIMING_LABEL,
  INSTANT_DURATION_LABEL,
  REWARD_LABEL,
  VISIBILITY_LABEL,
  FIELD_LABEL
} = require('../../models/labels')
const { validateRequestDraft } = require('../../models/schema')
const requestService = require('../../services/request')
const aiService = require('../../services/ai')
const { track } = require('../../utils/track')

const toOptions = (values, labels) => values.map(value => ({ value, label: labels[value] }))

/** 四类只能本人填的字段（PRD 5.4）。与云侧 `requestValidator.USER_ONLY_FIELDS` 同一份清单 */
const USER_ONLY_FIELDS = ['amount', 'expectTime', 'area', 'contact']

/**
 * 追问上限 2 轮（PRD 5.4）。第 3 次不再调模型，直接让用户用表单填。
 * 理由：连着两次都没整理对，再试一次的期望收益远低于让用户多等一次网络往返。
 */
const ORGANIZE_MAX = 3

const labelsOf = fields => fields.map(field => FIELD_LABEL[field] || field).join('、')

Page({
  data: {
    // 首屏
    oneLine: '',
    expanded: false,

    // 选项（都由枚举生成，页面模板里不出现枚举字面量）
    categoryOptions: toOptions(REQUEST_CATEGORY_VALUES, CATEGORY_LABEL),
    timingOptions: toOptions([TIMING_TYPE.INSTANT, TIMING_TYPE.SCHEDULED], TIMING_LABEL),
    durationOptions: toOptions(INSTANT_DURATION_VALUES, INSTANT_DURATION_LABEL),
    rewardOptions: toOptions(REWARD_TYPE_VALUES, REWARD_LABEL),
    visibilityOptions: toOptions(VISIBILITY_VALUES, VISIBILITY_LABEL),

    // 表单（city 固定伦敦：M1 只开一城，D-10）
    form: {
      category: '',
      city: 'london',
      title: '',
      detail: '',
      timing: TIMING_TYPE.INSTANT,
      instantDuration: INSTANT_DURATION.H3,
      expectDate: '',
      expectTime: '',
      rewardType: '',
      amount: '',
      headcount: '',
      area: '',
      visibility: VISIBILITY.CITY,
      sameGenderOnly: false
    },

    // 常量给模板用（避免模板里写字面量）
    TIMING_INSTANT: TIMING_TYPE.INSTANT,
    TIMING_SCHEDULED: TIMING_TYPE.SCHEDULED,
    REWARD_PAID: REWARD_TYPE.PAID,
    CATEGORY_COMPANION: REQUEST_CATEGORY.COMPANION,

    errors: {},
    hints: [],
    submitting: false,
    globalError: '',

    // ---- AI 解析（M2-07）----
    organizing: false,
    /** 已经调过几次「帮我整理」，到 ORGANIZE_MAX 就不再调（PRD 5.4 追问上限） */
    organizeCount: 0,
    /** 解析结果卡片的内容；null 表示没有解析结果（纯表单路径） */
    parse: null,
    /** 每个字段的来源标记：ai / user / empty。发布时随草稿一起提交 */
    sources: {},
    /** 本次解析的 logId 与 AI 填了哪些字段，发布时回传给服务端算采纳率（M2-08） */
    aiMeta: null,
    /** 降级说明：解析用不了时显示的一行话，不是报错 */
    degradeHint: '',
    /** 上次自动填进「具体需求」的原文，用来判断能不能覆盖（用户手改过就不覆盖） */
    autoFilledDetail: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
  },

  onOneLineInput(e) {
    this.setData({ oneLine: e.detail.value })
  },

  /**
   * 「帮我整理」：调 AI 解析（M2-07）。
   *
   * 四种失败（模型抽风、超时、额度耗尽、成本护栏）在这里**没有分支** ——
   * `services/ai.js` 已经把它们收敛成 `ok: false + message`，一律走同一条降级路径。
   */
  async onOrganize() {
    if (this.data.organizing) return

    const text = this.data.oneLine.trim()
    if (!text) {
      // 没写字就直接展开表单：用户可能本来就想自己填
      this.expandPlainForm('')
      return
    }

    // 追问上限：到次数就不再调模型，直说并展开表单
    if (this.data.organizeCount >= ORGANIZE_MAX) {
      this.expandPlainForm('试了几次都没整理好，下面直接填吧，一样能发出去')
      return
    }

    this.setData({ organizing: true, degradeHint: '' })
    wx.showLoading({ title: '正在整理', mask: true })
    try {
      const res = await aiService.parseRequest(text, this.data.form.city)
      this.setData({ organizeCount: this.data.organizeCount + 1 })
      if (res.ok) {
        this.applyParsed(res)
      } else {
        // 降级：把 message 原样当说明展示。服务端给的都是人话（D-15）
        this.expandPlainForm(res.message)
      }
    } finally {
      wx.hideLoading()
      this.setData({ organizing: false })
    }
  },

  /**
   * 「具体需求」当前的内容是不是上一次自动填进去的。
   *
   * 需要区分这件事，否则会出现：用户换了一句话重新整理，而"具体需求"里还留着上一次那句 ——
   * 界面上两处内容对不上，用户会以为发出去的是旧的那条。
   * 判定方式是记下上次自动填的原文，只有内容没被手改过才允许覆盖。
   */
  detailIsAutoFilled() {
    return !this.data.form.detail || this.data.form.detail === this.data.autoFilledDetail
  },

  /** 把一句话原文落进"具体需求"，并记下它是自动填的 */
  autoFillDetail(patch) {
    const text = this.data.oneLine.trim()
    if (!text || !this.detailIsAutoFilled()) return false
    patch['form.detail'] = text
    patch.autoFilledDetail = text
    return true
  },

  /** 降级到纯表单：一句话原文先落进"具体需求"，用户不用重打一遍 */
  expandPlainForm(degradeHint) {
    const patch = { expanded: true, parse: null, aiMeta: null, degradeHint }
    this.autoFillDetail(patch)
    this.setData(patch)
  },

  /** 把解析结果填进表单，并记下每个字段的来源 */
  applyParsed(res) {
    const draft = res.draft || {}
    const sources = Object.assign({}, res.fieldSources)
    const patch = { expanded: true, degradeHint: '' }

    for (const field of ['category', 'title', 'detail', 'timing', 'instantDuration', 'rewardType']) {
      if (draft[field] !== null && draft[field] !== undefined && draft[field] !== '') {
        patch[`form.${field}`] = draft[field]
      }
    }
    if (draft.headcount) patch['form.headcount'] = String(draft.headcount)
    // 模型给了 detail 就用它；没给才拿原话兜底 —— 原话比空白有用
    if (patch['form.detail']) {
      patch.autoFilledDetail = patch['form.detail']
    } else if (this.autoFillDetail(patch)) {
      sources.detail = FIELD_SOURCE.USER
    }

    // 四类字段一律不填（服务端已经抹空过，这里是端侧的第二道保险）
    for (const field of USER_ONLY_FIELDS) sources[field] = FIELD_SOURCE.EMPTY

    const aiFields = (res.aiFilledFields || []).filter(f => !USER_ONLY_FIELDS.includes(f))

    patch.sources = sources
    patch.parse = {
      summary: draft.summary || '',
      confidence: res.confidence || '',
      hint: res.unclassified ? res.hint : '',
      aiFieldLabels: labelsOf(aiFields),
      userOnlyLabels: labelsOf(['amount', 'expectTime', 'area'])
    }
    patch.aiMeta = {
      logId: res.meta && res.meta.logId,
      aiFilledFields: res.aiFilledFields || []
    }
    this.setData(patch)
  },

  /**
   * 用户改了一个 AI 填的字段：来源改成 user 并上报一条事件。
   *
   * 上报点选在**改动发生的那一刻**而不是发布时，因为「字段修改率」衡量的是用户改不改，
   * 包括那些最终没发出去的草稿。发布时的字段级采纳率由服务端另算（M2-08），
   * 两个数分工不同、不能混。
   */
  markFieldTouched(field) {
    if (this.data.sources[field] !== FIELD_SOURCE.AI) return
    this.setData({ [`sources.${field}`]: FIELD_SOURCE.USER })
    track('ai_field_modified', { capability: 'parseRequest', field })
  },

  onFieldInput(e) {
    const { field } = e.currentTarget.dataset
    this.markFieldTouched(field)
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },

  onPick(e) {
    const { field, value } = e.currentTarget.dataset
    if (this.data.form[field] !== value) this.markFieldTouched(field)
    this.setData({ [`form.${field}`]: value, [`errors.${field}`]: '' })
  },

  onDateChange(e) {
    this.setData({ 'form.expectDate': e.detail.value, 'errors.expectTime': '' })
  },

  onTimeChange(e) {
    this.setData({ 'form.expectTime': e.detail.value, 'errors.expectTime': '' })
  },

  onSameGenderChange(e) {
    this.setData({ 'form.sameGenderOnly': e.detail.value })
  },

  /**
   * 把表单拼成需求单草稿。
   *
   * `fieldSources` 是给服务端看的字段来源标记（PRD 5.4）：
   * AI 填过又没被改的字段标 `ai`，用户填的标 `user`，空的标 `empty`。
   * 金额 / 见面时间 / 见面地点 / 联系方式这四项标了 `ai` 会被服务端直接拒绝 ——
   * 所以它们在端侧就永远只可能是 `user` 或 `empty`。
   */
  buildDraft() {
    const form = this.data.form
    const isScheduled = form.timing === this.data.TIMING_SCHEDULED
    const expectTime = isScheduled && form.expectDate && form.expectTime
      ? `${form.expectDate}T${form.expectTime}`
      : ''

    const draft = {
      category: form.category,
      city: form.city,
      title: form.title.trim(),
      detail: form.detail.trim(),
      timing: form.timing,
      rewardType: form.rewardType,
      visibility: form.visibility,
      area: form.area.trim(),
      preference: form.sameGenderOnly ? { [PREFERENCE_FLAG.SAME_GENDER_ONLY]: true } : {}
    }

    if (isScheduled) {
      draft.expectTime = expectTime
    } else {
      draft.instantDuration = form.instantDuration
    }
    if (form.rewardType === this.data.REWARD_PAID) {
      draft.amount = form.amount
    }
    if (form.category === this.data.CATEGORY_COMPANION) {
      draft.headcount = form.headcount
    }

    // 先取解析时记下的来源，再把四类字段按实际填写情况覆盖成 user / empty
    draft.fieldSources = Object.assign({}, this.data.sources, {
      amount: draft.amount ? FIELD_SOURCE.USER : FIELD_SOURCE.EMPTY,
      expectTime: draft.expectTime ? FIELD_SOURCE.USER : FIELD_SOURCE.EMPTY,
      area: draft.area ? FIELD_SOURCE.USER : FIELD_SOURCE.EMPTY,
      contact: FIELD_SOURCE.EMPTY
    })

    // 走过 AI 解析才带 aiMeta；纯表单发布不带，免得稀释采纳率的分母（M2-08）
    if (this.data.aiMeta && this.data.aiMeta.logId) {
      draft.aiMeta = this.data.aiMeta
    }
    return draft
  },

  async onSubmit() {
    if (this.data.submitting) return

    const draft = this.buildDraft()

    // 端侧校验只为体验：一次把所有问题标出来。服务端会独立再校验一遍（前端不可信）
    const check = validateRequestDraft(draft)
    const errors = {}
    for (const item of check.errors) errors[item.field] = item.message
    this.setData({ errors, hints: check.hints, globalError: '' })

    if (!check.valid) {
      wx.showToast({ title: `还有 ${check.errors.length} 处要补`, icon: 'none' })
      return
    }

    // 发布意图先埋点（不论成功失败），否则失败的发布在数据里看不见
    track('request_publish_submitted', {
      category: draft.category,
      city: draft.city,
      timing: draft.timing,
      rewardType: draft.rewardType
    })

    this.setData({ submitting: true })
    try {
      const res = await requestService.create(draft)
      wx.showToast({ title: '发出去了', icon: 'success' })
      wx.navigateTo({ url: `/pages/request-detail/request-detail?id=${res.requestId}` })
    } catch (err) {
      // 业务错误原样展示（如同城在架上限、城市未开城），不吞成"网络错误"
      this.setData({ globalError: err.message })
      wx.showToast({ title: err.message, icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
