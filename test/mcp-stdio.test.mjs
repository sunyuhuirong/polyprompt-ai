/** MCP stdio 协议级测试：initialize → tools/list → tools/call 坏输入 */
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function line(/** @type {any} */ buf) { return JSON.stringify(buf) + '\n' }

test('mcp stdio: initialize + list tools + bad-args call', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'lib/mcp.js')], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env },
  })
  child.on('error', (e) => { throw e })
  /** @type {Buffer} */
  let out = Buffer.alloc(0)
  child.stdout.on('data', (d) => { out = Buffer.concat([out, d]) })

  // initialize
  child.stdin.write(line({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.1' },
  }}))
  // initialized notification
  child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }))
  // tools/list
  child.stdin.write(line({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  // tools/call with empty text (engine should fail loud, not hang)
  child.stdin.write(line({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'optimize_prompt', arguments: { text: ' ' },
  }}))

  // 等 3 个 id 都应答（超时保护）
  const deadline = Date.now() + 8000
  const seen = new Set()
  while (seen.size < 3 && Date.now() < deadline) {
    await once(child.stdout, 'readable', { signal: AbortSignal.timeout(8200) }).catch(() => {})
    const text = out.toString('utf8')
    for (const m of text.matchAll(/"id":(\d+)/g)) seen.add(Number(m[1]))
    if (text.includes('"id":3') && text.includes('error') || text.includes('BAD_ARGS')) seen.add(3)
  }

  const text = out.toString('utf8')
  assert.ok(text.includes('"serverInfo"'), 'initialize 应答，got: ' + text.slice(0, 200))
  assert.ok(text.includes('optimize_prompt') && text.includes('diagnose_prompt'), 'tools/list 应答')
  assert.ok(text.includes('BAD_ARGS') || text.includes('isError'), 'tools/call 空输入必须明确报错')

  child.kill('SIGTERM')
})

test('mcp via cli 分发: polyprompt mcp 同样可握手', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'lib/cli.js'), 'mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = Buffer.alloc(0)
  child.stdout.on('data', (d) => { out = Buffer.concat([out, d]) })
  child.stdin.write(line({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' },
  }}))
  child.stdin.write(line({ jsonrpc: '2.0', method: 'notifications/initialized' }))
  child.stdin.write(line({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  const deadline = Date.now() + 8000
  while (!out.toString('utf8').includes('"id":2') && Date.now() < deadline) {
    await once(child.stdout, 'readable').catch(() => {})
  }
  assert.ok(out.toString('utf8').includes('optimize_prompt'), '应答 tools/list: ' + out.toString('utf8').slice(0, 200))
  child.kill('SIGTERM')
})
