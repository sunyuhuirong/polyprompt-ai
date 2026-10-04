/** @module polyprompt-ai/engine — 优化核心编排（识别 → 改写 → 校验），与传输入口解耦 */

import { SCENE_HINTS, WEAK_HINTS, resolveScene, INTENSITIES } from './types.js'
import { rewriteSystem, rewriteUser, diagnoseSystem, sceneLabel } from './metaprompt.js'
import { PolyError, ERR } from './result.js'

/**
 * LLM 传输抽象：三入口各提供一个实现。
 * @typedef {Object} LlmTransport
 * @property {(req: {system: string, user: string, maxTokens?: number, signal?: AbortSignal}) => Promise<string>} complete
 *   返回模型原始文本输出。
 */

/** @param {string} s */
function stripFence(s) {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return m ? m[1] : t
}

/**
 * 从模型输出中稳健提取 JSON 对象（协议要求只输出 JSON，但部分模型会带前缀）。
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
export function extractJson(raw) {
  const text = stripFence(String(raw || ''))
  // 优先整体解析
  try { return JSON.parse(text) } catch { /* 继续截取 */ }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch { /* fallthrough */ }
  }
  throw new PolyError(ERR.BAD_OUTPUT, '模型输出不是合法 JSON', '可重试，或在配置里换一个遵循指令更稳定的模型')
}

const SCENES = ['code', 'writing', 'image', 'chat']
/** @param {string} s */
function asScene(s) { return SCENES.includes(s) ? /** @type {import('./types.js').Scene} */ (s) : undefined }
/** @param {string} s */
function asLang(s) { return s === 'zh' || s === 'en' ? s : undefined }

/**
 * 自动场景识别：关键词加权投票，平票时按顺序回落。
 * @param {string} text
 * @returns {import('./types.js').Scene}
 */
export function detectScene(text) {
  const t = text.toLowerCase()
  /** @type {import('./types.js').Scene} */ let best = 'chat'
  let bestScore = 0
  for (const scene of SCENES) {
    let score = 0
    let strong = 0
    for (const kw of /** @type {string[]} */ (SCENE_HINTS[/** @type {keyof typeof SCENE_HINTS} */ (scene)])) {
      if (!t.includes(kw)) continue
      strong += WEAK_HINTS.has(kw) ? 0 : 1
      score += kw.length >= 4 ? 2 : 1
    }
    // 只有泛词命中、没有强特征的场景不参与胜出（避免"画/文章"级噪声误判）
    if (strong === 0) score = 0
    if (score > bestScore) { best = /** @type {import('./types.js').Scene} */ (scene); bestScore = score }
  }
  return best
}

/**
 * 协议校验 + 归一化为 OptimizeResult（fail loud）。
 * @param {Record<string, unknown>} obj
 * @param {import('./types.js').Scene} scene
 * @param {string} [model]
 * @returns {import('./result.js').OptimizeResult}
 */
export function normalizeOptimize(obj, scene, model) {
  const optimized = typeof obj.optimized === 'string' ? obj.optimized.trim() : ''
  if (optimized === '') {
    throw new PolyError(ERR.BAD_OUTPUT, '模型未返回优化后的提示词（optimized 字段缺失或为空）',
      'increase maxTokens 或换模型重试')
  }
  /** @type {import('./result.js').OptimizeNote[]} */
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter((n) => n && typeof n === 'object')
        .slice(0, 6)
        .map((n) => ({ change: String(n.change ?? ''), why: String(n.why ?? '') }))
        .filter((n) => n.change !== '')
    : []
  /** @type {Record<string,string>} */ const coverage = {}
  if (obj.coverage && typeof obj.coverage === 'object') {
    for (const [k, v] of Object.entries(obj.coverage)) coverage[String(k)] = String(v)
  }
  return {
    scene: asScene(String(obj.scene ?? '')) ?? scene,
    optimized,
    notes,
    coverage,
    language: asLang(String(obj.language ?? '')) ?? 'auto',
    ...(model !== undefined ? { model } : {}),
  }
}

/**
 * 协议校验 + 归一化为 DiagnoseResult。
 * @param {Record<string, unknown>} obj
 * @param {import('./types.js').Scene} scene
 * @returns {import('./result.js').DiagnoseResult}
 */
export function normalizeDiagnose(obj, scene) {
  const problems = Array.isArray(obj.problems)
    ? obj.problems.filter((p) => p && typeof p === 'object' && typeof p.issue === 'string').slice(0, 8)
        .map((p) => ({
          severity: p.severity === 'high' || p.severity === 'low' ? p.severity : 'mid',
          issue: String(p.issue),
          suggestion: String(p.suggestion ?? ''),
        }))
    : []
  const score = typeof obj.score === 'number' && obj.score >= 0 && obj.score <= 100
    ? Math.round(obj.score) : 50
  /** @type {Record<string,string>} */ const coverage = {}
  if (obj.coverage && typeof obj.coverage === 'object') {
    for (const [k, v] of Object.entries(obj.coverage)) coverage[String(k)] = String(v)
  }
  return { scene: asScene(String(obj.scene ?? '')) ?? scene, score, problems, coverage }
}

/**
 * 优化选项（三入口一致）。
 * @typedef {Object} OptimizeOptions
 * @property {import('./types.js').Scene} [scene] 缺省 auto
 * @property {'light'|'medium'|'aggressive'} [intensity] 缺省 medium
 * @property {'auto'|'zh'|'en'} [lang] 缺省 auto（跟随输入）
 * @property {string} [targetModel] 目标模型名（影响措辞与场景偏好）
 * @property {string} [context] 补充背景
 * @property {number} [maxTokens] 缺省 4000
 */

/**
 * 核心：优化一条提示词。
 * @param {LlmTransport} llm
 * @param {string} text
 * @param {OptimizeOptions} [opts]
 * @returns {Promise<import('./result.js').OptimizeResult>}
 */
export async function optimize(llm, text, opts = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new PolyError(ERR.BAD_ARGS, '提示词不能为空', '传入要优化的原始提示词文本')
  }
  const sceneParam = opts.scene ?? 'auto'
  const scene = sceneParam === 'auto' ? detectScene(text) : sceneParam
  const intensity = INTENSITIES.includes(/** @type {any} */ (opts.intensity)) ? /** @type {'light'|'medium'|'aggressive'} */ (opts.intensity) : 'medium'
  const lang = opts.lang ?? 'auto'
  const system = rewriteSystem(scene, { targetModel: opts.targetModel, lang, intensity })
  const user = rewriteUser(text, opts.context)
  const raw = await llm.complete({ system, user, maxTokens: opts.maxTokens ?? 4000 })
  const obj = extractJson(raw)
  return normalizeOptimize(obj, scene, opts.targetModel)
}

/**
 * 诊断一条提示词（只分析不改写）。
 * @param {LlmTransport} llm
 * @param {string} text
 * @param {OptimizeOptions} [opts]
 * @returns {Promise<import('./result.js').DiagnoseResult>}
 */
export async function diagnose(llm, text, opts = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new PolyError(ERR.BAD_ARGS, '提示词不能为空', '传入要分析的原始提示词文本')
  }
  const sceneParam = opts.scene ?? 'auto'
  const scene = sceneParam === 'auto' ? detectScene(text) : sceneParam
  const raw = await llm.complete({
    system: diagnoseSystem(scene), user: rewriteUser(text, opts.context), maxTokens: 2000,
  })
  return normalizeDiagnose(extractJson(raw), scene)
}

export { sceneLabel }
