/**
 * polyprompt-ai/ui — MCP 资源：元提示词全文与场景档案（供模型/客户端按需读取）
 * 目前轻实现：仅返回场景档案 JSON；元提示词不外发（内部资产）。
 */
import { SCENE_PROFILES, SCENE_LABELS, SCENE_HINTS } from './types.js'

/** @returns {string} 所有场景要素清单的 JSON 文本 */
export function scenesJson() {
  return JSON.stringify(Object.fromEntries(
    Object.entries(SCENE_PROFILES).map(([/** @type {string} */ k, /** @type {any} */ v]) => [k, { label: /** @type {Record<string,string>} */ (SCENE_LABELS)[k], mustHave: v.mustHave, styleGuide: v.styleGuide, pitfall: v.pitfall }]),
  ), null, 2)
}

/** 触发词表（调试用） */
export function sceneHintsJson() { return JSON.stringify(SCENE_HINTS, null, 2) }
