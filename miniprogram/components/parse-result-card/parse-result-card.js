/**
 * 解析结果卡片（M2-07）。「我理解成这样，对吗？」
 *
 * 刻意**不把表单搬进卡片里**：下面那张表单本来就每个字段都能改，
 * 再复制一份到卡片内部只会有两处要同步维护，而且用户会分不清改哪一份才算。
 * 这张卡片只负责三件事：
 *   1. 明示这是 AI 协助的结果（PRD 5.4 身份明示）
 *   2. 把模型的理解用一句话说出来，让用户能快速发现它理解错了
 *   3. 点出哪几项它没敢填、需要用户自己确认
 */

Component({
  properties: {
    /** 模型的一句话理解 */
    summary: { type: String, value: '' },
    /** 草稿级置信度：high / medium / low */
    confidence: { type: String, value: '' },
    /** 归不进品类白名单时的提示语 */
    hint: { type: String, value: '' },
    /** AI 给出了建议的字段中文名（已拼成一句），用于"这些是我填的" */
    aiFieldLabels: { type: String, value: '' },
    /** 需要用户自己确认的字段中文名（已拼成一句） */
    userOnlyLabels: { type: String, value: '' }
  },

  data: {
    CONFIDENCE_TEXT: {
      high: '',
      // 置信度不高时把话说在前面，比让用户自己发现错了更省事
      medium: '有几项我没把握，麻烦你确认一下',
      low: '这条我理解得不太有底，建议你逐项过一遍'
    }
  },

  methods: {
    onRetry() {
      this.triggerEvent('retry')
    }
  }
})
