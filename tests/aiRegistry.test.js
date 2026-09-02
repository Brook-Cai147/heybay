/**
 * M2-03 能力注册表与 Prompt 模板单测。
 *
 * 这批用例守的是"注册表不撒谎"：登记的模板文件真的存在、Schema 真的能取到、
 * 额度类别与 M2-01 的表一致、占位项调不动、硬约束一定进 Prompt。
 * 注册表一旦和现实脱节，网关就会在运行时才发现，而那时错误信息只是一句 ENOENT。
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const {
  AI_CAPABILITY,
  AI_CAPABILITY_VALUES,
  CAPABILITY_TIER,
  QUOTA_TIER_VALUES
} = require('../cloudfunctions/_shared/constants/aiCapabilities')
const {
  AI_REGISTRY,
  MODEL_TIER_VALUES,
  FALLBACK_STRATEGY,
  FALLBACK_STRATEGY_VALUES,
  HARD_CONSTRAINTS_KEY,
  PROMPTS_DIR,
  recordOf,
  isCallable,
  assertCallable,
  implementedCapabilities,
  placeholderCapabilities,
  loadHardConstraints,
  loadPrompt,
  renderPrompt,
  missingPlaceholders
} = require('../cloudfunctions/_shared/ai/registry')
const { REQUEST_CATEGORY_VALUES } = require('../cloudfunctions/_shared/constants/enums')
const { buildVars, renderSnippets } = require('../cloudfunctions/_shared/ai/promptVars')
const {
  PARSE_OUTPUT_FIELDS,
  USER_ONLY_FIELDS
} = require('../cloudfunctions/_shared/schemas/parseRequest')

/** parseRequest 组装时要注入的全部变量（与模板里的占位符一一对应） */
const PARSE_VARS = {
  city: 'london',
  outputFields: PARSE_OUTPUT_FIELDS,
  categories: REQUEST_CATEGORY_VALUES,
  timingTypes: ['scheduled', 'instant'],
  instantDurations: ['1h', '3h', 'today'],
  rewardTypes: ['free', 'meal', 'paid', 'goods'],
  fieldSources: ['user', 'ai', 'empty'],
  userText: '周末想找个人一起去看球'
}

test('注册表覆盖 PRD 5.2 的 14 项，不多不少', () => {
  assert.deepStrictEqual(Object.keys(AI_REGISTRY).sort(), [...AI_CAPABILITY_VALUES].sort())
  assert.strictEqual(AI_CAPABILITY_VALUES.length, 14)
})

test('本步只实现两项，其余 12 项是占位并注明里程碑', () => {
  assert.deepStrictEqual(implementedCapabilities(), [
    AI_CAPABILITY.PARSE_REQUEST,
    AI_CAPABILITY.SEARCH_KNOWLEDGE
  ])
  const placeholders = placeholderCapabilities()
  assert.strictEqual(placeholders.length, 12)
  for (const name of placeholders) {
    assert.match(AI_REGISTRY[name].milestone, /^M[1-9](-\d{2})?$/, `${name} 的里程碑标注不规范`)
  }
})

test('每条记录的额度类别都取自 M2-01 的表，且在三档之内', () => {
  for (const name of AI_CAPABILITY_VALUES) {
    const record = AI_REGISTRY[name]
    assert.strictEqual(record.quotaTier, CAPABILITY_TIER[name], `${name} 的额度类别与 M2-01 不一致`)
    assert.ok(QUOTA_TIER_VALUES.includes(record.quotaTier), `${name} 的额度类别不在三档内`)
  }
})

test('模型档位、降级策略、超时都是合法取值', () => {
  for (const name of AI_CAPABILITY_VALUES) {
    const record = AI_REGISTRY[name]
    assert.ok(MODEL_TIER_VALUES.includes(record.modelTier), `${name} 模型档位非法`)
    assert.ok(FALLBACK_STRATEGY_VALUES.includes(record.fallback), `${name} 降级策略非法`)
    assert.ok(record.timeoutSeconds > 0 && record.timeoutSeconds <= 30, `${name} 超时不合理`)
  }
})

