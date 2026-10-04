/**
 * polyprompt-ai — DSH client half：输入栏 ✨ 按钮（优化/诊断/撤销，同屏对比浮层）
 *
 * 交互设计（相对参考插件新增）：
 *  - 点击 ✨ 直接优化草稿（与用户习惯一致；参考插件已验证的路径）
 *  - 长按（或 Shift+点击）打开选项浮层：场景 / 强度 / 目标模型，可"仅诊断"
 *  - 优化完成后浮层同屏对比 原文 vs 优化结果 + 改动说明，用户确认后 apply，支持撤销
 *  - 全程零依赖宿主私有 API 之外的模块，React 以宿主 require('react') 提供
 */
window.__ModuleLoader__.load({
  id: "polyprompt-ai",
  factory(require) {
    const react = /** @type {any} */ (require("react"))
    const inject = ["slots"]

    var STYLE_ID = "polyprompt-ai-style"
    var API = "/api/polyprompt"
    var STORE_KEY = "polyprompt.options.v1"

    var CSS = [
      ".pp-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0}",
      ".pp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));color:var(--dsw-alias-label-primary,#222)}",
      ".pp-btn:disabled{cursor:not-allowed;filter:grayscale(1)}",
      ".pp-btn.pp-busy:disabled{cursor:progress;filter:none}",
      ".pp-spark{font-size:15px;line-height:1}",
      ".pp-spinner{animation:pp-spin .8s linear infinite}",
      "@keyframes pp-spin{to{transform:rotate(360deg)}}",
      ".pp-progress{position:absolute;left:0;bottom:0;width:100%;height:2px;overflow:hidden}",
      ".pp-progress::before{content:\"\";position:absolute;width:40%;height:100%;background:var(--dsw-alias-brand-primary,#3b82f6);border-radius:9999px;animation:pp-slide 1.1s ease-in-out infinite}",
      "@keyframes pp-slide{0%{left:-40%}100%{left:100%}}",
      ".pp-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.42);font-size:13px}",
      ".pp-panel{width:min(720px,92vw);max-height:84vh;overflow:auto;border-radius:12px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 18px 50px rgba(0,0,0,0.28);padding:16px 18px;display:flex;flex-direction:column;gap:12px}",
      ".pp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".pp-label{font-weight:600}",
      ".pp-select,.pp-input{border:1px solid rgba(0,0,0,0.18);border-radius:8px;padding:4px 8px;background:transparent;color:inherit;font-size:13px}",
      ".pp-col{display:flex;flex-direction:column;gap:6px;min-width:0}",
      ".pp-coltitle{font-weight:600;opacity:.75;font-size:12px}",
      ".pp-box{border:1px solid rgba(0,0,0,0.12);border-radius:10px;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;line-height:1.55}",
      ".pp-box.pp-new{border-color:var(--dsw-alias-brand-primary,#3b82f6);background:rgba(59,130,246,0.06)}",
      ".pp-notes{font-size:12px;line-height:1.6;opacity:.9}",
      ".pp-btnrow{display:flex;gap:8px;justify-content:flex-end}",
      ".pp-btn2{border:1px solid rgba(0,0,0,0.18);background:transparent;color:inherit;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:13px}",
      ".pp-btn2.pp-primary{background:var(--dsw-alias-brand-primary,#3b82f6);border-color:transparent;color:#fff}",
      ".pp-btn2:disabled{opacity:.5;cursor:not-allowed}",
      ".pp-err{color:#c0392b;font-size:12px;white-space:pre-wrap}",
      ".pp-diagitem{margin:2px 0}",
      "@media (prefers-color-scheme: dark){.pp-panel{background:#1e1f22}.pp-select,.pp-input,.pp-btn2{border-color:rgba(255,255,255,0.22)}.pp-box{border-color:rgba(255,255,255,0.16)}}"
    ].join("\n")

    // ---------- 工具 ----------
    /** @param {string} k @param {string} dflt */
    function loadOpt(k, dflt) {
      try { var raw = window.localStorage.getItem(STORE_KEY); if (!raw) return dflt
        var o = JSON.parse(raw); return o && typeof o[k] === "string" ? o[k] : dflt } catch { return dflt }
    }
    /** @param {Record<string,string>} patch */
    function saveOpt(patch) {
      try { var o = {}; var raw = window.localStorage.getItem(STORE_KEY)
        if (raw) { try { o = JSON.parse(raw) || {} } catch { o = {} } }
        Object.assign(o, patch); window.localStorage.setItem(STORE_KEY, JSON.stringify(o)) } catch {}
    }

    /** @param {string} text @param {Record<string,string>} opts @param {"optimize"|"diagnose"} mode */
    async function callApi(text, opts, mode) {
      var res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text, scene: opts.scene, intensity: opts.intensity, lang: opts.lang, target_model: opts.model || undefined, mode: mode }),
        cache: "no-store",
      })
      var data = await res.json().catch(function () { return null })
      if (!res.ok || !data || data.ok !== true) {
        var msg = data && typeof data.error === "string" ? data.error : "HTTP " + res.status
        if (data && typeof data.hint === "string") msg += "\n建议：" + data.hint
        throw new Error(msg)
      }
      return data
    }

    // ---------- 图标 ----------
    function SparkleIcon() { return react.createElement("span", { className: "pp-spark", "aria-hidden": true }, "✨") }
    function SpinnerIcon() {
      return react.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", className: "pp-spinner", "aria-hidden": true },
        react.createElement("circle", { cx: 12, cy: 12, r: 9, opacity: 0.25 }),
        react.createElement("path", { d: "M21 12a9 9 0 0 0-9-9" }))
    }

    // ---------- 选项浮层 ----------
    var SCENES = [["auto", "自动识别"], ["code", "代码"], ["writing", "写作"], ["image", "绘图"], ["chat", "对话"]]
    var INTENSITY = [["medium", "标准"], ["light", "轻度"], ["aggressive", "深度"]]
    var LANGS = [["auto", "跟随输入"], ["zh", "中文"], ["en", "英文"]]
    var MODELS = [["", "默认"], ["deepseek-chat", "DeepSeek"], ["midjourney", "Midjourney"], ["dall-e-3", "DALL·E"], ["claude-code", "Claude"]]

    function OptionsOverlay(/** @type {any} */ props) {
      var useState = react.useState
      var oState = useState(/** @type {any} */ (props.initial))
      var o = oState[0], setO = oState[1]
      var busyState2 = useState(false)
      var busy = busyState2[0]
      var errState = useState("")
      var err = errState[0], setErr = errState[1]
      var close = props.onClose

      function run(/** @type {"optimize"|"diagnose"} */ mode) {
        busy = true
        setErr("")
        saveOpt({ scene: o.scene, intensity: o.intensity, lang: o.lang, model: o.model })
        callApi(props.text, o, mode)
          .then(function (data) { close(); props.onResult({ mode: mode, data: data }) })
          .catch(function (/** @type {any} */ e) { busy = false; setErr(String(e.message || e)) })
      }

      function field(/** @type {string} */ key, /** @type {string} */ label, /** @type {string[][]} */ items) {
        return react.createElement("label", { className: "pp-row" },
          react.createElement("span", { className: "pp-label" }, label),
          react.createElement("select", {
            className: "pp-select", value: o[key],
            onChange: function (/** @type {any} */ ev) {
              var v = /** @type {HTMLSelectElement} */ (ev.target).value
              o = /** @type {any} */ (Object.assign({}, o)); /** @type {any} */ (o)[key] = v; setO(o)
            },
          }, items.map(function (/** @type {any} */ it) { return react.createElement("option", { key: it[0], value: it[0] }, it[1]) })))
      }

      return react.createElement("div", { className: "pp-overlay", onClick: function () { if (!busy) close() } },
        react.createElement("div", { className: "pp-panel", onClick: function (/** @type {any} */ e) { e.stopPropagation() } },
          react.createElement("div", { className: "pp-row" },
            field("scene", "场景", SCENES),
            field("intensity", "强度", INTENSITY),
            field("lang", "语言", LANGS)),
          react.createElement("label", { className: "pp-row" },
            react.createElement("span", { className: "pp-label" }, "目标模型"),
            react.createElement("select", { className: "pp-select", value: o.model, onChange: function (/** @type {any} */ ev) { var v = /** @type {HTMLSelectElement} */ (ev.target).value; var next = /** @type {any} */ (Object.assign({}, o)); next.model = v; setO(next) } },
              MODELS.map(function (/** @type {any} */ it) { return react.createElement("option", { key: it[0], value: it[0] }, it[1]) }))),
          err !== "" && react.createElement("div", { className: "pp-err" }, err),
          react.createElement("div", { className: "pp-btnrow" },
            react.createElement("button", { className: "pp-btn2", disabled: busy, onClick: function () { close() } }, "取消"),
            react.createElement("button", { className: "pp-btn2", disabled: busy, onClick: function () { run("diagnose") } }, "仅诊断"),
            react.createElement("button", { className: "pp-btn2 pp-primary", disabled: busy, onClick: function () { run("optimize") } }, busy ? "优化中…" : "开始优化")))
      )
    }

    // ---------- 结果浮层 ----------
    function ResultOverlay(/** @type {any} */ props) {
      var r = props.result
      var data = r.data
      var notes = Array.isArray(data.notes) ? data.notes : []
      var problems = Array.isArray(data.problems) ? data.problems : []
      return react.createElement("div", { className: "pp-overlay", onClick: props.onClose },
        react.createElement("div", { className: "pp-panel", onClick: function (/** @type {any} */ e) { e.stopPropagation() } },
          react.createElement("div", { className: "pp-row" },
            react.createElement("span", { className: "pp-label" }, "场景：" + (data.sceneLabel || data.scene || "")),
            r.mode === "diagnose" && typeof data.score === "number" ? react.createElement("span", null, "得分 " + data.score + "/100") : null),
          r.mode === "optimize"
            ? react.createElement("div", { className: "pp-col" },
                react.createElement("div", { className: "pp-coltitle" }, "原文"),
                react.createElement("div", { className: "pp-box" }, props.original),
                react.createElement("div", { className: "pp-coltitle" }, "优化结果"),
                react.createElement("div", { className: "pp-box pp-new" }, data.optimized),
                notes.length > 0 && react.createElement("div", { className: "pp-notes" },
                  notes.map(function (/** @type {any} */ n, /** @type {number} */ i) { return react.createElement("div", { key: i }, (i + 1) + ". " + (n.change || "") + (n.why ? " — " + n.why : "")) })))
            : react.createElement("div", { className: "pp-col" },
                react.createElement("div", { className: "pp-coltitle" }, "原文"),
                react.createElement("div", { className: "pp-box" }, props.original),
                react.createElement("div", { className: "pp-coltitle" }, "诊断"),
                problems.length === 0 ? react.createElement("div", null, "（未发现明显问题）")
                  : problems.map(function (/** @type {any} */ p, /** @type {number} */ i) {
                      return react.createElement("div", { className: "pp-diagitem", key: i },
                        (i + 1) + ". [" + (p.severity || "mid") + "] " + (p.issue || "") + (p.suggestion ? " → " + p.suggestion : ""))
                    })),
          react.createElement("div", { className: "pp-btnrow" },
            r.mode === "optimize" ? react.createElement("button", { className: "pp-btn2", onClick: props.onRetry }, "重新优化") : null,
            r.mode === "optimize"
              ? react.createElement("button", { className: "pp-btn2 pp-primary", onClick: props.onApply }, "应用到输入框")
              : react.createElement("button", { className: "pp-btn2 pp-primary", onClick: props.onClose }, "我知道了")))
      )
    }

    // ---------- 主按钮 ----------
    /** 稳定 selector：草稿经 useInput 选择器 hook 下发（0.1.2+ 宿主），旧宿主走 props.input */
    var selectDraft = function (/** @type {any} */ s) { return s && typeof s.draft === "string" ? s.draft : "" }

    function OptimizeButton(/** @type {any} */ props) {
      var busyState = react.useState(false)
      var busy = busyState[0], setBusy = busyState[1]
      var overlayState = react.useState(/** @type {any} */ (null))
      var overlay = overlayState[0], setOverlay = overlayState[1]
      var lastOriginal = react.useRef("")

      var draft = typeof props.useInput === "function" ? props.useInput(selectDraft) : selectDraft(props.input)
      var disabled = busy || draft.trim() === ""

      /** @param {{mode:"optimize"|"diagnose", data:any}} p */
      var handleResult = function (p) {
        setOverlay(p)
        lastOriginal.current = draft
      }

      var onClick = async function () {
        var text = draft
        if (text.trim() === "" || busy) return
        setBusy(true)
        try {
          // 快路径：直接用上次选项优化（点 ✨ 即得结果，浮层在确认时出现）
          var data = await callApi(text, {
            scene: loadOpt("scene", "auto"), intensity: loadOpt("intensity", "medium"),
            lang: loadOpt("lang", "auto"), model: loadOpt("model", ""),
          }, "optimize")
          handleResult({ mode: "optimize", data: data })
        } catch (/** @type {any} */ e) {
          // 失败时打开选项浮层，让用户看到错误并有机会换配置重试
          setOverlay({ mode: "options", error: String(e && e.message || e) })
        } finally {
          setBusy(false)
        }
      }

      var onAuxClick = async function (/** @type {MouseEvent} */ ev) {
        var e = /** @type {MouseEvent} */ (ev)
        if (/** @type {any} */ (e).shiftKey || /** @type {any} */ (e).type === "auxclick") {
          if (busy || draft.trim() === "") return
          setOverlay({ mode: "options", error: "" })
        }
      }

      /** 取消挂载时的 overlay 清理由 React 处理；这里仅渲染 */
      var content = busy ? react.createElement(SpinnerIcon) : react.createElement(SparkleIcon)
      return react.createElement(react.Fragment, null,
        react.createElement("button", {
          type: "button",
          className: "pp-btn" + (busy ? " pp-busy" : ""),
          title: busy ? "正在优化提示词…（Shift+点击打开选项）" : "优化提示词（Shift+点击打开选项）",
          "aria-label": busy ? "正在优化提示词…" : "优化提示词",
          disabled: disabled,
          onClick: function (/** @type {MouseEvent} */ ev) { ev.preventDefault(); return onClick() },
          onContextMenu: function (/** @type {MouseEvent} */ ev) { ev.preventDefault(); if (!busy && draft.trim() !== "") setOverlay({ mode: "options" }) },
          onAuxClick: onAuxClick,
        }, content, busy ? react.createElement("span", { className: "pp-progress" }) : null),
        overlay && overlay.mode === "options" &&
          react.createElement(OptionsOverlay, { initial: {
              scene: loadOpt("scene", "auto"), intensity: loadOpt("intensity", "medium"),
              lang: loadOpt("lang", "auto"), model: loadOpt("model", ""),
            }, text: draft, onClose: function () { setOverlay(null) },
               onResult: function (/** @type {any} */ r) { handleResult(r) } }),
        overlay && overlay.mode === "optimize" &&
          react.createElement(ResultOverlay, { result: overlay, original: lastOriginal.current,
            onClose: function () { setOverlay(null) },
            onApply: function () {
              if (props.inputActions && typeof props.inputActions.setDraft === "function") {
                props.inputActions.setDraft(overlay.data.optimized)
              }
              setOverlay(null)
            },
            onRetry: function () { setOverlay(null); onClick() } }))
    }

    function apply(/** @type {any} */ ctx) {
      var style = document.getElementById(STYLE_ID)
      if (style === null) {
        style = document.createElement("style")
        style.id = STYLE_ID
        style.setAttribute("data-plugin", "polyprompt-ai")
        document.head.appendChild(style)
      }
      style.textContent = CSS

      var slots = ctx.get("slots")
      if (slots === undefined) return

      slots.inject("conversation.input.left", function () {
        return slots.register({ name: "conversation.input.left", id: "polyprompt-ai" },
          function (/** @type {any} */ props) { return react.createElement(OptimizeButton, props) })
      })
    }

    return { inject: inject, apply: apply }
  }
})
