/**
 * polyprompt-ai — DSH host half（数据路由）
 *
 *   POST /api/polyprompt  { text, scene?, intensity?, lang?, target_model?, context?, mode? }
 *     -> optimize: { ok:true, scene, optimized, notes, coverage, language, model }
 *     -> diagnose: { ok:true, scene, score, problems, coverage }
 *     -> error:    { error, code, hint? }
 *
 * 复用与 MCP/CLI 完全一致的引擎（./engine.js），宿主侧只提供 LLM 传输适配。
 * 只传 JSON 标量过线——不序列化运行时对象。
 */
import { optimize, diagnose, sceneLabel } from './engine.js'
import { PolyError, ERR } from './result.js'

export const name = 'polyprompt-ai'

export const inject = ['webServer', 'llm', 'agentDefaultModel']

/** @param {any} res @param {number} status @param {unknown} body */
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 把 ctx.llm.stream + 当前模型选择适配成引擎的 LlmTransport。
 * @param {any} llm @param {any} sel
 */
function dshTransport(llm, sel) {
  return {
    /** @param {{system: string, user: string, maxTokens?: number}} req */
    complete: async (req) => {
      let seq = 0
      const messages = [{
        id: 'polyprompt-user-' + Date.now() + '-' + (++seq),
        role: 'user',
        content: [{ type: 'text', text: req.user }],
        source: { kind: 'user' },
      }]
      /** @type {Record<string, unknown>} */
      const options = {
        provider: sel.provider,
        model: sel.model,
        messages,
        system: req.system,
        maxTokens: req.maxTokens ?? 4000,
      }
      if (typeof sel.reasoningEffort === 'string') options.reasoningEffort = sel.reasoningEffort
      let out = ''
      let finishKind = 'stop'
      let finishMessage = ''
      for await (const chunk of llm.stream(options)) {
        if (chunk.type === 'text-delta') {
          out += chunk.text
        } else if (chunk.type === 'finish' && chunk.reason) {
          finishKind = chunk.reason.kind
          if (chunk.reason.failure && typeof chunk.reason.failure.message === 'string') {
            finishMessage = chunk.reason.failure.message
          }
        }
      }
      if (finishKind !== 'stop') {
        throw new PolyError(ERR.UPSTREAM, finishMessage !== '' ? finishMessage : ('模型调用结束：' + finishKind))
      }
      return out
    },
  }
}

/** 注册数据路由；关键依赖缺失时静默跳过（优化按钮是增强能力，不阻塞宿主）。 */
export function apply(/** @type {any} */ ctx) {
  const webServer = ctx.webServer
  const llm = ctx.llm
  const defaultModel = ctx.agentDefaultModel
  if (webServer === undefined || llm === undefined) return

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/polyprompt',
    handler: async (/** @type {any} */ req, /** @type {any} */ res) => {
      try {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed', code: ERR.BAD_ARGS })
          return
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        let payload
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          writeJson(res, 400, { error: 'invalid JSON', code: ERR.BAD_ARGS })
          return
        }
        const text = payload && typeof payload.text === 'string' ? payload.text : ''
        if (text.trim() === '') {
          writeJson(res, 400, { error: '提示词不能为空', code: ERR.BAD_ARGS })
          return
        }
        const sel = defaultModel !== undefined ? defaultModel.currentSelection() : undefined
        if (!sel || typeof sel.provider !== 'string' || typeof sel.model !== 'string') {
          writeJson(res, 503, { error: '当前没有可用的默认模型，请先在界面选择模型', code: ERR.NO_LLM })
          return
        }
        const llmTransport = dshTransport(llm, sel)
        const mode = payload && payload.mode === 'diagnose' ? 'diagnose' : 'optimize'
        const opts = {
          scene: typeof payload.scene === 'string' ? payload.scene : 'auto',
          intensity: typeof payload.intensity === 'string' ? payload.intensity : 'medium',
          lang: typeof payload.lang === 'string' ? payload.lang : 'auto',
          targetModel: typeof payload.target_model === 'string' ? payload.target_model : undefined,
          context: typeof payload.context === 'string' ? payload.context : undefined,
        }
        if (mode === 'diagnose') {
          const d = await diagnose(llmTransport, text, opts)
          writeJson(res, 200, { ok: true, mode, ...d, sceneLabel: sceneLabel(d.scene) })
          return
        }
        const r = await optimize(llmTransport, text, opts)
        writeJson(res, 200, { ok: true, mode, scene: r.scene, sceneLabel: sceneLabel(r.scene), optimized: r.optimized, notes: r.notes, coverage: r.coverage, language: r.language, model: sel.model })
      } catch (e) {
        if (e instanceof PolyError) {
          const status = e.code === ERR.BAD_ARGS ? 400 : 502
          writeJson(res, status, { error: e.message, code: e.code, hint: e.hint })
        } else {
          writeJson(res, 500, { error: e instanceof Error ? e.message : String(e), code: 'INTERNAL' })
        }
      }
    },
  }))
}