test('已实现的能力：模板文件真的存在、输出 Schema 真的取得到', () => {
  for (const name of implementedCapabilities()) {
    const record = AI_REGISTRY[name]
    assert.ok(record.promptFile, `${name} 没登记模板文件`)
    assert.ok(fs.existsSync(path.join(PROMPTS_DIR, record.promptFile)), `${name} 模板文件不存在`)
    assert.ok(record.outputSchema, `${name} 取不到输出 Schema`)
    assert.strictEqual(record.outputSchema.type, 'object')
    assert.notStrictEqual(record.fallback, FALLBACK_STRATEGY.UNDECIDED, `${name} 必须定好降级策略`)
    assert.ok(record.input.required.length > 0, `${name} 必须声明入参契约`)
  }
})

test('占位项不得被网关调用，报错要指出排在哪个里程碑', () => {
  for (const name of placeholderCapabilities()) {
    assert.strictEqual(isCallable(name), false)
    assert.throws(() => assertCallable(name), err => {
      assert.strictEqual(err.code, 'CAPABILITY_NOT_IMPLEMENTED')
      assert.strictEqual(err.milestone, AI_REGISTRY[name].milestone)
      return true
    })
  }
})

test('未登记的能力名直接报 UNKNOWN_CAPABILITY，而不是当占位项处理', () => {
  assert.strictEqual(recordOf('notARealCapability'), null)
  assert.strictEqual(isCallable('notARealCapability'), false)
  assert.throws(() => assertCallable('notARealCapability'), /未登记/)
})

test('两条硬约束（PRD 5.4）一定进最终 Prompt：四类字段留空 + 四类问题拒答', () => {
  const constraints = loadHardConstraints()
  // 断言的是**英文键名**而不是中文说明：第一次真实调用时模型把「见面时间」自己译成了 meetTime，
  // 因为 Prompt 只给了中文。硬约束里必须出现模型真正要输出的那个键名。
  for (const field of USER_ONLY_FIELDS) {
    assert.ok(constraints.includes(field), `硬约束里缺字段键名 ${field}`)
  }
  assert.match(constraints, /留空/)
  assert.match(constraints, /签证、医疗、法律、移民/)
  assert.match(constraints, /GOV\.UK/)

  for (const name of implementedCapabilities()) {
    const prompt = loadPrompt(name)
    for (const field of USER_ONLY_FIELDS) {
      assert.ok(prompt.includes(field), `${name} 缺第一条硬约束里的 ${field}`)
    }
    assert.match(prompt, /签证、医疗、法律、移民/, `${name} 缺第二条硬约束`)
    assert.ok(
      !prompt.includes(`{{${HARD_CONSTRAINTS_KEY}}}`),
      `${name} 的硬约束占位符没被替换`
    )
  }
})

test('模板文件本身留占位符、不各抄一份硬约束（改一次就全生效）', () => {
  for (const name of implementedCapabilities()) {
    const raw = fs.readFileSync(path.join(PROMPTS_DIR, AI_REGISTRY[name].promptFile), 'utf8')
    assert.ok(raw.includes(`{{${HARD_CONSTRAINTS_KEY}}}`), `${name} 模板没留硬约束占位符`)
    assert.ok(!raw.includes('GOV.UK'), `${name} 模板里抄了硬约束正文，会与真源不同步`)
  }
})

test('模板里不写枚举字面量，枚举由组装时注入（枚举改了模板不用改）', () => {
  const raw = fs.readFileSync(path.join(PROMPTS_DIR, 'parseRequest.txt'), 'utf8')
  for (const category of REQUEST_CATEGORY_VALUES) {
    assert.ok(!raw.includes(category), `模板里硬编码了品类 ${category}`)
  }
  assert.ok(raw.includes('{{categories}}'), '模板必须留品类占位符')
})

test('组装后的 Prompt 不留任何未替换占位符，数组按顿号拼接', () => {
  const prompt = renderPrompt(AI_CAPABILITY.PARSE_REQUEST, PARSE_VARS)
  assert.deepStrictEqual(missingPlaceholders(prompt), [])
  assert.ok(prompt.includes(REQUEST_CATEGORY_VALUES.join('、')))
  assert.ok(prompt.includes('周末想找个人一起去看球'))
})

