/** @module polyprompt-ai/llm-client — OpenAI 兼容 chat/completions 客户端（MCP/CLI 传输层） */

import { PolyError, ERR } from './result.js'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

/**
 * 配置解析顺序：显式参数 > 环境变量 > 配置文件 ~/.polyprompt/config.json。
 * @typedef {Object} LlmConfig
 * @property {string} baseUrl   OpenAI 兼容 base（如 https://api.deepseek.com/v1）
 * @property {string} apiKey
 * @property {string} model
 * @property {number} [timeoutMs] 缺省 120000
 */

/** @returns {string} 配置文件路径 */
function configPath() {
  const home = process.env.POLYPROMPT_HOME || (process.env.HOME ?? process.env.USERPROFILE ?? '')
  return home.replace(/\/$/, '') + '/.polyprompt/config.json'
}

/**
 * 读取配置文件（宽松：不存在/坏 JSON 都返回 {}）。
 * @returns {Partial<LlmConfig>}
 */
function readConfigFile() {
  try { return /** @type {Partial<LlmConfig>} */ (require(configPath())) } catch { return {} }
}

/**
 * 收敛三处配置来源。任一必填缺失抛 BAD_ARGS（fail loud，不给默认远端）。
 * @param {Partial<LlmConfig>} [explicit]
 * @returns {LlmConfig}
 */
export function resolveLlmConfig(explicit = {}) {
  /** @type {Partial<LlmConfig>} */
  const fileCfg = readConfigFile()
  const env = process.env
  const cfg = {
    baseUrl: explicit.baseUrl ?? env.POLYPROMPT_BASE_URL ?? fileCfg.baseUrl ?? env.OPENAI_BASE_URL ?? env.OPENAI_API_BASE,
    apiKey: explicit.apiKey ?? env.POLYPROMPT_API_KEY ?? fileCfg.apiKey ?? env.OPENAI_API_KEY ?? env.DEEPSEEK_API_KEY,
    model: explicit.model ?? env.POLYPROMPT_MODEL ?? fileCfg.model ?? env.POLYPROMPT_DEFAULT_MODEL,
    // 默认超时可以更友好地报错；deepseek 等兼容端 60~120s 足够
    timeoutMs: explicit.timeoutMs ?? (env.POLYPROMPT_TIMEOUT ? Number(env.POLYPROMPT_TIMEOUT) : undefined) ?? 120000,
  }
  /** @type {string[]} */
  const missing = []
  if (!cfg.baseUrl) missing.push('baseUrl（POLYPROMPT_BASE_URL）')
  if (!cfg.apiKey) missing.push('apiKey（POLYPROMPT_API_KEY）')
  if (!cfg.model) missing.push('model（POLYPROMPT_MODEL）')
  if (missing.length > 0) {
    throw new PolyError(ERR.NO_LLM, '缺少 LLM 配置：' + missing.join('、'),
      '设置环境变量，或写入 ' + configPath() + '：{"baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","model":"deepseek-chat"}')
  }
  /** @type {LlmConfig} */
  return { timeoutMs: 120000, .../** @type {LlmConfig} */ (cfg) }
}

/**
 * 创建 LlmTransport（{ complete }）。JSON 输出协议下关闭 stream（None needed）。
 * @param {Partial<LlmConfig>} [cfgIn]
 * @returns {import('./engine.js').LlmTransport}
 */
export function createLlmClient(cfgIn) {
  const cfg = resolveLlmConfig(cfgIn)
  return {
    /**
     * @param {{system: string, user: string, maxTokens?: number, signal?: AbortSignal}} req
     */
    complete: async (req) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(new PolyError(ERR.UPSTREAM, 'LLM 请求超时', '可在配置调大 timeoutMs')), cfg.timeoutMs ?? 120000)
      if (req.signal) {
        if (req.signal.aborted) ctrl.abort()
        else req.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
      }
      try {
        const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
            max_tokens: req.maxTokens ?? 4000,
            temperature: 0.4,
            stream: false,
          }),
          signal: ctrl.signal,
        })
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '')
          throw new PolyError(ERR.UPSTREAM, 'LLM HTTP ' + res.status, bodyText.slice(0, 300) || res.statusText)
        }
        const data = await res.json()
        const text = data?.choices?.[0]?.message?.content
        if (typeof text !== 'string' || text === '') {
          throw new PolyError(ERR.UPSTREAM, 'LLM 返回为空', '检查 model 是否可访问 / 是否被内容审核拦截')
        }
        return text
      } catch (e) {
        if (e instanceof PolyError) throw e
        if (/** @type {any} */ (e)?.name === 'AbortError') {
          throw new PolyError(ERR.UPSTREAM, 'LLM 请求超时或被中止', '调大超时或检查网络')
        }
        throw new PolyError(ERR.UPSTREAM, 'LLM 请求失败：' + /** @type {Error} */ (e).message)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
