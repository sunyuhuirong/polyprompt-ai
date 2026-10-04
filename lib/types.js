/** @module polyprompt-ai/types — 共享类型与常量（JSDoc typedef，零构建） */

/** @typedef {'auto'|'code'|'writing'|'image'|'chat'} Scene */

/** 场景展示名 */
export const SCENE_LABELS = {
  auto: '自动识别', code: '代码', writing: '写作', image: '绘图', chat: '对话',
}

/** 场景关键特征词（auto 识别用，按命中加权；大小写不敏感） */
export const SCENE_HINTS = {
  code: [
    '代码', '函数', '报错', 'bug', '编译', '接口', '脚本', '重构', '测试用例', '正则',
    'sql', 'database', 'query', 'api', 'sdk', 'docker', 'git', 'python', 'typescript',
    'javascript', 'java', 'rust', 'golang', 'react', 'vue', 'css', 'html', 'algorithm',
    'debug', 'stack trace', 'exception', 'unit test', 'compile', 'deploy',
    '爬虫', '命令行', '脚本', '依赖', '环境变量', '构建', '类型定义', 'npm', 'pip',
  ],
  writing: [
    '文章', '文案', '标题', '公众号', '博客', '小红书', '推文', '邮件', '营销', 'slogan',
    '故事', '小说', '大纲', '征文', '周报', '演讲稿', 'resume', 'blog', 'article', 'tweet',
    'copywriting', 'essay', 'story outline',
  ],
  image: [
    '画', '图', '海报', '插画', '风格', '头像', 'logo', 'banner', 'icon',
    '像素风', '赛博朋克', '水彩', '吉卜力', 'midjourney', 'stable diffusion', 'dall-e',
    'flux', 'seedream', '文生图', 'photorealistic', 'illustration', 'concept art',
    'painting', 'artwork', 'render', 'poster', 'wallpaper', 'sticker', '卡通', '水墨',
    '构图', '镜头', '光影', '配色', '线稿', '上色', '扁平风', '3d 建模', 'octane',
  ],
  chat: [
    '聊', '对话', '问答', '角色', '扮演', '助手', '客服', '面试', '辅导', '翻译',
    '总结', '解释', 'roleplay', 'tutor', 'assistant persona', 'system prompt',
  ],
}

/** 高频泛词：单独出现不足以判定场景，需要与其他特征词共存才计入投票 */
export const WEAK_HINTS = new Set(['图', '文章', '总结', '解释', '风格', '助手', '聊'])

/**
 * 从目标模型名猜测场景偏好（如 dall-e/midjourney → image）。
 * @param {string|undefined} targetModel
 * @param {string|undefined} sceneParam
 * @returns {Scene} 具体场景（auto 已消解）
 */
export function resolveScene(targetModel, sceneParam) {
  if (sceneParam && sceneParam !== 'auto') return /** @type {Scene} */ (sceneParam)
  const m = (targetModel || '').toLowerCase()
  if (/(midjourney|mj|sd|stable.?diffusion|dall-?e|flux|seedream|ideogram|imagen)/.test(m)) return 'image'
  if (/(codex|claude|cursor|copilot|deepseek|gpt|qwen|kimi)/.test(m)) return 'code'
  return 'auto'
}

/** 改写强度允许值 */
export const INTENSITIES = ['light', 'medium', 'aggressive']

/**
 * 场景档案：核心指导 + 输出约定。元提示词正文在 metaprompt.js。
 * @typedef {Object} SceneProfile
 * @property {string} intro 引擎对改写者的场景总纲
 * @property {string[]} mustHave 必检要素清单（进 LLM 校准与静态诊断）
 * @property {string[]} styleGuide 风格细则
 * @property {string[]} pitfall 该场景常见踩坑（元提示词里提醒 LLM 避免）
 */

/** @type {Record<Exclude<import('./types.js').Scene,'auto'>, SceneProfile>} */
export const SCENE_PROFILES = {
  code: {
    intro: '目标是让 AI 编程助手一次做对：技术栈、边界、验收与输出形态全部可校验。',
    mustHave: ['技术栈与语言版本', '任务范围与边界（做什么/不做什么）', '现有代码上下文引用', '验收/自测标准', '约束与禁止事项'],
    styleGuide: ['命令式动词开头，一句话一个要求', '路径、类名、命令等加反引号', '长任务拆成编号步骤', '明确"不要做什么"防跑偏'],
    pitfall: ['堆砌脚本里没有的框架假设', '漏掉运行环境（Node 版本/OS）', '把多个任务塞进一个提示词'],
  },
  writing: {
    intro: '目标是让产出贴近真实传播语境：受众、调性、结构、篇幅都要落到实处。',
    mustHave: ['受众与使用场景', '核心信息与利益点', '语气与调性', '结构与篇幅约束', '必须包含/规避的元素'],
    styleGuide: ['把模糊形容换成可执行描述（"有感染力"→"至少一处用户引语"）', '篇幅给数字区间', '结构用层级词开头（开头/主体/收尾）'],
    pitfall: ['淹没核心信息', '设定互相矛盾（正式语气+网感梗）', '要求 unspecified 受众"所有人"都爱看'],
  },
  image: {
    intro: '目标是一次生成可用图：主体、风格、构图、光线、镜头、画幅俱全且不冲突。',
    mustHave: ['主体与关键细节', '视觉风格与参考', '构图与镜头（视角/景别）', '光线与氛围', '画幅与画质参数', '负面提示词'],
    styleGuide: ['主体优先、从主到次描述', '风格词具体化（"好看"→"吉卜力式水彩"）', '相机语言给专业词（35mm/俯视/浅景深）', '与 Midjourney/SD 等目标语法对齐'],
    pitfall: ['主体与场景比例失衡', '风格互相打架（赛博朋克+田园治愈）', '塞超过画面容量的元素', '负面词误伤主体'],
  },
  chat: {
    intro: '目标是让对话助手人设稳定、边界清楚、回复格式可预期。',
    mustHave: ['角色设定与专业领域', '知识边界与最新性要求', '回复结构/长度约定', '澄清策略（何时反问）', '禁止事项'],
    styleGuide: ['第二人称描述助手自己', '行为规则用"当…则…"句式', '敏感话题给处理原则'],
    pitfall: ['人设自相矛盾', '要求不存在的实时知识却不给兜底', '没有定义拒答边界'],
  },
}