test('Prompt 必须给出全部输出字段的键名，否则模型会自己译一个（真实调用踩过的坑）', () => {
  const prompt = renderPrompt(AI_CAPABILITY.PARSE_REQUEST, PARSE_VARS)
  for (const field of PARSE_OUTPUT_FIELDS) {
    assert.ok(prompt.includes(field), `Prompt 里没给出字段名 ${field}`)
  }
  // 字段名来自 Schema，模板里不能手抄
  const raw = fs.readFileSync(path.join(PROMPTS_DIR, 'parseRequest.txt'), 'utf8')
  assert.ok(raw.includes('{{outputFields}}'), '模板必须留字段名占位符')
})

test('少传一个变量当场报错，绝不把 {{city}} 字面量发给模型', () => {
  const incomplete = Object.assign({}, PARSE_VARS)
  delete incomplete.city
  assert.throws(() => renderPrompt(AI_CAPABILITY.PARSE_REQUEST, incomplete), err => {
    assert.strictEqual(err.code, 'PROMPT_VARS_MISSING')
    assert.deepStrictEqual(err.missing, ['city'])
    return true
  })
})

test('searchKnowledge 的模板也能填满，且要求标注来源', () => {
  const prompt = renderPrompt(AI_CAPABILITY.SEARCH_KNOWLEDGE, {
    city: 'london',
    snippets: '（1）refId=abc kind=request：我上周去过，排队 20 分钟',
    question: '这个诊所要预约吗'
  })
  assert.deepStrictEqual(missingPlaceholders(prompt), [])
  assert.match(prompt, /refId/)
  assert.match(prompt, /编造/)
})

test('可缓存的能力必须给有效期，不可缓存的不许留残值', () => {
  for (const name of AI_CAPABILITY_VALUES) {
    const record = AI_REGISTRY[name]
    if (record.cacheable) {
      assert.ok(record.cacheTtlSeconds > 0, `${name} 标了可缓存却没有有效期`)
    } else {
      assert.strictEqual(record.cacheTtlSeconds, 0, `${name} 不可缓存却留了有效期`)
    }
  }
  // 个人自由文本不该缓存：命中率极低，撞哈希的后果是把别人的需求单塞给你
  assert.strictEqual(AI_REGISTRY[AI_CAPABILITY.PARSE_REQUEST].cacheable, false)
})

test('注册表与每条记录都是冻结的，防止运行时被改坏', () => {
  assert.ok(Object.isFrozen(AI_REGISTRY))
  for (const name of AI_CAPABILITY_VALUES) {
    assert.ok(Object.isFrozen(AI_REGISTRY[name]), `${name} 记录未冻结`)
    assert.ok(Object.isFrozen(AI_REGISTRY[name].input))
  }
})

// 以下两条属 M2-04：`promptVars` 是网关唯一的变量组装处，漏一个变量就等于线上少一次 AI 调用
test('promptVars 能把已实现能力的模板填满（组装器与模板不脱节）', () => {
  const context = {
    city: { nameZh: '伦敦', timeZone: 'Europe/London' },
    params: {
      text: '周末想找个人一起去看球',
      question: '这个诊所要预约吗',
      snippets: [{ refId: 'abc', kind: 'request', text: '我上周去过，排队 20 分钟' }]
    }
  }
  for (const name of implementedCapabilities()) {
    const prompt = renderPrompt(name, buildVars(name, context))
    assert.deepStrictEqual(missingPlaceholders(prompt), [], `${name} 的模板没被填满`)
  }
})

test('没有组装器的能力当场报错，而不是发一个缺变量的 Prompt', () => {
  assert.throws(() => buildVars(AI_CAPABILITY.GENERATE_CHECKLIST, {}), err => {
    assert.strictEqual(err.code, 'PROMPT_VARS_BUILDER_MISSING')
    return true
  })
})

test('检索语料为空时明确写「没有检索到」，不是留一段空白', () => {
  assert.match(renderSnippets([]), /没有检索到/)
  assert.match(renderSnippets([{ refId: 'x', kind: 'post', text: 'hi' }]), /refId=x/)
})
