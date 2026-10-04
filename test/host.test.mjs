/** DSH host 半测试：无依赖模拟 cordis ctx + mock llm，验证 /api/polyprompt 各分支 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimize } from '../lib/engine.js'

/** 极简 cordis ctx 与 webServer 模拟 */
function makeCtx(/** @type {any} */ llmSelection) {
  /** @type {Record<string, any>} */
  const routes = {}
  const ctx = {
    webServer: { register: (/** @type {any} */ r) => { routes[r.path] = r.handler } },
    llm: { stream: llmSelection.streamImpl },
    agentDefaultModel: llmSelection.selection ? { currentSelection: () => llmSelection.selection } : undefined,
    effect: (/** @type {any} */ f) => f(),
  }
  return { ctx, routes }
}

function mockStream(/** @type {string} */ reply) {
  return async function* () { yield { type: 'text-delta', text: reply }; yield { type: 'finish', reason: { kind: 'stop' } } }
}

const GOOD = JSON.stringify({ scene: 'code', optimized: 'O2', notes: [], coverage: {}, language: 'zh' })

function mockRes() {
  const res = /** @type {any} */ ({
    statusCode: 0, body: '',
    writeHead: (/** @type {number} */ status, /** @type {any} */ _h) => { res.statusCode = status },
    end: (/** @type {any} */ b) => { res.body = b },
  })
  return res
}

function mockReq(/** @type {string} */ json) {
  const chunks = [Buffer.from(json)]
  return { method: 'POST', async *[Symbol.asyncIterator]() { for (const c of chunks) yield c } }
}

test('host: 无 llm/webServer 时静默跳过注册', async () => {
  const mod = await import('../lib/index.js')
  const made = makeCtx({})
  const ctx = made.ctx
  ;(/** @type {any} */ (ctx)).webServer = undefined
  mod.apply(ctx)
  assert.ok(!('/api/polyprompt' in made.routes))
})

test('host: optimize 全链路（payload -> 引擎 -> JSON 应答）', async () => {
  const mod = await import('../lib/index.js')
  const { ctx, routes } = makeCtx({
    streamImpl: mockStream(GOOD),
    selection: { provider: 'deepseek', model: 'chat-v3' },
  })
  mod.apply(ctx)
  const handler = routes['/api/polyprompt']
  assert.ok(handler)
  const res = mockRes()
  await handler(mockReq(JSON.stringify({ text: '帮我写个爬虫' })), res)
  const out = JSON.parse(res.body)
  assert.equal(res.statusCode, 200)
  assert.equal(out.ok, true)
  assert.equal(out.optimized, 'O2')
  assert.equal(out.model, 'chat-v3')
  assert.equal(out.sceneLabel, '代码')
})

test('host: 空文本 / 坏 JSON / 无模型选择 都 fail loud', async () => {
  const mod = await import('../lib/index.js')
  const { ctx, routes } = makeCtx({ streamImpl: mockStream(GOOD), selection: null })
  mod.apply(ctx)
  const handler = routes['/api/polyprompt']
  let res = mockRes(); await handler(mockReq('{"text":"  "}'), res)
  assert.equal(res.statusCode, 400)
  res = mockRes(); await handler(mockReq('{oops'), res)
  assert.equal(res.statusCode, 400)
  res = mockRes(); await handler(mockReq('{"text":"x"}'), res)
  assert.equal(res.statusCode, 503)
  res = mockRes(); await handler(mockReq('{"text":"x"}'), res)
  assert.equal(JSON.parse(res.body).code, 'NO_LLM')
})

test('host: diagnose 模式透传', async () => {
  const mod = await import('../lib/index.js')
  const { ctx, routes } = makeCtx({
    streamImpl: mockStream('{"score":40,"problems":[]}'),
    selection: { provider: 'p', model: 'm' },
  })
  mod.apply(ctx)
  const res = mockRes()
  await routes['/api/polyprompt'](mockReq('{"text":"x","mode":"diagnose"}'), res)
  const out = JSON.parse(res.body)
  assert.equal(out.mode, 'diagnose'); assert.equal(out.score, 40)
})

test('host: finish 非 stop 视为失败', async () => {
  const mod = await import('../lib/index.js')
  async function* bad() { yield { type: 'text-delta', text: '{"s' }; yield { type: 'finish', reason: { kind: 'error', failure: { message: 'quota exceeded' } } } }
  const { ctx, routes } = makeCtx({ streamImpl: bad, selection: { provider: 'p', model: 'm' } })
  mod.apply(ctx)
  const res = mockRes()
  await routes['/api/polyprompt'](mockReq('{"text":"x"}'), res)
  assert.equal(res.statusCode, 502)
  assert.equal(JSON.parse(res.body).code, 'UPSTREAM')
})
