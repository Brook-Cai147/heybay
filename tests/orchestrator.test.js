/**
 * M2-13 工具编排单测。
 *
 * 这一层守的是"助手不硬猜"：
 *   路由错     → 用户问路，助手给他发了一条需求单，且不会报错
 *   确认被绕过 → `createRequest` 是唯一有副作用的工具，绕过确认就是替用户发单（PRD 5.4 可回退）
 *   追问不收敛 → 反复追问比给三个按钮更烦，而且每次追问都是一次真实的模型调用
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  INTENT,
  TOOL,
  INTENT_TOOL,
  SIDE_EFFECT_TOOLS,
  MAX_CLARIFY,
  FALLBACK_OPTIONS,
  detectIntent,
  plan
} = require('../cloudfunctions/_shared/ai/orchestrator')
const { AI_CAPABILITY } = require('../cloudfunctions/_shared/constants/aiCapabilities')
const { isCallable } = require('../cloudfunctions/_shared/ai/registry')

test('工具集只有五个，且每个都是注册表里真的能调的能力（计划第 1 条）', () => {
  const tools = Object.values(TOOL)
  assert.equal(tools.length, 5)
  assert.deepEqual(tools.slice().sort(), [
    AI_CAPABILITY.CREATE_REQUEST,
    AI_CAPABILITY.GENERATE_CHECKLIST,
    AI_CAPABILITY.MATCH_RESPONDERS,
    AI_CAPABILITY.PARSE_REQUEST,
    AI_CAPABILITY.SEARCH_KNOWLEDGE
  ].slice().sort())
  for (const tool of tools) {
    // createRequest 只写库不调模型，注册表里仍是占位，这是唯一的例外
    if (tool === TOOL.CREATE_REQUEST) continue
    assert.equal(isCallable(tool), true, `${tool} 在注册表里还没实现，助手不该接它`)
  }
})

test('四条主路径各自落到唯一的工具', () => {
  assert.equal(INTENT_TOOL[INTENT.PUBLISH], TOOL.PARSE_REQUEST)
  assert.equal(INTENT_TOOL[INTENT.ASK], TOOL.SEARCH_KNOWLEDGE)
  assert.equal(INTENT_TOOL[INTENT.CHECKLIST], TOOL.GENERATE_CHECKLIST)
  assert.equal(INTENT_TOOL[INTENT.MATCH], TOOL.MATCH_RESPONDERS)
})

test('意图识别：四条典型说法各归各位', () => {
  assert.equal(detectIntent('想找个人周末一起看球').intent, INTENT.PUBLISH)
  assert.equal(detectIntent('伦敦怎么买电话卡').intent, INTENT.ASK)
  assert.equal(detectIntent('帮我列个落地清单').intent, INTENT.CHECKLIST)
  assert.equal(detectIntent('谁能帮我这条单', { hasActiveRequest: true }).intent, INTENT.MATCH)
})

test('优先级：同时命中多组关键词时，先判更具体的那个', () => {
  // "谁能帮我" 里也有 "帮我"（PUBLISH 的词），必须判成 MATCH
  assert.equal(detectIntent('谁能帮我带点东西', { hasActiveRequest: true }).intent, INTENT.MATCH)
  // "要办什么" 里也有疑问词（ASK 的词），必须判成 CHECKLIST
  assert.equal(detectIntent('刚落地第一周要办什么', { hasActiveRequest: true }).intent, INTENT.CHECKLIST)
})

test('问"谁能帮我"但手上没有在架的单：不当 MATCH，改为引导先发单', () => {
  const res = detectIntent('谁能帮我', { hasActiveRequest: false })
  assert.equal(res.intent, INTENT.UNKNOWN)
  assert.equal(res.reason, 'no_active_request')

  const step = plan({ text: '谁能帮我', hasActiveRequest: false })
  assert.equal(step.action, 'clarify')
  assert.match(step.question, /需求单/)
})

test('认不出来先澄清一次，再认不出来就给三个按钮 —— 不反复追问', () => {
  const first = plan({ text: '嗯嗯', clarifyCount: 0 })
  assert.equal(first.action, 'clarify')
  assert.equal(first.clarifyCount, 1)

  const second = plan({ text: '还是不知道', clarifyCount: 1 })
  assert.equal(second.action, 'offer_options')
  assert.deepEqual(second.options, FALLBACK_OPTIONS)
  assert.equal(second.options.length, 3)
  assert.ok(MAX_CLARIFY === 2)
})

test('点了按钮就按按钮走，不再重新猜这句话', () => {
  const step = plan({ text: '随便', forcedIntent: INTENT.CHECKLIST })
  assert.equal(step.action, 'call_tool')
  assert.equal(step.tool, TOOL.GENERATE_CHECKLIST)
  assert.equal(step.matchedBy, 'user_choice')
})

test('解析这一步就要告诉端侧"后面有个确认"', () => {
  const step = plan({ text: '想找个人帮我搬箱子' })
  assert.equal(step.tool, TOOL.PARSE_REQUEST)
  assert.equal(step.needsConfirm, true)
})

test('createRequest 只在带着草稿且已确认时才会被规划出来', () => {
  const draft = { category: 'errand', title: '帮我带点东西' }

  const noConfirm = plan({ text: '发吧', pendingDraft: draft, confirmed: false })
  assert.notEqual(noConfirm.tool, TOOL.CREATE_REQUEST, '没确认就不许建单')

  const noDraft = plan({ text: '发吧', pendingDraft: null, confirmed: true })
  assert.notEqual(noDraft.tool, TOOL.CREATE_REQUEST, '没草稿也无从建单')

  const go = plan({ text: '', pendingDraft: draft, confirmed: true })
  assert.equal(go.tool, TOOL.CREATE_REQUEST)
  assert.equal(go.draft, draft)
  assert.equal(go.needsConfirm, false)
  assert.equal(go.confirmedAt, 'user')
})

test('有副作用的工具只有 createRequest —— 其余四个都是只读的', () => {
  assert.deepEqual(SIDE_EFFECT_TOOLS, [TOOL.CREATE_REQUEST])
})

test('确认优先于意图识别：用户说"再改改"也不该覆盖掉已点的确认', () => {
  const draft = { category: 'errand', title: 'x' }
  const step = plan({ text: '想找人', pendingDraft: draft, confirmed: true })
  assert.equal(step.tool, TOOL.CREATE_REQUEST, '确认这一步不参与关键词竞争')
})

test('空输入不当成任何意图', () => {
  assert.equal(detectIntent('').intent, INTENT.UNKNOWN)
  assert.equal(detectIntent('   ').intent, INTENT.UNKNOWN)
})
