/**
 * 模型客户端（M2-04）。**只讲 OpenAI 兼容的 /chat/completions 协议**，不认任何厂商私有格式。
 *
 * 为什么这么定：DeepSeek 官方接口、阿里云百炼的兼容模式、公司内部的 OneAPI 网关，
 * 三者都提供 OpenAI 兼容端点。把"厂商"降级成三个环境变量（base_url / key / model），
 * 换供应商就只是改环境变量，代码一行不动 —— 这比给每家写一个 adapter 划算得多。
 *
 * 用 `https` 原生模块而不是 axios / node-fetch：云函数运行时是 Node v16.13.1，
 * 没有全局 `fetch`，而装一个 HTTP 库只为发一个 POST，不符合"能力够用不引组件"。
 *
 * 环境变量（名字见 `.env.example`，值只写进**云函数环境变量**，绝不进仓库）：
 *   AI_PRIMARY_BASE_URL / AI_PRIMARY_API_KEY / AI_PRIMARY_MODEL   便宜档
 *   AI_LONG_BASE_URL   / AI_LONG_API_KEY   / AI_LONG_MODEL        长输出档（缺省回落到便宜档）
 *   AI_JSON_MODE=off   供应商不认 response_format 时的关闭开关（默认开）
 */

const https = require('https')
const http = require('http')
const { URL } = require('url')

const { MODEL_TIER } = require('../ai/registry')

/** 模型调用的错误码。全部是"可降级"的错，网关据此决定重试还是走降级 */
const MODEL_ERROR = Object.freeze({
  NOT_CONFIGURED: 'MODEL_NOT_CONFIGURED',
  TIMEOUT: 'MODEL_TIMEOUT',
  HTTP_ERROR: 'MODEL_HTTP_ERROR',
  NETWORK_ERROR: 'MODEL_NETWORK_ERROR',
  BAD_RESPONSE: 'MODEL_BAD_RESPONSE'
})

const ENV_KEYS = Object.freeze({
  [MODEL_TIER.CHEAP]: { base: 'AI_PRIMARY_BASE_URL', key: 'AI_PRIMARY_API_KEY', model: 'AI_PRIMARY_MODEL' },
  [MODEL_TIER.LONG_OUTPUT]: { base: 'AI_LONG_BASE_URL', key: 'AI_LONG_API_KEY', model: 'AI_LONG_MODEL' }
})

/**
 * 额外请求体参数（JSON 字符串）的环境变量名。
 *
 * 为什么留这个口子：各家都有自己的开关（DeepSeek 的思考模式、某些网关要求的 `stream: false`），
 * 这些开关既不属于 OpenAI 标准协议、也会随厂商文档变。写死在代码里意味着换供应商就要改代码，
 * 而这恰恰是 modelClient 想避免的。所以给一个**逃生口**：填什么由环境变量决定，代码不认识它们。
 * 解析失败只告警不阻断 —— 一个填错的 JSON 不该让整条能力不可用。
 */
const EXTRA_BODY_ENV = Object.freeze({
  [MODEL_TIER.CHEAP]: 'AI_PRIMARY_EXTRA_BODY',
  [MODEL_TIER.LONG_OUTPUT]: 'AI_LONG_EXTRA_BODY'
})

const modelError = (code, message) => {
  const err = new Error(message)
  err.code = code
  return err
}

/**
 * 解析某档位的配置。长输出档没单独配就回落到便宜档 ——
 * 少配一个变量就整条能力不可用，不如回落并在日志里说明。
 */
const resolveConfig = modelTier => {
  const keys = ENV_KEYS[modelTier] || ENV_KEYS[MODEL_TIER.CHEAP]
  const fallback = ENV_KEYS[MODEL_TIER.CHEAP]
  const pick = field => process.env[keys[field]] || process.env[fallback[field]] || ''
  const config = { baseUrl: pick('base'), apiKey: pick('key'), model: pick('model') }
  const missing = Object.keys(config).filter(field => !config[field])
  if (missing.length) {
    throw modelError(
      MODEL_ERROR.NOT_CONFIGURED,
      `模型档位 ${modelTier} 缺少环境变量：${missing.join(', ')}`
    )
  }
  return config
}

