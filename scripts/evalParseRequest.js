/**
 * parseRequest 离线评测（M2-15 / D-31）。**不计入 `npm test`**：要联网、要花钱、要调真实模型。
 *
 *   node scripts/evalParseRequest.js            跑全集
 *   node scripts/evalParseRequest.js --dry      不调模型，只检查标注集与 Prompt 组装
 *   node scripts/evalParseRequest.js --limit 5  只跑前 5 条（改 Prompt 时先小样本试）
 *   node scripts/evalParseRequest.js --case a03 只跑某一条
 *
 * 为什么脚本能在本地直接跑：`ai/` 下全是纯逻辑，`modelClient` 只用 Node 原生 https。
 * 唯一的外部依赖是 `.env` 里的三个模型变量 —— 这也是"厂商只是三个环境变量"这条设计的副产物。
 *
 * 三个数的口径写在标注集的 `metrics` 字段里，不在这里另写一套（口径只能有一个真源）。
 * 特别注意 **四类字段误填看的是模型原始输出**：`normalizeDraft` 会把它们抹空，
 * 只看规范化之后的结果永远是 0，那等于用自己的防线证明自己没错。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SHARED = path.join(ROOT, 'cloudfunctions', '_shared')

const { AI_CAPABILITY } = require(path.join(SHARED, 'constants/aiCapabilities'))
const { recordOf, renderPrompt } = require(path.join(SHARED, 'ai/registry'))
const { buildVars } = require(path.join(SHARED, 'ai/promptVars'))
const { validate } = require(path.join(SHARED, 'service/aiSchemaValidator'))
const { parseRequestSchema, USER_ONLY_FIELDS } = require(path.join(SHARED, 'schemas/parseRequest'))
const { normalizeDraft } = require(path.join(SHARED, 'ai/parseDraft'))
const modelClient = require(path.join(SHARED, 'ai/modelClient'))

const GOLDEN_FILE = path.join(ROOT, 'tests/fixtures/parseRequestGolden.json')
const RESULT_FILE = path.join(ROOT, 'tests/fixtures/evalResults.json')

/** 评测城市固定伦敦（M1 只开伦敦）。`nameZh` 是 Prompt 需要的形态 */
const CITY = Object.freeze({ code: 'london', nameZh: '伦敦' })

/** 极简 .env 读取。项目零运行时依赖，不为一个脚本引 dotenv */
const loadEnv = () => {
  const file = path.join(ROOT, '.env')
  if (!fs.existsSync(file)) return false
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at <= 0) continue
    const key = trimmed.slice(0, at).trim()
    const value = trimmed.slice(at + 1).trim()
    if (value && !process.env[key]) process.env[key] = value
  }
  return true
}

const parseArgs = argv => {
  const args = { dry: false, limit: 0, case: '' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry') args.dry = true
    if (argv[i] === '--limit') args.limit = Number(argv[i + 1] || 0)
    if (argv[i] === '--case') args.case = String(argv[i + 1] || '')
  }
  return args
}

/** 组 Prompt。和线上走同一套 `buildVars` + `renderPrompt`，否则评的就不是线上那个 Prompt */
const promptFor = text =>
  renderPrompt(
    AI_CAPABILITY.PARSE_REQUEST,
    buildVars(AI_CAPABILITY.PARSE_REQUEST, { params: { text, city: CITY.code }, city: CITY })
  )

/** 模型返回的可能是带 ```json 围栏的文本，剥掉再解析 */
const parseJson = text => {
  const cleaned = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return { ok: true, data: JSON.parse(cleaned) }
  } catch (err) {
    return { ok: false, reason: `输出不是合法 JSON：${cleaned.slice(0, 120)}` }
  }
}

/**
 * 比一条。
 *
 * 只比**标注里写了的键**：标注集不写的键代表人也拿不准，拿不准的东西不该算进准确率。
 * 模糊输入走 `acceptableCategories`，命中任一即算对。
 */
const judge = (item, raw, normalized) => {
  const checks = []
  const expect = item.expect || {}

  if (Array.isArray(item.acceptableCategories)) {
    const got = normalized.draft.category
    checks.push({
      field: 'category',
      expected: `其中之一：${item.acceptableCategories.join(' / ')}`,
      got,
      pass: item.acceptableCategories.includes(got)
    })
  }

  for (const [field, expected] of Object.entries(expect)) {
    if (field === 'unclassified') {
      checks.push({
        field,
        expected,
        got: normalized.unclassified,
        pass: normalized.unclassified === expected
      })
      continue
    }
    const got = normalized.draft[field]
    checks.push({ field, expected, got, pass: got === expected })
  }

  // 四类字段：看模型原始输出。规范化层会抹空，只看规范化后等于用自己的防线证明自己没错
  const userOnlyFilled = USER_ONLY_FIELDS.filter(field => {
    const value = raw ? raw[field] : null
    return !(value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))
  })

  return { checks, userOnlyFilled }
}

/** 跑一条。返回值刻意扁平，好直接进结果文件 */
const runCase = async (item, { dry, record }) => {
  const prompt = promptFor(item.text)
  if (dry) return { id: item.id, kind: item.kind, dry: true, promptChars: prompt.length }

  let call
  try {
    call = await modelClient.chat({
      modelTier: record.modelTier,
      prompt,
      timeoutMs: record.timeoutSeconds * 1000,
      jsonMode: true
    })
  } catch (err) {
    return { id: item.id, kind: item.kind, error: `${err.code || 'CALL_FAILED'}: ${err.message}` }
  }

  const parsed = parseJson(call.text)
  if (!parsed.ok) {
    return { id: item.id, kind: item.kind, error: parsed.reason, latencyMs: call.latencyMs }
  }

  const validation = validate(parseRequestSchema, parsed.data)
  if (!validation.valid) {
    // 校验不过在线上会重试一次再降级；评测里不重试，如实记成一次失败
    return {
      id: item.id,
      kind: item.kind,
      error: `校验不通过：${JSON.stringify(validation.errors.slice(0, 4))}`,
      latencyMs: call.latencyMs
    }
  }

  const normalized = normalizeDraft(validation.value)
  const { checks, userOnlyFilled } = judge(item, parsed.data, normalized)

  return {
    id: item.id,
    kind: item.kind,
    checks,
    userOnlyFilled,
    unclassified: normalized.unclassified,
    confidence: normalized.confidence,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens
  }
}

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10)

