#!/usr/bin/env node
/** @module polyprompt-ai/mcp — MCP stdio server：把 optimize_prompt / diagnose_prompt 暴露给任意 MCP 客户端 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createLlmClient } from './llm-client.js'
import { optimize, diagnose, sceneLabel } from './engine.js'
import { PolyError } from './result.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const VERSION = /** @type {any} */ (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))).version

/** @param {unknown} v 压工具入参里的 string 字段 */
function str(v) { return typeof v === 'string' ? v : undefined }

/** @param {Record<string, unknown>} args */
function optsFrom(args) {
  return {
    scene: typeof args.scene === 'string' ? /** @type {import('./types.js').Scene} */ (args.scene) : 'auto',
    intensity: typeof args.intensity === 'string' ? /** @type {'light'|'medium'|'aggressive'} */ (args.intensity) : 'medium',
    lang: typeof args.lang === 'string' ? /** @type {'auto'|'zh'|'en'} */ (args.lang) : 'auto',
    targetModel: typeof args.target_model === 'string' ? args.target_model : undefined,
    context: typeof args.context === 'string' ? args.context : undefined,
  }
}

/** @param {PolyError} e */
function toolError(e) {
  return { isError: true, content: [{ type: 'text', text: '错误 [' + e.code + '] ' + e.message + (e.hint ? '\n建议：' + e.hint : '') }] }
}

/**
 * 启动 stdio MCP server（默认 behaviour），供客户端以 node lib/mcp.js 挂载。
 */
export async function startServer() {
  const server = new Server(
    { name: 'polyprompt-ai', version: VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'optimize_prompt',
        description: '把一段粗糙的提示词优化为高质量提示词。自动识别场景（代码/写作/绘图/对话），返回优化结果、改动说明与要素覆盖分析。',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要优化的原始提示词' },
            scene: { type: 'string', enum: ['auto', 'code', 'writing', 'image', 'chat'], description: '场景，默认 auto 自动识别' },
            intensity: { type: 'string', enum: ['light', 'medium', 'aggressive'], description: '改写强度，默认 medium' },
            lang: { type: 'string', enum: ['auto', 'zh', 'en'], description: '输出语言，默认跟随输入' },
            target_model: { type: 'string', description: '可选：目标模型名（如 deepseek-chat、midjourney），影响措辞' },
            context: { type: 'string', description: '可选：补充背景信息' },
          },
          required: ['text'],
        },
      },
      {
        name: 'diagnose_prompt',
        description: '只分析不改写：给提示词打分并列出问题与改进建议。',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要分析的提示词' },
            scene: { type: 'string', enum: ['auto', 'code', 'writing', 'image', 'chat'], description: '场景，默认 auto' },
            context: { type: 'string', description: '可选：补充背景信息' },
          },
          required: ['text'],
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const args = /** @type {Record<string, unknown>} */ (request.params.arguments ?? {})
    try {
      const text = typeof args.text === 'string' ? args.text : ''
      if (text.trim() === '') {
        return { isError: true, content: [{ type: 'text', text: '错误 [BAD_ARGS] text 不能为空' }] }
      }
      const llm = createLlmClient()
      if (name === 'optimize_prompt') {
        const r = await optimize(llm, text, optsFrom(args))
        const lines = [
          '【场景】' + sceneLabel(r.scene),
          '【优化后提示词】', r.optimized,
          '',
          '【改动说明】',
          ...(r.notes.length > 0
            ? r.notes.map((n, i) => (i + 1) + '. ' + n.change + ' — ' + n.why)
            : ['（无结构化改动说明）']),
          '【要素覆盖】' + (Object.keys(r.coverage).length > 0
            ? Object.entries(r.coverage).map(([k, v]) => k + '=' + v).join('，')
            : '（模型未返回）'),
        ]
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }
      if (name === 'diagnose_prompt') {
        const r = await diagnose(llm, text, optsFrom(args))
        const lines = [
          '【场景】' + sceneLabel(r.scene) + '（得分 ' + r.score + '/100）',
          '【问题清单】',
          ...(r.problems.length > 0
            ? r.problems.map((p, i) => (i + 1) + '. [' + p.severity + '] ' + p.issue + ' → ' + p.suggestion)
            : ['（未发现明显问题）']),
        ]
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }
      return { isError: true, content: [{ type: 'text', text: '未知工具：' + name }] }
    } catch (e) {
      if (e instanceof PolyError) return toolError(e)
      const msg = e instanceof Error ? e.message : String(e)
      return { isError: true, content: [{ type: 'text', text: '错误 [INTERNAL] ' + msg }] }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  return server
}

// 直接执行时启动（被 import 时不启动）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  startServer().catch((e) => {
    process.stderr.write('[polyprompt-mcp] 启动失败：' + (e instanceof Error ? e.message : String(e)) + '\n')
    process.exit(1)
  })
}
