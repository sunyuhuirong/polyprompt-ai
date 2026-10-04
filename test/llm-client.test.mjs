/** llm-client 测试：配置解析优先级 / fail loud / fetch 出错路径 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLlmConfig, createLlmClient } from '../lib/llm-client.js'
import { PolyError } from '../lib/result.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('配置缺省 fail loud 且提示三个键', () => {
  const saved = { ...process.env }
  for (const k of ['POLYPROMPT_BASE_URL','POLYPROMPT_API_KEY','POLYPROMPT_MODEL','OPENAI_BASE_URL','OPENAI_API_BASE','OPENAI_API_KEY','DEEPSEEK_API_KEY']) delete process.env[k]
  process.env.POLYPROMPT_HOME = mkdtempSync(join(tmpdir(), 'polyprompt-test-')) // 隔离真实 ~/.polyprompt
  try {
    assert.throws(() => resolveLlmConfig(), (e) => e instanceof PolyError && e.code === 'NO_LLM' && e.message.includes('baseUrl'))
  } finally { process.env = saved }
})

test('显式参数 > 环境变量', () => {
  process.env.POLYPROMPT_MODEL = 'env-model'
  const c = resolveLlmConfig({ baseUrl: 'https://a/v1', apiKey: 'k', model: 'explicit' })
  assert.equal(c.model, 'explicit')
  const c2 = resolveLlmConfig({ baseUrl: 'https://a/v1', apiKey: 'k' })
  assert.equal(c2.model, 'env-model')
  delete process.env.POLYPROMPT_MODEL
})

test('transport 对非法 baseUrl fail loud（fetch 层错误转 PolyError.UPSTREAM）', async () => {
  const llm = createLlmClient({ baseUrl: 'not-a-url', apiKey: 'k', model: 'm', timeoutMs: 3000 })
  await assert.rejects(llm.complete({ system: 's', user: 'u' }), (e) => e instanceof PolyError && e.code === 'UPSTREAM')
})
