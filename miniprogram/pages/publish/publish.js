/**
 * 发布页（M1-15）。PRD 6.2 的 P0 页面在 M1 的形态：一个能把需求发出去的纯表单。
 *
 * 它同时就是 M2 里 AI 解析失败后的降级路径（D-15）—— 所以首屏刻意保留"一句话输入框 +
 * 帮我整理"的结构：M2 只需把「帮我整理」换成一次 aiGateway 调用，页面不用重做。
 *
 * 三条纪律：
 *   1. 枚举一律从 models/enums.js 取，**不写字符串字面量**
 *   2. 金额、见面时间、见面地点三项留空并高亮，配"这几项请你自己确认"（PRD 6.4 / 5.4）
 *   3. 偏好区只有「仅同性响应」，不提供任何异性偏好选项（D-09）
 */

const {
  REQUEST_CATEGORY_VALUES,
  REQUEST_CATEGORY_LABEL,
  REQUEST_CATEGORY,
  TIMING_TYPE,
  INSTANT_DURATION,
  INSTANT_DURATION_VALUES,
  REWARD_TYPE,
  REWARD_TYPE_VALUES,
  VISIBILITY,
  VISIBILITY_VALUES,
  PREFERENCE_FLAG
} = require('../../models/enums')
const { validateRequestDraft } = require('../../models/schema')
const requestService = require('../../services/request')
const { track } = require('../../utils/track')

/** 展示文案与枚举分开：文案改动不该牵动端云两份枚举（D-27） */
const TIMING_LABEL = {
  [TIMING_TYPE.INSTANT]: '即时型（马上要）',
  [TIMING_TYPE.SCHEDULED]: '预约型（约好时间）'
}
const DURATION_LABEL = {
  [INSTANT_DURATION.H1]: '1 小时内',
  [INSTANT_DURATION.H3]: '3 小时内',
  [INSTANT_DURATION.TODAY]: '今天内'
}
const REWARD_LABEL = {
  [REWARD_TYPE.FREE]: '免费互助',
  [REWARD_TYPE.MEAL]: '请一顿',
  [REWARD_TYPE.PAID]: '付费',
  [REWARD_TYPE.GOODS]: '以物换物'
}
const VISIBILITY_LABEL = {
  [VISIBILITY.CITY]: '城市公开',
  [VISIBILITY.GROUP]: '指定小组',
  [VISIBILITY.INVITE]: '仅定向邀请'
}

const toOptions = (values, labels) => values.map(value => ({ value, label: labels[value] }))

Page({
  data: {
    // 首屏
    oneLine: '',
    expanded: false,

    // 选项（都由枚举生成，页面模板里不出现枚举字面量）
    categoryOptions: toOptions(REQUEST_CATEGORY_VALUES, REQUEST_CATEGORY_LABEL),
    timingOptions: toOptions([TIMING_TYPE.INSTANT, TIMING_TYPE.SCHEDULED], TIMING_LABEL),
    durationOptions: toOptions(INSTANT_DURATION_VALUES, DURATION_LABEL),
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
    globalError: ''
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
   * 「帮我整理」：M1 直接展开完整表单，不调 AI。
   * M2 在这里插入 parseRequest 调用并把结果填进表单（M2-07），页面结构不变。
   */
  onOrganize() {
    this.setData({ expanded: true })
    if (this.data.oneLine.trim() && !this.data.form.detail) {
      // 一句话原文先落到"具体需求"里，用户不用重打一遍
      this.setData({ 'form.detail': this.data.oneLine.trim() })
    }
  },

  onFieldInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`form.${field}`]: e.detail.value, [`errors.${field}`]: '' })
  },

  onPick(e) {
    const { field, value } = e.currentTarget.dataset
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
   * `fieldSources` 是给服务端看的字段来源标记（PRD 5.4）：M1 全部来自用户本人，
   * 所以只有 `user` 与 `empty` 两种取值。M2 接入 AI 解析后，AI 给的字段标 `ai`，
   * 而金额 / 见面时间 / 见面地点 / 联系方式这四项标了 `ai` 会被服务端直接拒绝。
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

    draft.fieldSources = {
      amount: draft.amount ? 'user' : 'empty',
      expectTime: draft.expectTime ? 'user' : 'empty',
      area: draft.area ? 'user' : 'empty',
      contact: 'empty'
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
