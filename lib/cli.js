#!/usr/bin/env node
/** @module polyprompt-ai/cli — 命令行入口：polyprompt optimize|diagnose|config */

import { createLlmClient } from './llm-client.js'
import { scenesJson } from './ui.js'
import { optimize, diagnose, detectScene, sceneLabel } from './engine.js'
import { PolyError, isPolyError } from './result.js'
import { resolveLlmConfig } from './llm-client.js'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const VERSION = '0.1.0'

const HELP = `polyprompt — 多场景提示词优化器

用法:
  polyprompt optimize "<提示词>" [选项]   优化提示词（默认命令）
  polyprompt diagnose "<提示词>" [选项]   只诊断打分
  polyprompt config                      查看当前生效配置（不回显完整 key）
  polyprompt scenes                      查看场景要素清单
  polyprompt mcp                         以 stdio MCP server 启动（供 MCP 客户端挂载）
  polyprompt --help | -h                 本帮助

选项:
  --scene <s>          auto|code|writing|image|chat   默认 auto
  --intensity <i>      light|medium|aggressive        默认 medium
  --lang <l>           auto|zh|en                     默认 auto（跟随输入）
  --model <name>       目标模型名，影响措辞与场景偏好
  --context "<文本>"   补充背景信息
  --json               输出原始 JSON（便于管道/脚本）
  --out <file>         结果写入文件

配置（env 优先，其次是 ~/.polyprompt/config.json）:
  POLYPROMPT_BASE_URL / POLYPROMPT_API_KEY / POLYPROMPT_MODEL
  示例: {"baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","model":"deepseek-chat"}

示例:
  polyprompt o "帮我写个爬虫" --scene auto
  polyprompt optimize "画一只赛博朋克猫" --model midjourney --out result.json
`

/** @type {Record<string,string>} 单字符别名 */
const ALIAS = { o: 'optimize', d: 'diagnose', c: 'config' }

function parseArgs(/** @type {string[]} */ argv) {
  const out = { _: /** @type {string[]} */ ([]), flags: /** @type {Record<string,string|boolean>} */ ({}) }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.flags.json = true
    else if (a === '--help' || a === '-h') out.flags.help = true
    else if (a === '--version' || a === '-V') out.flags.version = true
    else if (a.startsWith('--')) {
      const key = a.slice(2)
      if (key === 'out') out.flags.out = argv[++i] ?? ''
      else if (['scene', 'intensity', 'lang', 'model', 'context'].includes(key)) out.flags[key] = argv[++i] ?? ''
      else { console.error('未知选项：' + a); process.exit(2) }
    } else out._.push(a)
  }
  return out
}

function printJsonExit(/** @type {unknown} */ data, /** @type {string|undefined} */ outFile) {
  const s = JSON.stringify(data, null, 2)
  if (outFile) { writeFileSync(outFile, s); console.error('已写入 ' + outFile) }
  else console.log(s)
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.flags.version) { console.log('polyprompt v' + VERSION); return }
  if (parsed.flags.help || parsed._.length === 0) { console.log(HELP); return }

  const [cmdRaw, ...rest] = parsed._
  const cmd = ALIAS[cmdRaw] ?? cmdRaw

  if (cmd === 'scenes') { console.log(scenesJson()); return }

  if (cmd === 'mcp') {
    // stdio MCP server：stdout 只允许 MCP 协议帧，诊断信息一律走 stderr
    const { startServer } = await import('./mcp.js')
    await startServer()
    return
  }


  if (cmd === 'config') {
    const c = resolveLlmConfig()
    console.log(JSON.stringify({
      baseUrl: c.baseUrl,
      apiKey: typeof c.apiKey === 'string' ? c.apiKey.slice(0, 8) + '…' : undefined,
      model: c.model,
      timeoutMs: c.timeoutMs,
    }, null, 2))
    return
  }

  const text = rest.join(' ').trim()
  const llm = createLlmClient()

  try {
    if (cmd === 'optimize') {
      const r = await optimize(llm, text, {
        scene: /** @type {any} */ (parsed.flags.scene ?? 'auto'),
        intensity: /** @type {any} */ (parsed.flags.intensity ?? 'medium'),
        lang: /** @type {any} */ (parsed.flags.lang ?? 'auto'),
        targetModel: typeof parsed.flags.model === 'string' ? parsed.flags.model : undefined,
        context: typeof parsed.flags.context === 'string' ? parsed.flags.context : undefined,
      })
      if (parsed.flags.json) { printJsonExit(r, typeof parsed.flags.out === 'string' ? parsed.flags.out : undefined); return }
      const lines = [
        '场景: ' + sceneLabel(r.scene) + (r.language === 'en' ? ' (en)' : ''),
        '',
        r.optimized,
        '',
        '--- 改动说明 ---',
        ...r.notes.map((n, i) => (i + 1) + '. ' + n.change + ' — ' + n.why),
      ]
      const s = lines.join('\n')
      if (typeof parsed.flags.out === 'string' && parsed.flags.out !== '') {
        writeFileSync(parsed.flags.out, JSON.stringify(r, null, 2))
        console.log(s)
        console.error('\n(完整 JSON 已写入 ' + parsed.flags.out + ')')
      } else console.log(s)
      return
    }
    if (cmd === 'diagnose') {
      const r = await diagnose(llm, text, {
        scene: /** @type {any} */ (parsed.flags.scene ?? 'auto'),
        context: typeof parsed.flags.context === 'string' ? parsed.flags.context : undefined,
      })
      if (parsed.flags.json) { printJsonExit(r, typeof parsed.flags.out === 'string' ? parsed.flags.out : undefined); return }
      console.log('场景: ' + sceneLabel(r.scene) + ' | 得分: ' + r.score + '/100')
      console.log('--- 问题清单 ---')
      for (const [i, p] of r.problems.entries()) console.log((i + 1) + '. [' + p.severity + '] ' + p.issue + '\n   → ' + p.suggestion)
      if (r.problems.length === 0) console.log('（未发现明显问题）')
      return
    }
    console.error('未知命令：' + cmd + '\n'); console.log(HELP); process.exit(2)
  } catch (e) {
    if (isPolyError(e)) {
      console.error('[' + e.code + '] ' + e.message)
      if (e.hint) console.error('建议：' + e.hint)
    } else {
      console.error('未预期错误：' + (e instanceof Error ? (e.stack ?? e.message) : String(e)))
    }
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('fatal: ' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
})
