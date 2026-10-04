/** @module polyprompt-ai/metaprompt — 四场景元提示词组装（纯函数） */
import { SCENE_PROFILES, SCENE_LABELS } from './types.js'

/**
 * 全局改写身份与规则（任何场景共用）。
 * @param {import('./types.js').Scene} scene
 * @param {{targetModel?: string, lang: 'auto'|'zh'|'en', intensity: 'light'|'medium'|'aggressive'}} o
 */
function globalRules(scene, o) {
  const langLine = o.lang === 'zh' ? '输出提示词必须使用简体中文'
    : o.lang === 'en' ? '输出提示词必须使用英文'
    : '输出语言与用户原文一致'
  const intensityLine = /** @type {Record<string,string>} */ ({
    light: '轻度打磨：只修语句不通、歧义与格式，不增删语义，要素基本齐全时可不动结构。',
    medium: '标准优化：补全缺失要素、理顺结构，但不引入原文没有的新任务或新设定。',
    aggressive: '深度重写：允许重组结构和显著扩写，可补充该领域的通用合理细节，但不得歪曲原始意图。',
  })[o.intensity]
  return [
    '你是资深提示词工程师，任务是把用户输入改写为高质量的 ' + scene + ' 提示词。',
    SCENE_PROFILES[/** @type {Exclude<import('./types.js').Scene,'auto'>} */ (scene)].intro,
    '硬性规则：',
    '1. 忠实原文：保留核心意图与全部任务要求，禁止增加新任务、删除已有要求。',
    '2. ' + langLine + '；专有名词、代码、路径与命令保持原样不翻译。',
    '3. 强度：' + intensityLine,
    o.targetModel ? '4. 目标模型：结果将提供给 ' + o.targetModel + ' 使用，措辞与参数习惯需与它对齐。' :
      '4. 结果将提供给通用大模型使用。',
    '5. 只输出一个 JSON 对象，不要输出任何解释性文字或代码围栏。',
  ]
}

/**
 * 组装改写元提示词（system 部分）。
 * @param {import('./types.js').Scene} scene 消解后的具体场景
 * @param {{targetModel?: string, lang: 'auto'|'zh'|'en', intensity: 'light'|'medium'|'aggressive'}} o
 * @returns {string}
 */
export function rewriteSystem(/** @type {import('./types.js').Scene} */ scene, /** @type {{targetModel?: string, lang: 'auto'|'zh'|'en', intensity: 'light'|'medium'|'aggressive'}} */ o) {
  const p = SCENE_PROFILES[/** @type {Exclude<import('./types.js').Scene,'auto'>} */ (scene)]
  return [
    ...globalRules(scene, o),
    '',
    '本场景要素清单（优化后提示词应当覆盖其中用户任务相关的项）：',
    ...p.mustHave.map((/** @type {string} */ x, /** @type {number} */ i) => (i + 1) + '. ' + x),
    '风格细则：' + p.styleGuide.join('；') + '。',
    '避免踩坑：' + p.pitfall.join('；') + '。',
    '',
    '输出 JSON 格式（字段必须齐全）：',
    '{"scene":"代码|写作|绘图|对话","optimized":"优化后的提示词全文","notes":[{"change":"做了什么","why":"为什么改"}],"coverage":{"要素名":"missing|kept|improved"},"language":"提示词语言代码"}',
    'notes 最多 6 条、每条不超过 40 字；optimized 为唯一改写结果，不要给多个版本。',
  ].join('\n')
}

/**
 * 组装用户消息（原文 + 可选补充背景）。
 * @param {string} text 原始提示词
 * @param {string|undefined} context 用户补充的背景
 */
export function rewriteUser(/** @type {string} */ text, /** @type {string|undefined} */ context) {
  const lines = ['【用户输入】', text]
  if (context && context.trim() !== '') lines.push('', '【补充背景】', context.trim())
  return lines.join('\n')
}

/**
 * 组装诊断元提示词（对已有提示词只分析不改写）。
 * @param {import('./types.js').Scene} scene
 */
export function diagnoseSystem(/** @type {import('./types.js').Scene} */ scene) {
  const p = SCENE_PROFILES[/** @type {Exclude<import('./types.js').Scene,'auto'>} */ (scene)]
  return [
    '你是提示词评审专家。只分析不改写，找出用户输入作为 ' + scene + ' 提示词的问题。',
    '要素清单：' + p.mustHave.join('；') + '。',
    '常见问题：' + p.pitfall.join('；') + '。',
    '只输出 JSON：{"scene":"","score":0-100,"problems":[{"severity":"high|mid|low","issue":"","suggestion":""}],"coverage":{"要素名":"missing|kept"}}',
    'problems 最多 8 条，按严重程度排序。',
  ].join('\n')
}

/** @param {import('./types.js').Scene} scene @returns {string} 人类可读的场景名 */
export function sceneLabel(scene) { return SCENE_LABELS[scene] || scene }