/** 结果文件按次追加，改完 Prompt 能直接看涨跌（计划 M2-15 第 4 条） */
const appendHistory = summary => {
  let history = []
  if (fs.existsSync(RESULT_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')).runs || []
    } catch (err) {
      console.warn('[eval] 历史结果文件读不动，本次另起一份')
    }
  }
  history.push(summary)
  fs.writeFileSync(RESULT_FILE, `${JSON.stringify({ runs: history }, null, 2)}\n`, 'utf8')
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const hasEnv = loadEnv()
  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'))
  const record = recordOf(AI_CAPABILITY.PARSE_REQUEST)

  let cases = golden.cases
  if (args.case) cases = cases.filter(item => item.id === args.case)
  if (args.limit > 0) cases = cases.slice(0, args.limit)

  if (!args.dry) {
    if (!hasEnv) console.warn('[eval] 没找到根目录 .env，将只读进程环境变量')
    try {
      modelClient.resolveConfig(record.modelTier)
    } catch (err) {
      console.error(`[eval] ${err.message}`)
      console.error('[eval] 填好 .env 里的 AI_PRIMARY_* 再跑；只想检查标注集就加 --dry')
      process.exitCode = 1
      return
    }
  }

  console.log(`[eval] parseRequest 评测：${cases.length} 条${args.dry ? '（dry run，不调模型）' : ''}`)

  const results = []
  for (const item of cases) {
    const res = await runCase(item, { dry: args.dry, record })
    results.push(res)
    if (args.dry) {
      console.log(`  ${res.id} 组装成功，Prompt ${res.promptChars} 字`)
      continue
    }
    if (res.error) {
      console.log(`  ✗ ${res.id} ${res.error}`)
      continue
    }
    const failed = res.checks.filter(c => !c.pass)
    const flag = failed.length || res.userOnlyFilled.length ? '✗' : '✓'
    console.log(`  ${flag} ${res.id}（${res.kind}）${res.latencyMs}ms`)
    for (const c of failed) {
      console.log(`      ${c.field}：标注 ${JSON.stringify(c.expected)} → 模型 ${JSON.stringify(c.got)}`)
    }
    if (res.userOnlyFilled.length) {
      console.log(`      四类字段被填：${res.userOnlyFilled.join(', ')}  ← 这一项必须为 0`)
    }
  }

  if (args.dry) {
    console.log('[eval] dry run 结束：标注集可读、Prompt 可组装。真实评测去掉 --dry。')
    return
  }
  report(golden, results)
}

/** 三个数 + 一份可追溯的结果记录 */
const report = (golden, results) => {
  const scored = results.filter(res => !res.error)
  const totalChecks = scored.reduce((sum, res) => sum + res.checks.length, 0)
  const passedChecks = scored.reduce((sum, res) => sum + res.checks.filter(c => c.pass).length, 0)
  const userOnlyFilled = scored.reduce((sum, res) => sum + res.userOnlyFilled.length, 0)

  // 擦边输入被判无法归类是**正确**行为，和"该归类却归不出来"必须分开算
  const shouldClassify = scored.filter(res => res.kind !== 'rejected')
  const unclassified = shouldClassify.filter(res => res.unclassified).length

  const summary = {
    at: new Date().toISOString(),
    goldenVersion: golden.version,
    cases: results.length,
    failedCalls: results.length - scored.length,
    fieldAccuracy: pct(passedChecks, totalChecks),
    checked: totalChecks,
    userOnlyFilled,
    unclassifiedRate: pct(unclassified, shouldClassify.length),
    avgLatencyMs: scored.length
      ? Math.round(scored.reduce((s, r) => s + (r.latencyMs || 0), 0) / scored.length)
      : 0,
    tokens: {
      input: scored.reduce((s, r) => s + (r.inputTokens || 0), 0),
      output: scored.reduce((s, r) => s + (r.outputTokens || 0), 0)
    },
    failures: scored
      .filter(res => res.checks.some(c => !c.pass) || res.userOnlyFilled.length)
      .map(res => ({
        id: res.id,
        kind: res.kind,
        diff: res.checks.filter(c => !c.pass),
        userOnlyFilled: res.userOnlyFilled
      }))
  }

  console.log('')
  console.log(`字段抽取准确率  ${summary.fieldAccuracy}%（${passedChecks}/${totalChecks}）  目标 ≥85%`)
  console.log(`四类字段误填    ${summary.userOnlyFilled} 次  目标 0`)
  console.log(`无法归类比例    ${summary.unclassifiedRate}%（${unclassified}/${shouldClassify.length}，擦边用例不计入）`)
  console.log(`调用失败        ${summary.failedCalls} 次`)
  console.log(`平均耗时        ${summary.avgLatencyMs}ms   token 入/出 ${summary.tokens.input}/${summary.tokens.output}`)

  appendHistory(summary)
  console.log(`\n[eval] 已追加到 ${path.relative(ROOT, RESULT_FILE)}，改 Prompt 后再跑一次可直接对比。`)
}

main().catch(err => {
  console.error('[eval] 评测中断：', err && err.message)
  process.exitCode = 1
})




