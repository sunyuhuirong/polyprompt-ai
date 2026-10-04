#!/usr/bin/env node
/** 质量门：语法检查 + 引擎回归 + ESM 导入完整性 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['lib/index.js', 'lib/client.js', 'lib/engine.js', 'lib/llm-client.js', 'lib/metaprompt.js', 'lib/mcp.js', 'lib/cli.js', 'lib/result.js', 'lib/types.js', 'lib/ui.js']
let bad = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' })
  if (r.status !== 0) { console.error('SYNTAX FAIL', f, '\n', r.stderr); bad++ }
}
if (bad > 0) process.exit(1)
console.log('syntax OK (' + files.length + ' files)')
