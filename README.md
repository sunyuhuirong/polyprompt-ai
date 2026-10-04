# PolyPrompt（polyprompt-ai）

多场景提示词优化器：**一套引擎，三处入口** —— DeepSeek Harness (DSH) 桌面/Web 插件 ✨、MCP Server、CLI。
纯 LLM 改写（接 OpenAI 兼容端点 / DSH 宿主模型），自动识别 代码/写作/绘图/对话 四类场景，输出"优化结果 + 改动说明 + 要素覆盖"结构化结果。

> 先做了生态调研：DSH 已有多个"输入框 ✨ 改写回填"型插件（如 wmengxiang/dsh-prompt-optimizer 等），以及全家桶 web 工作台 linshenkx/prompt-optimizer。
> 本项目不重复造 UI 工作台，差异化在：**一套引擎三入口、四场景自动适配、结构化说明与要素覆盖、同屏对比确认后应用**。
> 安装方式与 API 约定参考了 [wmengxiang/dsh-prompt-optimizer](https://github.com/wmengxiang/dsh-prompt-optimizer)（MIT），Host/Client 双半形态与其保持兼容。

## 它解决什么

输入 `帮我写个爬虫` → 输出（示意）：

```
场景: 代码
────────────────────────
【角色】资深 Python 工程师。请用 Python 3.10+ 编写知乎热榜爬虫……
约束：仅标准库 + httpx；失败重试 3 次；输出 data.json ……
────────────────────────
改动说明:
 1. 补全技术栈与运行环境 — 原文未指定语言/版本
 2. 增加验收标准 — 原文无成功判据
```

## 目录

- [入口一：DSH 插件（桌面/Web）](#入口一dsh-插件桌面web)
- [入口二：MCP Server](#入口二mcp-server)
- [入口三：CLI](#入口三cli)
- [配置](#配置mcp--cli-入口)
- [场景与参数](#场景与参数)
- [架构](#架构)
- [已知限制](#已知限制)

---

## 入口一：DSH 插件（桌面/Web）

功能：输入栏左侧 ✨ 按钮 —— 点击直接按上次设置优化草稿并**同屏对比**（原文 vs 结果 + 改动说明），确认后应用；
右键（或 Shift+点击）打开选项浮层（场景/强度/语言/目标模型，可"仅诊断"）。

### 安装

```bash
# 方式一：GitHub（需本机 GitHub SSH）
dsh plugin --profile web add "github:sunyuhuirong/polyprompt-ai#main"

# 方式二：本地路径（无网络/无 SSH，最稳）
dsh plugin --profile web add "file:/绝对路径/to/polyprompt-ai"

# 方式三：npm 发布后
dsh plugin --profile web add polyprompt-ai
```

重启 web profile 即生效。卸载：`dsh plugin --profile web remove polyprompt-ai`。

DSH 内无需任何配置：优化使用界面当前选中的默认模型（`agentDefaultModel`），零 API Key。

## 入口二：MCP Server

任何支持 MCP 的 agent（Claude Code / Claude Desktop / OpenCode / Cursor / Codex / Trae…）都能把 PolyPrompt 挂成工具，
agent 在对话里自主调用 `optimize_prompt` / `diagnose_prompt`。

**第 0 步：配好 LLM（MCP/CLI 入口必须自带模型，DSH 入口不用）**

```bash
mkdir -p ~/.polyprompt && cp examples/config.json ~/.polyprompt/config.json
# 编辑 ~/.polyprompt/config.json 填入 baseUrl / apiKey / model
```

一次配置，所有 MCP 客户端共享；也可以改用各客户端的 env 注入（见下）。

**第 1 步：注册到各客户端**

```bash
# Claude Code（user 作用域，所有项目可用；本地开发先 npm link）
claude mcp add polyprompt -s user -- polyprompt mcp

# 或用 npx（发布到 npm 后可用；未发布用上面的 npm link 方式）
claude mcp add polyprompt -s user -e POLYPROMPT_BASE_URL=https://api.deepseek.com/v1 -e POLYPROMPT_API_KEY=sk-... -e POLYPROMPT_MODEL=deepseek-chat -- npx -y polyprompt-ai mcp
```

其他客户端配置片段见 [examples/](examples/)：Claude Desktop（claude-desktop.json）、OpenCode（opencode.json）；Cursor 写入 `~/.cursor/mcp.json`、Codex 写入 `config.toml`（`[mcp_servers.polyprompt]`），命令同样是 `polyprompt mcp` 或 `npx -y polyprompt-ai mcp`。

**第 2 步：在 agent 里怎么用**

- 直接说："帮我优化这段提示词：帮我写个爬虫" / "给这段提示词做个体检" —— agent 会调用对应工具；
- 或在 CLAUDE.md / AGENTS.md 里加一条规则："生成或修改用户提示词前，先用 mcp 工具 optimize_prompt 优化"。
工具清单：

| 工具 | 说明 |
| --- | --- |
| `optimize_prompt` | `{text, scene?, intensity?, lang?, target_model?, context?}` → 优化结果 + 改动说明 + 要素覆盖 |
| `diagnose_prompt` | `{text, scene?, context?}` → 得分/100 + 问题清单（不改写） |

## 入口三：CLI

```bash
npx -y polyprompt-ai optimize "帮我写个爬虫" --scene auto
npx -y polyprompt-ai o "画一只赛博朋克猫" --model midjourney --json --out result.json
npx -y polyprompt-ai diagnose "帮我写个爬虫"
npx -y polyprompt-ai config          # 查看当前生效配置
```

别名：`o = optimize`，`d = diagnose`。选项：`--scene auto|code|writing|image|chat`、`--intensity light|medium|aggressive`、`--lang auto|zh|en`、`--model <目标模型>`、`--context "<背景>"`、`--json`、`--out <file>`。

## 配置（MCP / CLI 入口）

优先级：CLI flags > 环境变量 > `~/.polyprompt/config.json`。DSH 插件入口不消费这些配置。

```bash
export POLYPROMPT_BASE_URL=https://api.deepseek.com/v1
export POLYPROMPT_API_KEY=sk-...
export POLYPROMPT_MODEL=deepseek-chat
```

或 `mkdir -p ~/.polyprompt && cp examples/config.json ~/.polyprompt/config.json`。
兼容任意 OpenAI 格式端点：DeepSeek / 火山方舟(ark /api/v3) / OpenAI / Moonshot / 百炼 compatible-mode / 本地 Ollama(需 `-y` 之外的 base-url 指向 http://localhost:11434/v1)。示例见 [examples/env.example](examples/env.example)。

## 场景与参数

| scene | 覆盖要素 | 备注 |
| --- | --- | --- |
| code | 技术栈/边界/验收标准/输出格式 | `--model codex/claude/cursor…` 时自动偏向 code |
| writing | 受众/调性/结构/篇幅 | |
| image | 主体/风格/构图/光影/画幅/负面词 | `--model midjourney` 时措辞对齐 MJ 语法 |
| chat | 角色/知识边界/回复结构 | 识别不出时的回落场景 |

- `intensity`: light（轻度打磨）/ medium（标准）/ aggressive（深度重写）
- 语言：默认跟随输入；`--lang zh|en` 强制。

## 架构

```
             ┌────────────────────────── engine.js（编排：识别→改写→校验）
 polyprompt  │  metaprompt.js（四场景元提示词）  types.js（场景档案）
             └────────────┬───────────┬──────────────┘
   lib/index.js (DSH host) │           │ lib/mcp.js (MCP stdio) + lib/cli.js (CLI)
   POST /api/polyprompt    │           │ llm-client.js（OpenAI 兼容客户端 + 配置解析）
   ctx.llm.stream 适配 ────┘           └── fetch → chat/completions
   lib/client.js (DSH client ✨ / 对比浮层)
```

- 引擎与传输解耦：`optimize(llmTransport, text, opts)`，三入口只各写一个薄适配器。
- **fail loud**：缺配置（NO_LLM）、参数错（BAD_ARGS）、上游错（UPSTREAM）、输出不合规（BAD_OUTPUT）都带 code + hint 明确报错。
- 结果协议：`{scene, optimized, notes[{change,why}], coverage{要素: missing|kept|improved}, language}`。

## 开发与测试

```bash
npm install
npm run check        # node --check 语法门（10 个文件）
npm run typecheck    # tsc --allowJs --checkJs 严格检查
npm test             # node --test 18 个用例（无需 API Key）
```

## 已知限制

- 纯 LLM 改写：无 API Key / 无宿主模型时不可用（会明确报错，不静默降级）。
- DSH client 半依赖宿主 `slots`/`inputActions` 契约（0.1.2+ 已验证；官方桌面端同源实现）。
- 场景识别是关键词启发式（9 组回归用例锁定行为），复杂混合场景可用 `--scene` 显式指定。
- 结构化输出靠元提示词约束 + 稳健 JSON 提取，不依赖 `response_format`，兼容所有 OpenAI 格式端点。

## License

MIT