const jsonModeEnabled = () => String(process.env.AI_JSON_MODE || '').toLowerCase() !== 'off'

/** 读并解析额外请求体参数；没配或填错都返回空对象 */
const extraBodyOf = modelTier => {
  const name = EXTRA_BODY_ENV[modelTier] || EXTRA_BODY_ENV[MODEL_TIER.CHEAP]
  const raw = process.env[name] || process.env[EXTRA_BODY_ENV[MODEL_TIER.CHEAP]] || ''
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    console.error(`[modelClient] ${name} 不是合法 JSON，已忽略：${raw.slice(0, 120)}`)
    return {}
  }
}

/** 拼出 /chat/completions 的完整地址，容忍 base_url 带不带尾斜杠、带不带 /v1 */
const completionsUrl = baseUrl => {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

/** 发一个带超时的 POST。超时要**主动 destroy**，否则云函数会被挂到实例回收才结束 */
const postJson = ({ url, headers, body, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const target = new URL(url)
    const agent = target.protocol === 'http:' ? http : https
    const payload = JSON.stringify(body)
    const req = agent.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          headers
        )
      },
      res => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          raw += chunk
        })
        res.on('end', () => resolve({ statusCode: res.statusCode, raw }))
      }
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(modelError(MODEL_ERROR.TIMEOUT, `模型调用超过 ${timeoutMs}ms`))
    })
    req.on('error', err => {
      reject(err.code ? err : modelError(MODEL_ERROR.NETWORK_ERROR, String(err && err.message)))
    })
    req.end(payload)
  })

/**
 * 调一次模型。**只发一次，不在这里重试** —— 重试与降级是网关的编排职责（tech-stack 6.1 第 5~7 步），
 * 客户端偷偷重试会让日志里的耗时与 token 统计都失真。
 *
 * @returns {{text: string, inputTokens: number, outputTokens: number, latencyMs: number, model: string}}
 */
const chat = async ({ modelTier = MODEL_TIER.CHEAP, prompt, timeoutMs = 8000, jsonMode = true, temperature = 0.2 }) => {
  const { baseUrl, apiKey, model } = resolveConfig(modelTier)
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature
  }
  if (jsonMode && jsonModeEnabled()) {
    body.response_format = { type: 'json_object' }
  }
  // 厂商专有开关最后合并，允许它覆盖上面的默认值（比如某家不认 response_format 要换写法）
  Object.assign(body, extraBodyOf(modelTier))

  const startedAt = Date.now()
  const { statusCode, raw } = await postJson({
    url: completionsUrl(baseUrl),
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    timeoutMs
  })
  const latencyMs = Date.now() - startedAt

  if (statusCode < 200 || statusCode >= 300) {
    throw modelError(
      MODEL_ERROR.HTTP_ERROR,
      `模型返回 HTTP ${statusCode}：${String(raw).slice(0, 300)}`
    )
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw modelError(MODEL_ERROR.BAD_RESPONSE, `模型响应不是 JSON：${String(raw).slice(0, 300)}`)
  }

  const text = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
    ? parsed.choices[0].message.content
    : ''
  if (!text) {
    throw modelError(MODEL_ERROR.BAD_RESPONSE, `模型响应里没有内容：${String(raw).slice(0, 300)}`)
  }

  const usage = parsed.usage || {}
  return {
    text,
    // token 数缺失时记 0 而不是猜：算错的成本比不算更误导
    inputTokens: Number(usage.prompt_tokens || 0),
    outputTokens: Number(usage.completion_tokens || 0),
    latencyMs,
    model
  }
}

module.exports = {
  MODEL_ERROR,
  resolveConfig,
  jsonModeEnabled,
  extraBodyOf,
  chat
}
