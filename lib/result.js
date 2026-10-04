/** @module polyprompt-ai/result — 统一结果/错误封装（三入口共用） */

/** 错误代码 */
export const ERR = {
  NO_LLM: 'NO_LLM',            // 没有任何可用模型
  BAD_ARGS: 'BAD_ARGS',        // 参数校验失败
  UPSTREAM: 'UPSTREAM',        // 上游模型调用失败
  BAD_OUTPUT: 'BAD_OUTPUT',    // 模型输出不符合协议（无法解析 JSON）
}

/** PolyPrompt 业务错误。code ∈ ERR；hint 给出排查建议。 */
export class PolyError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string} [hint]
   */
  constructor(code, message, hint) {
    super(message)
    this.name = 'PolyError'
    this.code = code
    this.hint = hint
  }
}

/**
 * @param {unknown} e
 * @returns {e is import('./result.js').PolyError}
 */
export function isPolyError(e) { return e instanceof PolyError }

/**
 * @typedef {Object} OptimizeNote
 * @property {string} change
 * @property {string} why
 *
 * @typedef {Object} OptimizeResult
 * @property {import('./types.js').Scene} scene 实际使用的场景
 * @property {string} optimized 优化后的提示词
 * @property {OptimizeNote[]} notes 改动说明
 * @property {Record<string,string>} coverage 要素覆盖情况
 * @property {string} language 输出语言
 * @property {string} [model] 实际使用的模型标识
 *
 * @typedef {Object} DiagnoseResult
 * @property {import('./types.js').Scene} scene
 * @property {number} score
 * @property {Array<{severity:'high'|'mid'|'low', issue:string, suggestion:string}>} problems
 * @property {Record<string,string>} coverage
 */

/** 空结果占位，便于入口提前返回 */
export const EMPTY_NOTE = /** @type {import('./result.js').OptimizeNote[]} */ ([])
