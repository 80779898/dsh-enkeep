/**
 * dsh-enkeep — Client half of the bundle.
 *
 * Capabilities, no dependencies on other plugins:
 *   1) Chat column width: narrow (native) / wide (no 920px cap) via a
 *      <style> tag (inserted into document.head, cleaned up on unload) that
 *      overrides --dsh-chat-content-width directly on [data-conversation-content]
 *      (body-level overrides fail: the conversation DIV defines that variable
 *      itself, and 100% resolves in differing containing blocks).
 *   2) Sidebar launcher button: a sidebar.panellist entry that opens a panel in
 *      the center column, with visibility controlled by the showLauncher config.
 *   3) Activity bar: an always-on floating strip on shell.overlay listing the
 *      few sessions that are recent / running / unread (completionUnread),
 *      labeled "dir: title", clicking one opens that conversation.
 *
 * State is the Host plugin's volatile Config, read/written through
 * ctx.configForms.get('enkeep') — no custom RPC, no state file.
 */

window.__ModuleLoader__.load({
  id: 'dsh-enkeep',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // react-dom is a platform seed word in the web frontend; createPortal is the
    // official DSH dialog pattern. Guarded so non-DOM contexts still render.
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch (e) { ReactDOM = null }
    const portalToBody = (node) => (node && ReactDOM && typeof document !== 'undefined' && document.body)
      ? ReactDOM.createPortal(node, document.body)
      : node

    const NAMESPACE = 'enkeep'
    const PANEL_ID = 'enkeep'

    // Wide-mode CSS — injected as a <style> element in document.head (the
    // pattern dsh-im uses for normal bundle plugins; the `styles` closure
    // parameter is only available to dynamic packages, so it is NOT used here).
    //
    // WHY NOT theme.overrideTokens on <body>: the conversation bundle defines
    // `--dsh-chat-content-width` on its own body DIV (with a 920px cap), and an
    // element's own custom property shadows one inherited from <body>. Two
    // attempted body overrides both failed in real-browser (Edge) tests:
    //   - `var(--dsh-conversation-column-width)` resolves in BODY context,
    //     where that JS-written variable is absent -> fell back to 100vw
    //     (ignored the sidebar, chat/input wider than the real column).
    //   - `100%` resolves in each USE site's containing block; the text column
    //     and the composer stack have DIFFERENT containing blocks, so the same
    //     expression produced different widths (text shrank inside input).
    //
    // The correct fix mirrors the original wb-01 patch: override
    // `--dsh-chat-content-width` DIRECTLY on the conversation body DIV, using
    // a stable semantic selector `[data-conversation-content]` (no CSS-module
    // hash). There, `var(--dsh-conversation-column-width)` resolves in the
    // DIV's context and picks up the real JS-written column width. The composer
    // card is natively `calc(content-width + 32px)`, so input and text stay
    // Native composer is calc(content-width + 32px), i.e. input 32px wider than
    // the chat text by design. User wants them equal, so also pin the composer
    // to the same width (Edge test: text 1136, input 1136, diff 0px).
    const WIDE_CSS = [
      '[data-conversation-content]{',
      '--dsh-chat-content-width:clamp(640px,calc(var(--dsh-conversation-column-width,100%) - 64px),100%)!important;',
      '--dsh-composer-card-max-width:var(--dsh-chat-content-width)!important;',
      '}',
    ].join('\n')
    const WIDE_STYLE_ID = 'enkeep-wide'

    // Insert our own <style> tag, idempotent by data attribute, with a disposer.
    // This is the dsh-im pattern for normal bundle plugins (no `styles` facade).
    function installWideStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${WIDE_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = WIDE_STYLE_ID
      style.textContent = WIDE_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- Activity bar CSS (常驻悬浮条) --------------------------------------
    // shell.overlay 覆盖层本身 click-through：根元素必须显式开启 pointer-events
    // 才能点中条目。定位用文档化 CSS 变量贴住侧栏内侧，避免读取别的插件 DOM。
    const ACTIVITY_STYLE_ID = 'enkeep-activity'
    const ACTIVITY_CSS = [
      '[data-enkeep-activity-bar]{',
      'position:absolute;top:calc(var(--dsh-frame-overlay-top, 0px) + 8px);',
      // 浮动条固定在右侧一个常量位置：不再随侧栏展开/收起/隐藏而移动。
      // 侧栏已回到左边（sb-01 卸载），旧的 right:sidebar宽 逻辑会让它横跳。
      'right:calc(var(--dsh-sidebar-inline-padding, 12px) + 8px);',
      'width:380px;max-width:calc(100vw - 32px);z-index:40;',
      'display:flex;flex-direction:column;gap:4px;padding:8px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:10px;',
      'background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #202124) 94%, #000);',
      'box-shadow:0 4px 20px rgba(0,0,0,.28);pointer-events:auto;',
      'opacity:1;}',
      // 侧栏折叠时浮动条位置保持不变：覆盖回与基础规则相同的固定 right 值，
      // 确保原生折叠态的任何 right 声明都不会让它横跳。
      '[data-sidebar-collapsed] [data-enkeep-activity-bar]{right:calc(var(--dsh-sidebar-inline-padding, 12px) + 8px);}',
      // Web 侧边栏"完全隐藏"：原生收起仍留 56px 图标栏，这里把 frame 的
      // 侧栏列强制压到 0。官方默认布局侧栏是第一列（sidebar|center|rightbar），
      // 故 fallback 压第一列。覆盖写在样式表 !important 规则里，不改写 React
      // 的 grid-template-columns 内联声明；重绘时由 observer 重算变量。
      // fallback 只是防「变量意外缺失导致整条声明失效」的兜底；正常流程下
      // 变量一定先于标记写入，且解析失败时压根不打标记，故不会误伤中列。
      '[data-enkeep-sidebar-hidden]{',
      'grid-template-columns:var(--dsh-enkeep-grid-cols, 0px minmax(0px, 1fr) minmax(0px, 0px))!important;}',
      '[data-enkeep-sidebar-hidden] [data-enkeep-sidebar-col]{border-right-color:transparent!important;}',
      // 原生状态保持不动，侧栏拖拽手柄不会自行消失，这里用稳定钩子直接隐藏。
      '[data-enkeep-sidebar-hidden] [data-side="sidebar"]{display:none!important;}',
      // 隐藏时浮动条位置同样保持不变，与展开/收起一致。
      'html [data-enkeep-sidebar-hidden] [data-enkeep-activity-bar]{',
      'right:calc(var(--dsh-sidebar-inline-padding, 12px) + 8px);}',
      '[data-enkeep-activity-head]{display:flex;align-items:center;gap:6px;',
      // opacity 作用于整棵子树且子元素无法撤销，故头部不再整体 .75 弱化——
      // 这正是 Tab 文字（tertiary / business-primary）被二次压暗、看不清的根因。
      // 计数与头部按钮各自补回 .75，保持原先的视觉层级，Tab 则全亮度显示。
      'font-size:12px;opacity:1;padding:0 2px 2px;cursor:move;user-select:none;}',
      '[data-enkeep-activity-head] > span{opacity:.75;}',
      // Dragging state: stronger shadow + grabbing cursor; transform is set inline
      // on the bar by the component (叠加在默认 CSS 定位之上).
      '[data-enkeep-activity-bar][data-dragging]{cursor:grabbing;',
      'box-shadow:0 10px 32px rgba(0,0,0,.42);transition:none;}',
      '[data-enkeep-activity-head] strong{font-weight:600;}',
      // 上下分栏：上区列表容器与下区列表容器各自独立滚动；公共拖拽头不随滚动移动。
      '[data-enkeep-activity-list]{max-height:264px;overflow-y:auto;overscroll-behavior:contain;}',
      // 下区面板（当前对话的外派对话）：视觉沿用活动区变量，选择器与上区完全隔离。
      '[data-enkeep-dispatch-panel]{display:flex;flex-direction:column;',
      'border-top:1px solid var(--dsw-alias-border-l3);padding-top:6px;margin-top:2px;}',
      '[data-enkeep-dispatch-head]{display:flex;align-items:center;gap:6px;',
      'font-size:12px;opacity:.75;padding:0 2px 4px;user-select:none;}',
      '[data-enkeep-dispatch-count]{margin-left:auto;}',
      '[data-enkeep-dispatch-toggle]{border:0;background:transparent;color:inherit;cursor:pointer;',
      'width:22px;height:22px;border-radius:6px;padding:0;',
      'display:inline-flex;align-items:center;justify-content:center;}',
      '[data-enkeep-dispatch-toggle]:hover{background:var(--dsw-alias-bg-layer-3);}',
      // 下区高度：容纳默认 10 条（每项约 25px + gap），无滚动条；超出仍可滚动。
      '[data-enkeep-dispatch-list]{max-height:280px;overflow-y:auto;overscroll-behavior:contain;',
      'display:flex;flex-direction:column;gap:2px;}',
      '[data-enkeep-dispatch-item]{display:flex;align-items:center;width:100%;',
      'border-radius:6px;color:inherit;font-size:12px;}',
      '[data-enkeep-dispatch-item]:hover{background:var(--dsw-alias-bg-layer-3);}',
      // 当前外派：背景 + 左侧强调条，与 hover 区分；点击外派只切换高亮，
      // 上区助手对话与下区列表都保持不动（见 derived-current 校正的 worker 分支）。
      '[data-enkeep-dispatch-item][data-enkeep-dispatch-current]{',
      'background:var(--dsw-alias-bg-layer-2);',
      'box-shadow:inset 2px 0 0 var(--dsw-alias-state-success-primary, #35b37e);}',
      '[data-enkeep-dispatch-main]{display:flex;align-items:center;gap:8px;',
      'flex:1 1 auto;min-width:0;text-align:left;border:0;border-radius:6px;',
      'padding:5px 8px;background:transparent;color:inherit;cursor:pointer;',
      'font-size:12px;}',
      '[data-enkeep-dispatch-dot]{flex:0 0 auto;width:8px;height:8px;border-radius:50%;',
      'background:var(--dsw-alias-text-4, #8b8b8b);}',
      '[data-enkeep-dispatch-dot="ongoing"]{background:var(--dsw-alias-state-success-primary, #35b37e);',
      'animation:enkeep-activity-pulse 1.6s ease-in-out infinite;}',
      '[data-enkeep-dispatch-dot="awaiting"]{background:transparent;box-sizing:border-box;',
      'border:2px solid var(--dsw-alias-state-warn-label, #d89614);}',
      '[data-enkeep-dispatch-dot="unread"]{background:var(--dsw-alias-state-warn-label, #d89614);',
      'box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-warn-label, #d89614) 25%, transparent);}',
      '[data-enkeep-dispatch-dot="idle"]{background:var(--dsw-alias-text-4, #8b8b8b);}',
      '[data-enkeep-dispatch-label]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '[data-enkeep-dispatch-empty]{padding:10px 8px;font-size:12px;opacity:.7;text-align:center;}',
      '@media (prefers-reduced-motion: reduce){',
      '[data-enkeep-dispatch-dot="ongoing"]{animation:none;}}',
      '[data-enkeep-activity-empty]{padding:10px 8px;font-size:12px;opacity:.7;text-align:center;}',
      // Hover-reveal buttons: fixed footprint, opacity-only switch — showing or
      // hiding never reflows neighbouring text. Mirrors dsh's chat action pattern.
      // Note: unlike the conversation row actions above (display:none, no footprint),
      // this reserves width on purpose — the user asked for ZERO reflow on reveal.
      '@media (hover:hover){',
      '[data-enkeep-reveal]{opacity:0;transition:opacity 80ms;}',
      '[data-enkeep-reveal-host]:hover [data-enkeep-reveal],',
      '[data-enkeep-reveal]:focus-within{opacity:1;}}',
      // Touch / hover:none: buttons stay visible (no opacity:0 outside the media query).
      '[data-enkeep-activity-workspace-row]{display:flex;align-items:center;width:100%;',
      'border-radius:6px;padding-right:4px;}',
      '[data-enkeep-workspace-actions]{flex:none;display:inline-flex;align-items:center;}',
      '[data-enkeep-activity-tabs]{display:flex;align-items:center;gap:6px;margin-right:6px;}',
      '[data-enkeep-activity-tab]{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:4px;opacity:.7;}',
      '[data-enkeep-activity-tab][data-active]{opacity:1;font-weight:600;background:var(--dsw-alias-bg-layer-3);}',
      '[data-enkeep-activity-workspace]{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:6px;padding:5px 8px;background:transparent;color:inherit;cursor:pointer;font-size:12px;text-align:left;}',
      '[data-enkeep-activity-workspace]:hover{background:var(--dsw-alias-bg-layer-3);}',
      '[data-enkeep-activity-workspace][data-selected]{background:var(--dsw-alias-bg-layer-3);}',
      '[data-enkeep-workspace-label]{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '[data-enkeep-workspace-count]{opacity:.6;font-size:11px;}',
      '[data-enkeep-activity-actions]{display:flex;align-items:center;gap:2px;margin-left:auto;opacity:.75;}',
      // 所有头部按钮共用一个尺寸盒：22×22、15px SVG、无边框，保证视觉大小一致。
      '[data-enkeep-activity-action],[data-enkeep-activity-toggle]{',
      'border:0;background:transparent;color:inherit;cursor:pointer;',
      'width:22px;height:22px;border-radius:6px;padding:0;',
      'display:inline-flex;align-items:center;justify-content:center;}',
      '[data-enkeep-activity-action]:hover:not(:disabled),[data-enkeep-activity-toggle]:hover{',
      'background:var(--dsw-alias-bg-layer-3);}',
      '[data-enkeep-activity-action]:disabled{opacity:.45;cursor:default;}',
      '[data-enkeep-activity-item]{display:flex;align-items:center;width:100%;',
      'border-radius:6px;color:inherit;font-size:12px;}',
      '[data-enkeep-activity-item]:hover{background:var(--dsw-alias-bg-layer-3);}',
      // Main button owns the label/dot/badge; flex:1 keeps label ellipsis working.
      '[data-enkeep-activity-main]{display:flex;align-items:center;gap:8px;',
      'flex:1 1 auto;min-width:0;text-align:left;border:0;border-radius:6px;',
      'padding:5px 8px;background:transparent;color:inherit;cursor:pointer;',
      'font-size:12px;}',
      // Pinned row: ONLY a leading accent stripe. No full-row background —
      // that used to blend with the current-session row's 12% blue background
      // (and was overridden by it anyway when a row was both pinned+current).
      '[data-enkeep-activity-item][data-enkeep-pinned]{',
      'box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary, #4c8bf5);}',
      // Row action buttons: display:none by default so they take NO horizontal
      // space — the label (flex:1) owns the full row and shows untruncated.
      // Official workspace rows do exactly this: .rowActions{display:none},
      // shown as inline-flex only on :hover / :focus-within. Using opacity:0
      // instead would keep the buttons occupying width and truncate the title.
      '[data-enkeep-activity-row-actions]{display:none;align-items:center;gap:1px;',
      'flex:none;padding-right:4px;}',
      '[data-enkeep-activity-item]:hover [data-enkeep-activity-row-actions],',
      '[data-enkeep-activity-item]:focus-within [data-enkeep-activity-row-actions]{display:inline-flex;}',
      '[data-enkeep-row-action]{border:0;background:transparent;color:inherit;cursor:pointer;',
      'width:20px;height:20px;border-radius:5px;padding:0;',
      'display:inline-flex;align-items:center;justify-content:center;}',
      '[data-enkeep-row-action]:hover{background:var(--dsw-alias-bg-layer-4);}',
      '[data-enkeep-row-action][data-enkeep-row-pin]{color:var(--dsw-alias-state-business-primary, #4c8bf5);}',
      // 五种标识：运行中(绿实心+脉冲环) / 等待互动(琥珀空心环,静态) /
      // 完成未看(橙实心+光环) / 完成已看(灰实心) /
      // 当前对话(叠加高亮行背景色；当前通常也是运行中，故双重标识)。
      // 等待互动用空心环而非实心点，与同为琥珀色的「完成未看」在形状上区分，
      // 避免颜色混淆；且不带 animation——脉冲专属于真正在运行的 ongoing。
      '[data-enkeep-dot]{flex:0 0 auto;width:8px;height:8px;border-radius:50%;',
      'background:var(--dsw-alias-text-4, #8b8b8b);}',
      '[data-enkeep-dot="ongoing"]{background:var(--dsw-alias-state-success-primary, #35b37e);',
      'animation:enkeep-activity-pulse 1.6s ease-in-out infinite;}',
      '[data-enkeep-dot="awaiting"]{background:transparent;box-sizing:border-box;',
      'border:2px solid var(--dsw-alias-state-warn-label, #d89614);}',
      '[data-enkeep-dot="unread"]{background:var(--dsw-alias-state-warn-label, #d89614);',
      'box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-warn-label, #d89614) 25%, transparent);}',
      '[data-enkeep-dot="idle"]{background:var(--dsw-alias-text-4, #8b8b8b);}',
      '@keyframes enkeep-activity-pulse{',
      '0%,100%{box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary, #35b37e) 32%, transparent);}',
      '50%{box-shadow:0 0 0 5px color-mix(in srgb, var(--dsw-alias-state-success-primary, #35b37e) 4%, transparent);}}',
      '@media (prefers-reduced-motion: reduce){',
      '[data-enkeep-dot="ongoing"]{animation:none;}}',
      '[data-enkeep-activity-item][data-enkeep-current]{',
      'background:color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8bf5) 22%, transparent);}',
      '[data-enkeep-activity-label]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      // Confirm / rename dialogs (centred over the viewport, above the bar).
      '[data-enkeep-modal-mask]{position:fixed;inset:0;z-index:1000;',
      'display:flex;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.45);pointer-events:auto;}',
      '[data-enkeep-modal]{width:min(360px,calc(100vw - 32px));',
      'display:flex;flex-direction:column;gap:12px;padding:16px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2, #202124);color:inherit;',
      'box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:13px;}',
      '[data-enkeep-modal] strong{font-size:14px;}',
      '[data-enkeep-modal] p{margin:0;line-height:1.6;opacity:.85;}',
      '[data-enkeep-modal-error]{color:var(--dsw-alias-state-error-primary, #d54941);opacity:1;}',
      '[data-enkeep-rename-input]{width:100%;box-sizing:border-box;padding:7px 9px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:6px;',
      'background:var(--dsw-alias-bg-layer-1, #1a1b1c);color:inherit;font-size:13px;}',
      '[data-enkeep-modal-actions]{display:flex;justify-content:flex-end;gap:8px;}',
      '[data-enkeep-modal-actions] button{border:1px solid var(--dsw-alias-border-l3);',
      'background:transparent;color:inherit;cursor:pointer;border-radius:6px;',
      'padding:5px 12px;font-size:12px;}',
      '[data-enkeep-modal-actions] button:hover{background:var(--dsw-alias-bg-layer-3);}',
      '[data-enkeep-modal-actions] [data-enkeep-modal-primary]{',
      'background:var(--dsw-alias-state-business-primary, #4c8bf5);',
      'border-color:var(--dsw-alias-state-business-primary, #4c8bf5);color:#fff;}',
      '[data-enkeep-modal-actions] [data-enkeep-modal-primary]:hover{filter:brightness(1.08);}',
    ].join('\n')

    function installActivityStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${ACTIVITY_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = ACTIVITY_STYLE_ID
      style.textContent = ACTIVITY_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- Last user prompt bar (输入框上方、input.dock 文档流内) --------------
    // 显示当前会话最后一条"用户自己发给 AI"的消息，回答很长、滚动很远之后
    // 仍能一眼看到上次的要求。形式完全参照 git 分支 chip：注册为
    // conversation.input.dock 的 additive list slot 条目，走正常文档流，
    // 与 git chip / 任务条由官方布局依次排列，永不重叠；宽度对齐 composer
    // 卡片（max-width: var(--dsh-composer-card-max-width) + margin:auto）。
    // MutationObserver 只读官方 DOM 文本、写自身 React state。
    const LASTPROMPT_STYLE_ID = 'enkeep-lastprompt'
    const LASTPROMPT_CSS = [
      // Wrapper occupies the slot's normal flow, left-aligned and centered like
      // .dsh-gpc (git chip). Width matches the composer input card.
      '[data-enkeep-lastprompt]{',
      'position:relative;display:flex;justify-content:flex-start;',
      'box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width, 800px);',
      'margin:0 auto -2px;padding:0;pointer-events:auto;',
      '}',
      '[data-enkeep-lastprompt-inner]{',
      'display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;',
      'padding:6px 12px;min-height:34px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l3);',
      'background:var(--dsw-alias-bg-layer-2, #2a2b2e);',
      'font-size:12px;line-height:1.4;}',
      '[data-enkeep-lastprompt-label]{flex:none;opacity:.72;white-space:nowrap;',
      'color:var(--dsw-alias-label-tertiary, #888);}',
      '[data-enkeep-lastprompt-text]{',
      'flex:1;min-width:0;color:var(--dsw-alias-label-primary, #ddd);',
      // 按钮固定占位（display:inline-flex + min-width），flex 已为其分配空间，
      // 文字宽度恒定；无需额外 padding-right（那会白白再缩窄文字）。
      'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;',
      'overflow:hidden;word-break:break-word;}',
      // Copy button: fixed footprint, opacity-only reveal (hover/focus-within) via
      // [data-enkeep-reveal] — never reflows the prompt text when shown/hidden.
      '[data-enkeep-lastprompt-copy]{flex:none;display:inline-flex;align-items:center;gap:4px;',
      'min-width:58px;justify-content:center;',
      'padding:3px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:5px;',
      'background:var(--dsw-alias-bg-layer-1, #202124);color:var(--dsw-alias-label-secondary, #bbb);',
      'font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;}',
      '[data-enkeep-lastprompt-copy]:hover{color:var(--dsw-alias-label-primary, #eee);',
      'border-color:var(--dsw-alias-border-l2);}',
    ].join('\n')

    function installLastPromptStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${LASTPROMPT_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = LASTPROMPT_STYLE_ID
      style.textContent = LASTPROMPT_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- Composer quick-prompt dock ------------------------------------------
    // Quick prompts, rendered on composer.composer.dock (the composer's bottom
    // row, below the textarea). Our content sits on the LEFT of that single row;
    // the native stats pills + ContextMeter stay RIGHT. The current-session
    // chip was removed (the label now lives in the conversation header only).
    const CURRENT_STYLE_ID = 'enkeep-current'
    const CURRENT_CSS = [
      // Make the shared dock EXACTLY as wide as the composer card so the
      // quick-prompt row (left) and the native ContextMeter (right) line up
      // with the INPUT BOX's outer edges on both ends. Important: native
      // .uV2eYG_dock{max-width:100%} is injected AFTER our stylesheet at equal
      // specificity, so without !important the dock falls back to root width
      // (~25px WIDER than the card), pushing both ends out ~12.5px — the
      // actual bug. box-sizing keeps width:100% total; native padding-top is
      // untouched. We only READ the width var -> width-vars stay read-only.
      '[data-composer-dock]{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,100%)!important;}',
      // Grow to absorb free space, pushing native stats to the right edge.
      '[data-enkeep-composer-current]{',
      'display:flex;justify-content:flex-start;align-items:center;gap:6px;',
      'flex:1 1 auto;width:auto;min-width:0;max-width:none;margin:0;}',
      // High-frequency quick-access row: single line, horizontal scroll, never wraps
      // and never writes chat-width variables (width isolation).
      '[data-enkeep-quick]{display:flex;align-items:center;gap:4px;',
      'min-width:0;flex:1 1 auto;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;}',
      '[data-enkeep-quick]::-webkit-scrollbar{height:4px;}',
      '[data-enkeep-quick]::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);border-radius:4px;}',
      '[data-enkeep-quick-item]{flex:0 0 auto;max-width:170px;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;padding:3px 9px;font-size:12px;line-height:18px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,8px);',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-text-2);cursor:pointer;}',
      '[data-enkeep-quick-item]:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-text-1);}',
      '[data-enkeep-quick-item]:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px;}',
      // Composer card corner: the native card is --dsw-radius-panel (28px), which is
      // very round. Soften it to --dsw-radius-lg (16px) to match the small-radius
      // language of our chips. Use the stable data-composer-card hook (no hash) and
      // !important because the native rule is a CSS-module class of equal specificity.
      // Covers the dashed workspace-trigger pseudo-element too. Read-only token use.
      '[data-composer-card]{border-radius:var(--dsw-radius-lg,16px)!important;}',
      '[data-composer-card]::after{border-radius:var(--dsw-radius-lg,16px)!important;}',
    ].join('\n')

    function installCurrentStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${CURRENT_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = CURRENT_STYLE_ID
      style.textContent = CURRENT_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- Header title CSS -----------------------------------------------------
    // Prefix the NATIVE current-session title with the workspace dir ("dir: ")
    // and enlarge it to 16px, keeping the native DSH title colour. No extra tag
    // is added to the header.
    // Target: the span immediately before the official lineage slot anchor in the
    // crumbs. That is the native "current" crumb (verified in the live DOM: the
    // anchor's previousElementSibling is span.wSkVaW_crumbCurrent). We key off the
    // official slot anchor, NOT a hash class, and only single :has() (nested :has
    // is invalid CSS). Subagent crumbs have a different structure and are not hit.
    // The prefix string itself lives in --enkeep-dir-prefix, written by HeaderTitle
    // as a quoted CSS string (content:var(...) needs a quoted value to render).
    // We deliberately do NOT register the lineage slot: it is kind:"single" and
    // @deepseek-ai/dsh-client-ui-subagent owns it — a second registration at the
    // same priority throws and kills the subagent entry at boot. No width vars.
    const HEADER_STYLE_ID = 'enkeep-header'
    const HDR_CRUMB = 'span:has(+ [data-slot="conversation.session.header.lineage"])'
    const HEADER_CSS = [
      // Enlarge the native current crumb while keeping its native colour/weight.
      // The native crumb has max-width:220px + text-overflow:ellipsis, which
      // truncates longer titles (and now the dir prefix too). The crumbs nav
      // already has overflow:hidden + min-width:0 on the flex chain, so lifting
      // the span cap won't break layout — it just stops hiding title text.
      HDR_CRUMB + '{',
      'font-size:16px;max-width:none;}',
      // Insert the workspace-dir prefix right before the native title text.
      HDR_CRUMB + '::before{',
      'content:var(--enkeep-dir-prefix,"");}',
    ].join('\n')

    function installHeaderStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${HEADER_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = HEADER_STYLE_ID
      style.textContent = HEADER_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- Compact header CSS: merge the native two header rows into one -------
    // Native header is a grid: title row (~y10) + tab row (~y50), 76px tall.
    // We compress it to 48px and absolutely position the tab strip right after
    // the title crumb using vars published by HeaderTitle; the actions band is
    // pushed right by the tab span so nothing overlaps. Every selector is scoped
    // to the conversation header via :has() on the stable lineage-slot anchor
    // (no hash classes, no bare globals). Vars carry fallbacks so a failed
    // measurement still leaves a sane single-row layout instead of a broken one.
    const COMPACT_HEADER_STYLE_ID = 'enkeep-header-compact'
    const HDR_CONTAINER = 'header:has([data-slot="conversation.session.header.lineage"])'
    const COMPACT_HEADER_CSS = [
      HDR_CONTAINER + '{',
      'position:relative;height:48px;min-height:48px;}',
      HDR_CONTAINER + ' [role="tablist"]{',
      'position:absolute;top:12px;left:var(--enkeep-tabs-left, 227px);z-index:5;}',
      HDR_CONTAINER + ' [class*="headerActions"]{',
      'margin-left:var(--enkeep-tabs-shift, 122px);}',
    ].join('\n')

    function installCompactHeaderStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${COMPACT_HEADER_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = COMPACT_HEADER_STYLE_ID
      style.textContent = COMPACT_HEADER_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- Common words panel CSS (ported from dsh-wordbox, renamed prefix) -----
    // Prefix ekeep-w- so it can never collide with cwbx_* / data-enkeep-*.
    // NOTE: width isolation — the panel only ever reads the composer card rect
    // and writes its OWN inline style; it never touches the chat width vars.
    const WORDS_STYLE_ID = 'enkeep-words'
    const WORDS_CSS = [
      '.ekeep-w-root{position:relative;display:inline-flex;align-items:center;flex:none}',
      '.ekeep-w-trigger{height:28px;min-width:28px;box-sizing:border-box;padding:0 7px;display:inline-flex;align-items:center;justify-content:center;gap:3px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;outline:none}',
      '.ekeep-w-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.ekeep-w-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.ekeep-w-chevron{color:var(--dsw-alias-label-caption);transition:transform .12s}',
      '.ekeep-w-chevronOpen{transform:rotate(180deg)}',
      '.ekeep-w-panel{position:fixed;z-index:40;box-sizing:border-box;max-height:min(500px,calc(100vh - 120px));border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;padding:4px;display:flex;overflow:hidden;animation:ekeep-w-slideUp .14s ease-out}',
      '@keyframes ekeep-w-slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '.ekeep-w-list{list-style:none;margin:0;padding:0;flex:0 1 auto;min-height:0;max-height:340px;overflow-y:auto}',
      '.ekeep-w-row{display:flex;align-items:center;gap:4px;border-radius:8px;min-height:34px}',
      '.ekeep-w-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ekeep-w-word{flex:auto;min-width:0;box-sizing:border-box;height:34px;padding:7px 4px 7px 10px;border:none;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;font-size:13px;line-height:20px;cursor:pointer;overflow:hidden}',
      '.ekeep-w-wordText{display:inline-block;white-space:nowrap;vertical-align:top;transition:transform .25s ease-out}',
      '.ekeep-w-word:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px;border-radius:8px}',
      '.ekeep-w-del{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;opacity:0;transition:opacity .1s}',
      '.ekeep-w-row:hover .ekeep-w-del,.ekeep-w-del:focus-visible{opacity:1}',
      '.ekeep-w-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}',
      '.ekeep-w-del:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}',
      '.ekeep-w-toGlobal{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .1s}',
      '.ekeep-w-row:hover .ekeep-w-toGlobal,.ekeep-w-toGlobal:focus-visible{opacity:1}',
      '.ekeep-w-toGlobal:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ekeep-w-toGlobal:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}',
      '.ekeep-w-empty{color:var(--dsw-alias-label-tertiary);padding:10px;font-size:13px;line-height:20px}',
      '.ekeep-w-addRow{display:flex;align-items:center;gap:6px;padding:4px 2px;flex:none}',
      '.ekeep-w-addInput{flex:auto;min-width:0;box-sizing:border-box;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;outline:none}',
      '.ekeep-w-addInput:focus{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.ekeep-w-addConfirm{flex:none;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;cursor:pointer}',
      '.ekeep-w-addConfirm:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}',
      '.ekeep-w-addConfirm:disabled{opacity:.5;cursor:default}',
      '.ekeep-w-actions{flex:none;display:flex;align-items:center;gap:6px;padding:2px 2px 2px}',
      '.ekeep-w-add{height:24px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:24px;cursor:pointer;margin-right:auto}',
      '.ekeep-w-add:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ekeep-w-modes{flex:none;display:inline-flex;align-items:center;gap:2px}',
      '.ekeep-w-mode{height:22px;padding:0 5px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:22px;cursor:pointer;outline:none}',
      '.ekeep-w-mode:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.ekeep-w-mode:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.ekeep-w-modeActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}',
      // Skill quick-pick: an independent tab/section inside the word panel.
      '.ekeep-w-views{flex:none;display:inline-flex;align-items:center;gap:2px}',
      '.ekeep-w-view{height:22px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:22px;cursor:pointer;outline:none}',
      '.ekeep-w-view:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.ekeep-w-view:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.ekeep-w-viewActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}',
      '.ekeep-w-skillName{flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);padding:7px 4px 7px 10px}',
      '.ekeep-w-skillDesc{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:20px;color:var(--dsw-alias-label-caption)}',
      '.ekeep-w-fav{flex:none;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:22px;cursor:pointer}',
      '.ekeep-w-fav:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ekeep-w-fav:disabled{opacity:.5;cursor:default}',
      '.ekeep-w-skillTools{flex:none;display:inline-flex;align-items:center;gap:4px}',
      // Settings-page editor (prefix ekeep-p-). Keyword single-line + body multi-line textarea.
      '.ekeep-p-wrap{display:flex;flex-direction:column;gap:8px;}',
      '.ekeep-p-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.ekeep-p-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;}',
      '.ekeep-p-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}',
      '.ekeep-p-btn:disabled{opacity:.5;cursor:default}',
      '.ekeep-p-btnPrimary{background:var(--dsw-alias-state-business-primary,#4c8bf5);color:#fff;border-color:transparent;}',
      '.ekeep-p-count{font-size:12px;color:var(--dsw-alias-label-tertiary);}',
      '.ekeep-p-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:60vh;overflow-y:auto;}',
      '.ekeep-p-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;}',
      '.ekeep-p-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.ekeep-p-kw{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ekeep-p-prev{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.ekeep-p-uses{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);}',
      '.ekeep-p-acts{flex:none;display:flex;align-items:center;gap:4px;}',
      '.ekeep-p-mini{height:22px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;}',
      '.ekeep-p-mini:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.ekeep-p-miniDanger:hover{color:var(--dsw-alias-state-error-primary);}',
      '.ekeep-p-edit{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;}',
      '.ekeep-p-input,.ekeep-p-textarea{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;outline:none;resize:vertical;}',
      '.ekeep-p-input{height:30px;}',
      '.ekeep-p-textarea{min-height:120px;max-height:50vh;}',
      '.ekeep-p-input:focus,.ekeep-p-textarea:focus{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.ekeep-p-fieldlabel{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.ekeep-p-dup{font-size:12px;color:var(--dsw-alias-state-warn-label,#d89614);}',
      '.ekeep-p-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:8px 0;}',
      // Settings panel shell: side tab bar + full-width pane + close button.
      '.ekeep-set-root{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;box-sizing:border-box;padding:0 16px 16px;}',
      '.ekeep-set-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 12px;}',
      '.ekeep-set-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.ekeep-set-close{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;cursor:pointer;}',
      '.ekeep-set-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.ekeep-set-close:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none;}',
      '.ekeep-set-body{display:flex;flex-direction:row;gap:16px;width:100%;min-height:0;flex:1;overflow:hidden;}',
      '.ekeep-set-tabs{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:112px;padding-right:12px;border-right:1px solid var(--dsw-alias-border-l2);}',
      '.ekeep-set-tab{display:block;width:100%;text-align:left;padding:8px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap;}',
      '.ekeep-set-tab:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.ekeep-set-tabActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);font-weight:600;}',
      '.ekeep-set-tab:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none;}',
      '.ekeep-set-pane{flex:1 1 auto;min-width:0;min-height:0;width:100%;display:flex;flex-direction:column;}',
      // In the center panel the prompt editor fills the remaining height and its
      // list scrolls inside the page instead of being capped at 60vh.
      '.ekeep-set-pane>.ekeep-p-wrap{flex:1 1 auto;min-height:0;}',
      '.ekeep-set-pane>.ekeep-p-wrap>.ekeep-p-list{flex:1 1 auto;min-height:0;max-height:none;}',
    ].join('\n')

    function installWordsStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${WORDS_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = WORDS_STYLE_ID
      style.textContent = WORDS_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // --- git-panel split handle (optional cross-plugin enhancement) ----------
    // Zero-dependency enhancement of the third-party dsh-git-panel if it happens
    // to be mounted. Every selector is scoped under `.dsh-gp` (the git-panel root),
    // so with git-panel absent these rules match nothing and are inert. The height
    // variable is written ONLY on the `.dsh-gp` element — never on :root/body — so
    // no other plugin is affected. See docs/GIT-PANEL-SPLIT-PLAN.md.
    const GITPANEL_STYLE_ID = 'enkeep-gitpanel-split'
    const GITPANEL_SPLIT_KEY = 'dsh.enkeep.gp.topH.v1'
    const GITPANEL_SPLIT_CLASS = 'enkeep-gp-split'
    const GITPANEL_TOP_H_VAR = '--enkeep-gp-top-h'
    const GITPANEL_MIN_PX = 120 // keep both the changes list and the body at least this tall
    const GITPANEL_CSS = [
      '.dsh-gp .dsh-gp-write{position:relative;}',
      // Subtle grip on the write/body divider: hidden by default, fades in as a
      // thin neutral line only while the pointer is near, stays visible while dragging.
      '.dsh-gp .dsh-gp-write::after{content:"";position:absolute;left:20%;right:20%;bottom:-2px;',
      'height:4px;border-radius:2px;cursor:row-resize;touch-action:none;z-index:7;',
      'background:var(--muted,#888);opacity:0;transition:opacity .12s ease;}',
      '.dsh-gp-write:hover::after,.dsh-gp.enkeep-gp-dragging .dsh-gp-write::after{opacity:.55;}',
      // Only when a split height is committed does the layout switch to a fixed
      // top band; default (no var) keeps git-panel's exact native layout.
      `.dsh-gp.${GITPANEL_SPLIT_CLASS} .dsh-gp-write{`,
      `height:var(${GITPANEL_TOP_H_VAR},auto);flex:none;min-height:0;overflow:hidden;}`,
      `.dsh-gp.${GITPANEL_SPLIT_CLASS} .dsh-gp-changes{`,
      'flex:1 1 auto;min-height:0;overflow-y:auto;}',
      // Lift git-panel's own per-group 140px caps so the file lists actually grow
      // with the top band; the changes container above absorbs the scrolling.
      `.dsh-gp.${GITPANEL_SPLIT_CLASS} .dsh-gp-changes-list{max-height:none;}`,
      `.dsh-gp.${GITPANEL_SPLIT_CLASS} .dsh-gp-changes-pre{max-height:none;}`,
      `.dsh-gp.${GITPANEL_SPLIT_CLASS} .dsh-gp-body{flex:1 1 auto;min-height:0;overflow:auto;}`,
    ].join('\n')

    function installGitPanelStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${GITPANEL_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = GITPANEL_STYLE_ID
      style.textContent = GITPANEL_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // Find the mounted git-panel root, wire up a row-resize drag on the divider,
    // and restore a saved height. Returns a disposer that removes every listener
    // it added. Absent panel / missing DOM APIs -> no-op, no throw.
    function setupGitPanelSplit() {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}
      let gp = null
      let detachPanel = null
      let disposeObserver = null

      const readSaved = () => {
        try {
          const raw = localStorage.getItem(GITPANEL_SPLIT_KEY)
          const n = raw === null ? NaN : Number(raw)
          return Number.isFinite(n) && n >= GITPANEL_MIN_PX ? n : null
        } catch (e) { return null }
      }
      const clamp = (px, max) => Math.min(Math.max(px, GITPANEL_MIN_PX), Math.max(GITPANEL_MIN_PX, max))
      const applyHeight = (root, px) => {
        try {
          root.classList.add(GITPANEL_SPLIT_CLASS)
          root.style.setProperty(GITPANEL_TOP_H_VAR, Math.round(px) + 'px')
        } catch (e) { /* ignore */ }
      }
      const resetHeight = (root) => {
        try {
          root.classList.remove(GITPANEL_SPLIT_CLASS)
          root.style.removeProperty(GITPANEL_TOP_H_VAR)
          localStorage.removeItem(GITPANEL_SPLIT_KEY)
        } catch (e) { /* ignore */ }
      }
      const maxTopFor = (root) => {
        // available height = current top + bottom bands; leave MIN at the bottom
        const write = root.querySelector('.dsh-gp-write')
        const body = root.querySelector('.dsh-gp-body')
        const top = write ? write.getBoundingClientRect().height : 0
        const bottom = body ? body.getBoundingClientRect().height : 0
        // This is the drag CEILING, not a clamp against MIN. Passing MIN as
        // clamp's 2nd arg forced the max down to 120px, so every drag snapped
        // to the minimum and the band appeared stuck. Just floor it at MIN.
        return Math.max(top + bottom - GITPANEL_MIN_PX, GITPANEL_MIN_PX)
      }

      const bindPanel = (root) => {
        const onDown = (e) => {
          try {
            if (e.button !== 0) return
            const write = root.querySelector('.dsh-gp-write')
            if (!write) return
            const rect = write.getBoundingClientRect()
            // grip is at the bottom edge; only start a drag near that line (generous hit zone)
            if (Math.abs(e.clientY - rect.bottom) > 14) return
            const startY = e.clientY
            const startTop = rect.height
            const max = maxTopFor(root)
            e.preventDefault()
            e.stopPropagation()
            root.classList.add('enkeep-gp-dragging')
            const onMove = (ev) => {
              applyHeight(root, clamp(startTop + (ev.clientY - startY), max))
            }
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              root.classList.remove('enkeep-gp-dragging')
              try { localStorage.setItem(GITPANEL_SPLIT_KEY, root.style.getPropertyValue(GITPANEL_TOP_H_VAR)) } catch (err) { /* ignore */ }
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          } catch (err) { /* ignore */ }
        }
        const onDouble = (e) => {
          try {
            const write = root.querySelector('.dsh-gp-write')
            if (!write) return
            const rect = write.getBoundingClientRect()
            if (Math.abs(e.clientY - rect.bottom) > 14) return
            e.preventDefault()
            e.stopPropagation()
            resetHeight(root)
          } catch (err) { /* ignore */ }
        }
        root.addEventListener('pointerdown', onDown)
        root.addEventListener('dblclick', onDouble)
        // restore once the panel is laid out (rAF so getBoundingClientRect is valid)
        const saved = readSaved()
        if (saved !== null) {
          try {
            requestAnimationFrame(() => {
              if (root.isConnected) applyHeight(root, clamp(saved, maxTopFor(root)))
            })
          } catch (err) { applyHeight(root, saved) }
        }
        return () => {
          try {
            root.removeEventListener('pointerdown', onDown)
            root.removeEventListener('dblclick', onDouble)
            root.classList.remove('enkeep-gp-dragging')
          } catch (err) { /* ignore */ }
        }
      }

      const sync = () => {
        try {
          const found = document.querySelector('.dsh-gp')
          if (found === gp) return
          if (detachPanel) { detachPanel(); detachPanel = null }
          gp = found
          if (gp) detachPanel = bindPanel(gp)
        } catch (err) { /* ignore */ }
      }

      try {
        const observer = new MutationObserver(sync)
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true })
        disposeObserver = () => observer.disconnect()
      } catch (err) { disposeObserver = null }
      sync()

      return () => {
        if (disposeObserver) disposeObserver()
        if (detachPanel) detachPanel()
        gp = null
        detachPanel = null
      }
    }

    // --- Activity selection (pure) -------------------------------------------
    // 三类命中任一即入选：N 小时内更新 / 运行中 / 未读完成(completionUnread)。
    // 排除 blank、subagent 子行、归档会话。返回按 updatedAt 倒序（最近活动在前）、Id 字典序兜底的有限列表。
    // 会话列表最多显示的会话数：默认 20，可被设置页 activityItemLimit 覆盖。
    // 筛选/排序逻辑：活动时间窗入选 + 按 updatedAt 倒序（Id 兜底） + 置顶优先。
    const DEFAULT_ITEM_LIMIT = 20
    const clampItemLimit = (n) => Number.isFinite(n) ? Math.max(1, Math.min(200, Math.trunc(n))) : DEFAULT_ITEM_LIMIT
    // 下区外派列表独立上限默认 10（与上区会话数互不影响；与 280px 高度匹配）。
    const DEFAULT_DISPATCH_LIMIT = 10
    const clampDispatchLimit = (n) => Number.isFinite(n) ? Math.max(1, Math.min(200, Math.trunc(n))) : DEFAULT_DISPATCH_LIMIT
    function dirName(cwd) {
      if (!cwd) return ''
      const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/)
      return parts[parts.length - 1] || ''
    }
    // Shared label for the activity-bar item and the composer current-session
    // chip: "dir: title", falling back to dir / displayTitle / id when no title.
    function sessionLabel(row, id) {
      const dir = dirName(row && row.cwd)
      const title = row && row.title && row.title.trim()
      return title ? (dir ? dir + ': ' + title : title) : (dir || (row && row.displayTitle) || id)
    }
    // 外派（assistant worker）会话识别。必须与 dsh-assistant 的约定保持一致：
    // 主判据是会话 id 前缀 da-worker-（同步、冷启动可用）；预设为辅助判据，
    // 防御 id 规则变化。字段缺失时用可选链安全降级为"仅前缀"。
    // 注意：这里只判"是否外派会话"；当前/置顶例外在 selectActivity 内处理。
    function isAssistantWorkerSession(id, row) {
      if (!id) return false
      if (id.startsWith('da-worker-')) return true
      const preset = row && row.projectionValues && row.projectionValues.agentPreset
      return preset === 'dsh-assistant-worker'
    }
    function selectActivity(sessions, statuses, archivedIds, hours, now, pinnedSet, itemLimit, activeDerived) {
      const byId = (sessions && sessions.byId) || {}
      const ids = (sessions && sessions.ids) || []
      const archived = archivedIds || new Set()
      const pinned = pinnedSet || new Set()
      const winMs = hours * 3600 * 1000
      // 当前对话：与工作区侧栏高亮同一数据源——mainView 保留引用数 > 0。
      let current = undefined
      for (const id of ids) {
        const row = byId[id]
        if (row && ((row.retainedBy && row.retainedBy.mainView) || 0) > 0) { current = id; break }
      }
      const out = []
      for (const id of ids) {
        const row = byId[id]
        if (!row || row.blank) continue
        if (row.origin === 'subagent') continue
        if (archived.has && archived.has(id)) continue
        const st = (statuses && statuses.get) ? statuses.get(id) : undefined
        const running = (st && st.running !== undefined) ? st.running : row.running
        const unread = !!(st && st.completionUnread === true)
        // 等待用户交互（审批/提问/计划审查）是独立于 running 的官方状态：
        // 此时会话语义上已暂停，但 running 可能仍为 true。漏读它会误画绿脉冲。
        const awaiting = !!(st && st.pendingInteraction !== undefined)
        // 活跃派生任务：主会话自身可能已停（running=false），但仍有 worker 在跑。
        // 数据源是 dsh-assistant 的只读 ?all=1 映射；只认 active/waiting > 0。
        const d = (activeDerived && activeDerived[id]) || null
        const hasActiveDerived = !!(d && ((d.active > 0) || (d.waiting > 0)))
        const recent = (now - (row.updatedAt || 0)) <= winMs
        const isPinned = pinned.has(id)
        // 归档/subagent/blank 已在上面剔除（归档优先：即使置顶也不显示）。
        // 置顶会话锁定常显；等待互动、有活跃派生的会话即使超时也保留——都需要用户注意。
        if (!running && !unread && !recent && !isPinned && !awaiting && !hasActiveDerived) continue
        // state 决定圆点：等待互动 > 运行中 > 完成未看 > 有活跃派生 > 完成已看(未超时)。
        // 只把原本会是 idle 的行提升为 ongoing；awaiting/ongoing/unread 一律不被覆盖。
        // current 是叠加维度（当前通常也是运行中），单独标记。
        const state = awaiting ? 'awaiting' : (running ? 'ongoing' : (unread ? 'unread' : (hasActiveDerived ? 'ongoing' : 'idle')))
        // rawTitle is the actual session title (no directory prefix) — used by the
        // rename dialog so editing never bakes "dir: " into the stored title.
        const rawTitle = (row.title && row.title.trim()) || row.displayTitle || id
        // 外派会话只在下区「当前对话的外派对话」展示，不进上区对话列表——
        // 上区是纯助手/普通对话，避免点外派后上区多出一条、或误把它当主对话。
        // current 沿用上面按 retainedBy.mainView 推出的值，不引入新的全局状态。
        const isCurrent = id === current
        const isWorker = isAssistantWorkerSession(id, row)
        const dispatch = isWorker && !isPinned && !isCurrent
        out.push({ id, state, awaiting, current: isCurrent, pinned: isPinned, dispatch, isWorker, activeDerived: hasActiveDerived, label: sessionLabel(row, id), rawTitle, updatedAt: row.updatedAt || 0 })
      }
      // 排序分两段：置顶区在前，普通区在后；各自按 updatedAt 倒序（最近活动在前），
      // updatedAt 相同时以不可变的 id（session-<uuid>）字典序兜底，保证结果稳定。
      // current 只作高亮/徽标，不排序。
      const byRecentOrder = (a, b) => (b.updatedAt - a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      // 有活跃派生的会话即使 updatedAt 较旧也要排在普通组前面，否则截断时
      // 会被更新的会话挤掉，用户看不到它仍在运行（状态提升被抵消）。
      const byAttention = (a, b) => (Number(!!b.activeDerived) - Number(!!a.activeDerived)) || byRecentOrder(a, b)
      // per-Tab 截断（已拍板的新语义）：先按 dispatch 分成两组，每组各自
      // "置顶优先 + 有活跃派生优先 + updatedAt 倒序"，再各自截 N —— 合计最多 2N。
      // 置顶仍计入所在 Tab 的名额；这与旧的"全区合计 N"语义不同。
      const limit = clampItemLimit(itemLimit)
      const take = (rows) => {
        const pinnedRows = rows.filter((r) => r.pinned).sort(byRecentOrder)
        const normalRows = rows.filter((r) => !r.pinned).sort(byAttention)
        return pinnedRows.concat(normalRows).slice(0, limit)
      }
      return {
        // 上区只留非外派会话（外派一律走下区，置顶/当前例外也一并排除）。
        conversations: take(out.filter((r) => !r.isWorker)),
        dispatch: take(out.filter((r) => r.dispatch)),
        // Derived current (retainedBy.mainView > 0) is published for the lower
        // panel's selection reconciliation; the two groups above are untouched.
        current,
      }
    }

    // --- Sidebar icon component (module-scope stable function) ---------------
    // Rendered inside the owner's clickable PanelRow, so this must be an SVG,
    // not a nested button — the owner handles selectPanel(id) on click.
    function EnkeepSidebarIcon({ size = 18 }) {
      return h('svg', {
        className: 'enkeep-sidebar-icon', 'aria-hidden': true, focusable: false,
        width: size, height: size, viewBox: '0 0 36 36', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M10 6.5h16a1.5 1.5 0 0 1 1.5 1.5v21.2a1 1 0 0 1-1.55.83L18 24.1l-7.95 5.93A1 1 0 0 1 8.5 29.2V8A1.5 1.5 0 0 1 10 6.5Z' }),
        h('path', { d: 'm13.4 15.6 3.1 3.1 6.1-6.1' }))
    }

    // Uniform header icons: one viewBox + stroke width for every glyph, so the
    // new-session / add-workspace / settings / collapse buttons look the same size.
    function HeaderIcon({ kind }) {
      const common = {
        width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      }
      if (kind === 'new') return h('svg', common, h('path', { d: 'M8 3v10M3 8h10' }))
      if (kind === 'workspace') return h('svg', common,
        h('path', { d: 'M3 3h10v10H3z' }), h('path', { d: 'M8 5.5v5M5.5 8h5' }))
      if (kind === 'settings') return h('svg', common,
        h('path', { d: 'M2 4h12M2 8h12M2 12h12' }),
        h('circle', { cx: 5, cy: 4, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 11, cy: 8, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 7, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }))
      if (kind === 'collapse') return h('svg', common, h('path', { d: 'M4 10l4-4 4 4' }))
      if (kind === 'expand') return h('svg', common, h('path', { d: 'M4 6l4 4 4-4' }))
      // Sidebar hide/show: same chevron family, rotated to point left/right.
      if (kind === 'sidebar-hide') return h('svg', common, h('path', { d: 'M10 4L6 8l4 4' }))
      if (kind === 'sidebar-show') return h('svg', common, h('path', { d: 'M6 4l4 4-4 4' }))
      // Row action icons (rename / archive / pin / unpin) — same visual box.
      if (kind === 'rename') return h('svg', common,
        h('path', { d: 'M11.5 2.5l2 2L6 12l-2.5.5L4 10z' }), h('path', { d: 'M10 4l2 2' }))
      if (kind === 'archive') return h('svg', common,
        h('path', { d: 'M2.5 4.5h11v2h-11z' }), h('path', { d: 'M3.5 6.5v6h9v-6' }), h('path', { d: 'M6.5 9h3' }))
      if (kind === 'pin') return h('svg', common,
        h('path', { d: 'M6 2h4l-1 4 2 2v1H5V8l2-2z' }), h('path', { d: 'M8 9v4' }))
      if (kind === 'unpin') return h('svg', common,
        h('path', { d: 'M6 2h4l-1 4 2 2v1H5V8l2-2z' }), h('path', { d: 'M8 9v4' }),
        h('path', { d: 'M2.5 13.5l11-11', stroke: 'currentColor' }))
      if (kind === 'delete') return h('svg', common,
        h('path', { d: 'M3.5 4.5h9' }), h('path', { d: 'M6 4.5V3h4v1.5' }),
        h('path', { d: 'M4.5 4.5l.6 8h5.8l.6-8' }), h('path', { d: 'M6.8 7v3.5M9.2 7v3.5' }))
      return null
    }

    // Header prefix driver. Mounted via an (empty-render) actions-slot registration
    // only to obtain reactive useSessions/sessionId; it writes the workspace-dir
    // prefix into --enkeep-dir-prefix, which HEADER_CSS consumes to prefix the
    // native current crumb. Renders nothing into the header itself (the crumb is
    // restyled in place by CSS). Blank sessions clear the prefix.
    // Known limit: the var is global, so with two split panes on DIFFERENT
    // workspaces the last-mounted pane wins and both crumbs show one prefix.
    // Same-workspace splits (the common case) are unaffected; a per-crumb fix
    // would require imperative DOM writes on native nodes, so we keep this simple.
    function HeaderTitle({ useSessions, sessionId }) {
      const row = typeof useSessions === 'function'
        ? useSessions((s) => (sessionId === void 0 ? void 0 : (s && s.byId) ? s.byId[sessionId] : undefined))
        : void 0
      const dir = (row && !row.blank) ? dirName(row.cwd) : ''
      const prefix = dir ? dir + ': ' : ''
      React.useEffect(() => {
        if (typeof document === 'undefined') return
        // content:var() needs a quoted CSS string; JSON.stringify handles escaping.
        document.documentElement.style.setProperty('--enkeep-dir-prefix', JSON.stringify(prefix))
      }, [prefix])

      // Compact-header layout driver: measure the native title crumb's right edge
      // and the tab strip's content span, then publish them as CSS vars for the
      // compact CSS. Only READS official DOM; never mutates React-owned nodes.
      // getBoundingClientRect() is viewport-based, while CSS left is relative to
      // the containing block (header, made position:relative by compact CSS), so
      // we subtract header.left — otherwise tabs land 280px too far right.
      React.useLayoutEffect(() => {
        if (typeof document === 'undefined') return () => {}
        const root = document.documentElement
        let raf = 0
        let ro = null
        let mo = null
        let tries = 0
        const clear = () => {
          root.style.removeProperty('--enkeep-tabs-left')
          root.style.removeProperty('--enkeep-tabs-shift')
        }
        const measure = () => {
          const crumb = document.querySelector(HDR_CRUMB)
          const header = crumb && crumb.closest('header')
          const tabs = header && header.querySelector('[role="tablist"]')
          const allTabs = tabs ? [...tabs.querySelectorAll('[role="tab"]')] : null
          // Ignore hidden tabs (e.g. trajectory when developer tools are off);
          // a display:none tab has a zero rect and would make the span negative.
          const tabEls = allTabs ? allTabs.filter((t) => t.getBoundingClientRect().width > 0) : null
          if (!crumb || !header || !tabs || !tabEls || !tabEls.length) { clear(); return }
          const first = tabEls[0].getBoundingClientRect()
          const last = tabEls[tabEls.length - 1].getBoundingClientRect()
          // CSS absolute left is relative to the containing block's PADDING box,
          // whose left = header border-box left + padding-left. Subtract both —
          // using only header.left leaves the strip padding-left (20px) too far right.
          const headerPad = parseFloat(getComputedStyle(header).paddingLeft) || 0
          // Match the title→tab gap to the official inter-tab gap (column-gap,
          // normally 36px). tabs' own padding-left already contributes 8px, so
          // add (gap - tabPadLeft) to shift the strip right by the remainder.
          const tabPad = parseFloat(getComputedStyle(tabs).paddingLeft) || 0
          const gap = parseFloat(getComputedStyle(tabs).columnGap) || 36
          const lead = Math.max(0, gap - tabPad)
          const left = Math.round(crumb.getBoundingClientRect().right - header.getBoundingClientRect().left - headerPad + lead)
          // Span is stable whether tabs are block/absolute; push actions by the
          // same lead so tabs→actions keeps the same breathing room as title→tab.
          const shift = Math.round(last.right - first.left) + 34 + lead
          root.style.setProperty('--enkeep-tabs-left', left + 'px')
          root.style.setProperty('--enkeep-tabs-shift', shift + 'px')
        }
        const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
        const setup = () => {
          const crumb = document.querySelector(HDR_CRUMB)
          const header = crumb && crumb.closest('header')
          const tabs = header && header.querySelector('[role="tablist"]')
          if (!crumb || !header || !tabs) {
            if (tries++ < 60) raf = requestAnimationFrame(setup)
            return
          }
          measure()
          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(schedule)
            ro.observe(tabs)
            ro.observe(header)
          }
          if (typeof MutationObserver !== 'undefined') {
            mo = new MutationObserver(schedule)
            mo.observe(crumb, { childList: true, characterData: true, subtree: true })
          }
        }
        raf = requestAnimationFrame(setup)
        return () => {
          if (raf) cancelAnimationFrame(raf)
          if (ro) ro.disconnect()
          if (mo) mo.disconnect()
          clear()
        }
      }, [])
      return null
    }

    // --- Header task-stats chip (dsh-assistant derived tasks) ----------------
    // Additive, read-only summary of the CURRENT session's derived tasks. Data
    // comes from dsh-assistant's soft-mounted GET /dsh-assistant-tasks/stats
    // behind a custom header. Soft constraint (plan decision 4b): the client
    // only ever sends its own props.sessionId — never a target from config or
    // UI; the route itself is public and unauthenticated.
    const TASKSTATS_URL = '/dsh-assistant-tasks/stats'
    const TASKSTATS_HEADER = 'x-dsh-assistant-stats'
    const TASKSTATS_POLL_MS = 5000
    const TASKSTATS_STYLE_ID = 'enkeep-task-stats'
    const TASKSTATS_CSS = [
      // Narrow-window hardening (A14): the chip may shrink below its text width
      // instead of pushing crumbs out; the label ellipsizes on ONE line so the
      // 24px height / no-wrap predicate still holds. title= keeps full text.
      '[data-enkeep-taskstats]{display:inline-flex;align-items:center;flex:0 1 auto;min-width:0;',
      'height:24px;box-sizing:border-box;padding:0 8px;border-radius:12px;',
      'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));',
      'color:var(--dsw-alias-label-secondary);font-size:12px;line-height:24px;',
      'white-space:nowrap;max-width:100%;overflow:hidden;}',
      '[data-enkeep-taskstats-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;}',
      '[data-enkeep-taskstats-dot]{width:6px;height:6px;border-radius:50%;',
      'background:#3fb950;flex:none;margin-right:5px;}',
    ].join('\n')

    function installTaskStatsStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${TASKSTATS_STYLE_ID}"]`)
      if (existing) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-enkeep'
      style.dataset.pluginCss = TASKSTATS_STYLE_ID
      style.textContent = TASKSTATS_CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    // Factory-scope store: single-flight (one request in flight at a time),
    // seq guard (stale responses never overwrite a newer value), AbortController
    // for unmount/hide. These are shared by all mounted chips on purpose.
    const taskStatsSeq = { n: 0 }
    const taskStatsInFlight = { ctrl: null }
    const EMPTY_TASK_STATS = { active: 0, waiting: 0, ended24h: 0, hasStats: false }

    async function fetchTaskStats(sessionId, signal) {
      try {
        const q = sessionId ? ('?sessionId=' + encodeURIComponent(sessionId)) : ''
        const res = await fetch(TASKSTATS_URL + q, {
          headers: { [TASKSTATS_HEADER]: '1' },
          cache: 'no-store',   // 5s polling: never let an HTTP cache freeze the counts
          signal,
        })
        if (!res || !res.ok) return EMPTY_TASK_STATS
        const data = await res.json()
        if (!data || typeof data !== 'object') return EMPTY_TASK_STATS
        const n = (v) => Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0
        const active = n(data.active), waiting = n(data.waiting), ended24h = n(data.ended24h)
        return { active, waiting, ended24h, hasStats: active > 0 || waiting > 0 || ended24h > 0 }
      } catch (e) {
        // AbortError (hide/unmount) and fetch failure / 404 both degrade to hidden.
        // No error logging: assistant being absent is a supported state (A15).
        return EMPTY_TASK_STATS
      }
    }

    function AssistantTaskStats({ sessionId }) {
      const [stats, setStats] = React.useState(EMPTY_TASK_STATS)
      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof fetch !== 'function') return () => {}
        let disposed = false
        let timer = null
        let ownCtrl = null

        const tick = async () => {
          if (disposed || taskStatsInFlight.ctrl) return  // single flight
          const seq = ++taskStatsSeq.n
          const ctrl = new AbortController()
          taskStatsInFlight.ctrl = ctrl
          ownCtrl = ctrl
          const data = await fetchTaskStats(sessionId, ctrl.signal)
          if (taskStatsInFlight.ctrl === ctrl) taskStatsInFlight.ctrl = null
          if (!disposed && seq === taskStatsSeq.n) setStats(data)  // seqRef guard
        }

        const onVisible = () => {
          if (typeof document === 'undefined') return
          if (document.hidden) {
            if (timer) { clearInterval(timer); timer = null }
            if (ownCtrl) { ownCtrl.abort(); ownCtrl = null }
          } else {
            tick()  // refresh immediately when the page becomes visible
            if (!timer) timer = setInterval(tick, TASKSTATS_POLL_MS)
          }
        }

        tick()  // first fetch on mount
        if (!document.hidden && !timer) timer = setInterval(tick, TASKSTATS_POLL_MS)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          disposed = true
          if (timer) { clearInterval(timer); timer = null }
          if (ownCtrl) { ownCtrl.abort(); ownCtrl = null }
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [sessionId])

      // Decision 4c: hide only when ALL three counts are 0 (no grey "0").
      if (!stats.hasStats) return null
      const label = '派生任务 活跃' + stats.active + ' · 待决' + stats.waiting + ' · 近24h终态' + stats.ended24h
      return h('span', {
        'data-enkeep-taskstats': true,
        title: label,   // full text stays available when the label ellipsizes
      },
        stats.active > 0 ? h('span', { 'data-enkeep-taskstats-dot': true }) : null,
        h('span', { 'data-enkeep-taskstats-label': true }, label))
    }

    // --- Active-derived sessions store (read-only ?all=1 stats) ---------------
    // One factory-scope singleton shared by every ActivityBar: a single 5s poll
    // fetches per-source-session ACTIVE derived-task counts, so an assistant row
    // whose own agent stopped can still show as ongoing while its workers run.
    // Same single-flight / seq / abort / visibility discipline as AssistantTaskStats.
    const DERIVED_ALL_URL = '/dsh-assistant-tasks/stats?all=1'
    const derivedAllSeq = { n: 0 }
    const derivedAllInFlight = { ctrl: null }
    const EMPTY_DERIVED = { sessions: {} }

    function createDerivedActivityStore() {
      let state = EMPTY_DERIVED
      const listeners = new Set()
      const getSnapshot = () => state
      const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
      const commit = (next) => { state = next; for (const fn of listeners) fn() }

      async function fetchAll(signal) {
        try {
          const res = await fetch(DERIVED_ALL_URL, {
            headers: { [TASKSTATS_HEADER]: '1' }, cache: 'no-store', signal,
          })
          if (!res || !res.ok) return EMPTY_DERIVED
          const data = await res.json()
          if (!data || data.ok !== true || !data.sessions || typeof data.sessions !== 'object' || Array.isArray(data.sessions)) return EMPTY_DERIVED
          const sessions = {}
          for (const sid of Object.keys(data.sessions)) {
            const row = data.sessions[sid]
            if (!row || typeof row !== 'object') continue
            const active = Number.isFinite(row.active) ? Math.max(0, Math.trunc(row.active)) : 0
            const waiting = Number.isFinite(row.waiting) ? Math.max(0, Math.trunc(row.waiting)) : 0
            if (active > 0 || waiting > 0) sessions[sid] = { active, waiting }
          }
          return { sessions }
        } catch (e) {
          // Abort / 404 / assistant absent → no highlight (supported state).
          return EMPTY_DERIVED
        }
      }

      let started = false
      const start = () => {
        if (started || typeof document === 'undefined' || typeof fetch !== 'function') return () => {}
        started = true
        let timer = null
        let ownCtrl = null
        let disposed = false
        const tick = async () => {
          if (disposed || derivedAllInFlight.ctrl) return  // single flight
          const seq = ++derivedAllSeq.n
          const ctrl = new AbortController()
          derivedAllInFlight.ctrl = ctrl
          ownCtrl = ctrl
          const data = await fetchAll(ctrl.signal)
          if (derivedAllInFlight.ctrl === ctrl) derivedAllInFlight.ctrl = null
          if (!disposed && seq === derivedAllSeq.n) commit(data)
        }
        const onVisible = () => {
          if (document.hidden) {
            if (timer) { clearInterval(timer); timer = null }
            if (ownCtrl) { ownCtrl.abort(); ownCtrl = null }
          } else {
            tick()
            if (!timer) timer = setInterval(tick, TASKSTATS_POLL_MS)
          }
        }
        tick()  // first fetch on mount
        if (!document.hidden && !timer) timer = setInterval(tick, TASKSTATS_POLL_MS)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          disposed = true
          if (timer) { clearInterval(timer); timer = null }
          if (ownCtrl) { ownCtrl.abort(); ownCtrl = null }
          document.removeEventListener('visibilitychange', onVisible)
          started = false
        }
      }
      return { subscribe, getSnapshot, start }
    }

    // --- Lower panel: read-only sessions bridge + cross-render ----------------
    // Data comes from dsh-assistant's soft-mounted GET /dsh-assistant-tasks/sessions
    // behind a custom header. Same factory-scope single-flight / seq / abort
    // trio as AssistantTaskStats, but bound to the currently selected session.
    const DISPATCH_SESSIONS_URL = '/dsh-assistant-tasks/sessions'
    const DISPATCH_SESSIONS_HEADER = 'x-dsh-assistant-sessions'
    const dispatchSeq = { n: 0 }
    const dispatchInFlight = { ctrl: null }

    async function fetchDispatchSessions(selectedId, signal) {
      try {
        const res = await fetch(DISPATCH_SESSIONS_URL + '?sessionId=' + encodeURIComponent(selectedId), {
          headers: { [DISPATCH_SESSIONS_HEADER]: '1' },
          cache: 'no-store',
          signal,
        })
        if (!res || !res.ok) return []
        const data = await res.json()
        if (!data || data.ok !== true || !Array.isArray(data.workerSessionIds)) return []
        return data.workerSessionIds.filter((id) => typeof id === 'string' && id.length > 0)
      } catch (e) {
        // Abort / 404 / assistant absent all degrade to "no dispatch" (empty state).
        return []
      }
    }

    function DispatchPanel({ selectedId, selectedIdRef, isAssistant, registerClear,
      sessions, statuses, archivedIds, lowerCollapsed, onToggleLower, dispatchLimit,
      activeWorkerId, onOpenWorker }) {
      // Issue ④: sessions/statuses snapshots are subscribed ONCE in ActivityBar
      // and passed down. A child re-renders together with its parent, so the
      // cross-render result is byte-for-byte identical without two extra (s)=>s
      // subscriptions here.
      const [workerIds, setWorkerIds] = React.useState([])
      // Issue ②: monotonic nonce. clearNow() is invoked synchronously on every
      // selection (row click / derived-current correction); bumping it here keeps
      // the fetch effect running even when the same id is clicked again, so the
      // just-cleared panel is never left in a false empty state.
      const [fetchNonce, setFetchNonce] = React.useState(0)
      const seqRef = React.useRef(dispatchSeq)

      // Registered with ActivityBar: its row onClick calls this SYNCHRONOUSLY,
      // before the async fetch, so old rows vanish in the same render frame and
      // any in-flight response is invalidated before a new one is issued.
      const clearNow = React.useCallback(() => {
        seqRef.current.n += 1
        if (dispatchInFlight.ctrl) {
          try { dispatchInFlight.ctrl.abort() } catch {}
          dispatchInFlight.ctrl = null
        }
        setWorkerIds([])
        setFetchNonce((n) => n + 1)
      }, [])
      React.useEffect(() => {
        if (typeof registerClear === 'function') registerClear(clearNow)
        return () => { if (typeof registerClear === 'function') registerClear(null) }
      }, [registerClear, clearNow])

      React.useEffect(() => {
        // No selection / non-assistant session: pure blank, no request (§1.2).
        if (!selectedId || !isAssistant) { setWorkerIds([]); return () => {} }
        // Issue ③ (plan step 4(a)#4): collapsing the lower panel must abort.
        // Changing lowerCollapsed first runs the previous effect's cleanup,
        // which sets disposed=true and aborts any in-flight request; a late
        // response is therefore discarded. Keep already-fetched ids so expanding
        // restores the original rows (step 5), then the next run re-fetches.
        if (lowerCollapsed) return () => {}
        let disposed = false
        const expectedSelectedId = selectedId
        const seq = ++seqRef.current.n
        if (dispatchInFlight.ctrl) { try { dispatchInFlight.ctrl.abort() } catch {} }
        const ctrl = new AbortController()
        dispatchInFlight.ctrl = ctrl
        ;(async () => {
          const data = await fetchDispatchSessions(expectedSelectedId, ctrl.signal)
          if (dispatchInFlight.ctrl === ctrl) dispatchInFlight.ctrl = null
          // Four gates: alive + newest seq + still this session + still assistant.
          if (disposed || seq !== seqRef.current.n) return
          if (expectedSelectedId !== (selectedIdRef && selectedIdRef.current)) return
          if (!isAssistant) return
          setWorkerIds(data)
        })()
        return () => {
          disposed = true
          try { ctrl.abort() } catch {}
          if (dispatchInFlight.ctrl === ctrl) dispatchInFlight.ctrl = null
        }
        // selectedIdRef is a stable ref (only its .current changes), kept in the
        // deps so the gate closure always reads the latest value; fetchNonce is
        // the explicit re-fetch trigger for repeated clicks on the same row (②).
      }, [selectedId, isAssistant, selectedIdRef, fetchNonce, lowerCollapsed])

      // Auto-refresh the lower panel for background worker creation/termination.
      // The fetch effect above is driven only by selection/click/collapse, so a
      // worker created in the background never appears until the user interacts.
      // Mirror AssistantTaskStats' visible-only 5s polling, but WITHOUT an
      // initial tick: the effect above already runs once on mount, so an extra
      // tick here would double-fetch. Only bump fetchNonce — the fetch effect
      // above owns single-flight / seq gates / AbortController; this effect
      // never aborts or issues a request itself.
      const DISPATCH_POLL_MS = 5000
      React.useEffect(() => {
        if (!selectedId || !isAssistant || lowerCollapsed) return () => {}
        if (typeof document === 'undefined') return () => {}
        let timer = null
        const tick = () => setFetchNonce((n) => n + 1)
        const onVisible = () => {
          if (document.hidden) {
            if (timer) { clearInterval(timer); timer = null }
          } else {
            tick()
            if (!timer) timer = setInterval(tick, DISPATCH_POLL_MS)
          }
        }
        if (!document.hidden) timer = setInterval(tick, DISPATCH_POLL_MS)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          if (timer) { clearInterval(timer); timer = null }
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [selectedId, isAssistant, lowerCollapsed])

      // Non-assistant mode (or no selection yet) is pure blank: no rows, no
      // empty-state text, no request (the effect above already skipped it).
      if (!selectedId || !isAssistant) return null

      const byId = (sessions && sessions.byId) || {}
      const archived = archivedIds || new Set()
      // 先收集全部有效外派行（带 updatedAt），按最后活动时间倒序排序后再按独立上限
      // 截断——保证显示的是「最近活动」的 N 个，而不是接口返回顺序的前 N 个。
      const allRows = []
      for (const id of workerIds) {
        if (typeof id !== 'string' || !id) continue
        const row = byId[id]
        if (!row || row.blank || row.origin === 'subagent' || archived.has(id)) continue
        // Same dot logic as selectActivity (kept inline so the upper group's
        // filtering/sorting/truncation semantics stay byte-for-byte unchanged).
        const st = statuses && statuses.get ? statuses.get(id) : undefined
        const running = (st && st.running !== undefined) ? st.running : row.running
        const unread = !!(st && st.completionUnread === true)
        const awaiting = !!(st && st.pendingInteraction !== undefined)
        const state = awaiting ? 'awaiting' : (running ? 'ongoing' : (unread ? 'unread' : 'idle'))
        allRows.push({ id, state, label: sessionLabel(row, id), updatedAt: row.updatedAt || 0 })
      }
      // 排序口径与 selectActivity 的 byRecentOrder 一致：updatedAt 倒序、Id 字典序兜底。
      allRows.sort((a, b) => (b.updatedAt - a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const rows = allRows.slice(0, clampDispatchLimit(dispatchLimit))

      return h('div', { 'data-enkeep-dispatch-panel': true },
        h('div', { 'data-enkeep-dispatch-head': true },
          h('span', null, '当前对话的外派对话'),
          h('span', { 'data-enkeep-dispatch-count': true }, rows.length + ' 条'),
          h('button', {
            type: 'button',
            'data-enkeep-dispatch-toggle': true,
            'aria-expanded': !lowerCollapsed,
            title: lowerCollapsed ? '展开外派对话' : '收起外派对话',
            'aria-label': lowerCollapsed ? '展开外派对话' : '收起外派对话',
            onClick: onToggleLower,
          }, h(HeaderIcon, { kind: lowerCollapsed ? 'expand' : 'collapse' }))),
        !lowerCollapsed && (rows.length
          ? h('div', { 'data-enkeep-dispatch-list': true }, rows.map((it) =>
              h('div', {
                key: it.id,
                'data-enkeep-dispatch-item': true,
                'data-enkeep-dispatch-current': it.id === activeWorkerId ? true : undefined,
              },
                h('button', {
                  type: 'button',
                  'data-enkeep-dispatch-main': true,
                  title: it.label,
                  onClick: () => onOpenWorker(it.id),
                },
                  h('span', { 'data-enkeep-dispatch-dot': it.state }),
                  h('span', { 'data-enkeep-dispatch-label': true }, it.label)))))
          : h('div', { 'data-enkeep-dispatch-empty': true }, '当前对话暂无外派')))
    }

    // Above-composer dock: current-session plain label (left) + high-frequency
    // prompt buttons (right, same row). `useSessions`/`sessionId`/`useInput`/
    // `inputActions` are standard props auto-injected into session-scope slots.
    // `form` is supplied via inject so the quick row can read quickPromptCount.
    function ComposerDock({ form, useSessions, sessionId, useInput, inputActions }) {
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      // The current-session label now lives in the conversation header only;
      // this dock keeps just the quick-prompt row. useSessions/sessionId are
      // still forwarded to QuickPrompts.
      const showWords = (form.getSnapshot().value || {}).showCommonWords !== false
      const quick = showWords ? h(QuickPrompts, { form, useInput, inputActions, useSessions, sessionId }) : null
      if (!quick) return null
      return h('div', { 'data-enkeep-composer-current': true }, quick)
    }

    // --- Activity bar: always-on floating strip of active sessions -----------
    // Standard hook props (useSessions/useSessionStatus/useWorkspaces) are injected
    // by the renderer into every shell.overlay slot component — no service inject.
    // Draggable position is stored enkeep-owned. {x,y} is a pixel offset applied
    // on top of the default CSS position via transform, so default placement stays
    // identical until the user drags; double-click the header resets to {0,0}.
    const ACTIVITY_POS_KEY = 'dsh.enkeep.activity.pos.v1'
    function readActivityPos() {
      try {
        const raw = localStorage.getItem(ACTIVITY_POS_KEY)
        const v = raw ? JSON.parse(raw) : null
        if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y }
      } catch (e) { /* ignore */ }
      return { x: 0, y: 0 }
    }
    function writeActivityPos(p) {
      try { localStorage.setItem(ACTIVITY_POS_KEY, JSON.stringify(p)) } catch (e) { /* ignore */ }
    }

    // Web 侧边栏"完全隐藏"开关（独立于原生收起/展开）：记住用户选择，刷新后保持。
    const SIDEBAR_HIDE_KEY = 'dsh.enkeep.sidebar.hidden.v1'
    function readSidebarHidden() {
      try { return localStorage.getItem(SIDEBAR_HIDE_KEY) === '1' } catch (e) { return false }
    }
    function writeSidebarHidden(v) {
      try { localStorage.setItem(SIDEBAR_HIDE_KEY, v ? '1' : '0') } catch (e) { /* ignore */ }
    }
    // 从 shell.bottom 反查 AppFrame（bottomRow 是 frame 的直接子节点，带稳定 data 钩子）。
    function getAppFrame() {
      const bottom = typeof document !== 'undefined' && document.querySelector('[data-shell-bottom]')
      return bottom && bottom.parentElement ? bottom.parentElement : null
    }
    // 把 frame 内联 grid-template-columns 的「侧栏列」改成 0px。
    // 官方默认布局（sb-01 补丁已卸载）列顺序 = sidebar|center|rightbar，
    // 侧栏是第一列，形如 "280px minmax(0px, 1fr) minmax(0px, 0px)"。
    // 旧实现把「最后一段 px」当成侧栏——那是侧栏移右时的顺序；如今末段是
    // minmax(0px, 0px)（带括号），正则匹配不到 → 返回 null → 按钮完全失效。
    // 新版只压第一列（侧栏），并要求它是纯 px 宽度才动手，避免误伤轨道。
    // React 内联值始终是原生宽度，我们的覆盖在样式表里用 !important，互不污染。
    function sidebarGridWithZeroTrack(frame) {
      const gtc = frame && frame.style ? frame.style.gridTemplateColumns : ''
      const tracks = String(gtc || '').trim().split(/\s+/)
      if (!tracks.length || !/^\d+px$/.test(tracks[0])) return null
      tracks[0] = '0px'
      return tracks.join(' ')
    }

    // Enkeep-private pinned SessionId set (drives activity-bar pinned zone + lock).
    // Independent of the official registry pin set: we only call official pin/unpin.
    const ACTIVITY_PINNED_KEY = 'dsh.enkeep.activity.pinned.v1'
    function readPinned() {
      try {
        const raw = localStorage.getItem(ACTIVITY_PINNED_KEY)
        const v = raw ? JSON.parse(raw) : null
        if (Array.isArray(v)) return v.filter((x) => typeof x === 'string')
      } catch (e) { /* ignore */ }
      return []
    }
    function writePinned(ids) {
      try { localStorage.setItem(ACTIVITY_PINNED_KEY, JSON.stringify(ids)) } catch (e) { /* ignore */ }
    }

    // Strip markdown / @mentions / slash-command prefixes down to readable plain
    // text for the one-line prompt bar. Conservative on purpose: never parse or
    // execute content, just remove the common wrappers and collapse whitespace.
    function cleanPromptText(raw) {
      let text = String(raw == null ? '' : raw).replace(/\r/g, '')
      text = text.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
      text = text.replace(/^[>#*+`\-]+\s*/, '')            // leading markdown markers
      text = text.replace(/\*\*|__|`/g, '')                 // inline bold/code marks
      text = text.replace(/@[^\s@#]+/g, '')                 // @mentions / @file refs
      text = text.replace(/^\/[A-Za-z][\w-]*\s*/, '')       // leading /command
      text = text.replace(/\s+/g, ' ').trim()
      return text
    }

    // LastPromptDockBar: a full-width row in the conversation.input.dock LIST
    // slot (same additive slot as the git branch chip and task progress bar),
    // so the official layout stacks us in normal document flow — no absolute
    // positioning, never overlapping other plugins. Width/centering matches the
    // composer card via CSS. A MutationObserver on <body> only READS the official
    // DOM text into this component's own state; it never mutates React nodes.
    function LastPromptDockBar() {
      const [text, setText] = React.useState('')
      const textRef = React.useRef('')
      const rafRef = React.useRef(null)

      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
        const scan = () => {
          const nodes = document.querySelectorAll('[data-slot="conversation.chat.flow"] [data-chat-flow-kind="user"]')
          const last = nodes.length ? nodes[nodes.length - 1] : null
          let next = ''
          if (last) {
            // Strip the UI chrome ([data-clock] timestamp) from a detached clone;
            // never mutate the original React-owned node.
            const clone = last.cloneNode(true)
            clone.querySelectorAll('[data-clock]').forEach((n) => n.remove())
            next = cleanPromptText(clone.textContent || last.innerText || '')
          }
          if (next !== textRef.current) { textRef.current = next; setText(next) }
        }
        const schedule = () => {
          if (rafRef.current != null) return
          rafRef.current = requestAnimationFrame(() => { rafRef.current = null; scan() })
        }
        const observer = new MutationObserver((records) => {
          // Ignore our own text/style writes (and <head> style injection) so the
          // observer cannot self-trigger an update loop.
          const onlySelf = records.every((rec) => {
            const t = rec.target
            return (t && t.closest && t.closest('[data-enkeep-lastprompt]')) ||
              (t && t.parentNode && t.parentNode.nodeName === 'HEAD')
          })
          if (!onlySelf) schedule()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        scan() // initial paint
        return () => {
          observer.disconnect()
          if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
        }
      }, [])

      if (!text) return null // blank session: render nothing, leave no gap
      const copy = (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
        const value = textRef.current
        // Capture the button synchronously: React nulls out synthetic event
        // fields (currentTarget) before async callbacks (.then / setTimeout) run.
        const btn = e && e.currentTarget
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          if (!btn) return
          const old = btn.textContent
          btn.textContent = '已复制'
          if (typeof setTimeout === 'function') setTimeout(() => { btn.textContent = old }, 1200)
        }
        // Legacy fallback (execCommand) covers contexts where the async Clipboard
        // API is blocked or its promise never settles (e.g. headless browsers).
        const fallback = () => {
          if (settled) return
          try {
            const ta = document.createElement('textarea')
            ta.value = value
            ta.setAttribute('readonly', '')
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;'
            document.body.appendChild(ta)
            ta.select()
            const ok = document.execCommand && document.execCommand('copy')
            ta.remove()
            if (ok) done()
          } catch (err) { settled = true /* give up silently */ }
        }
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(done, fallback)
            if (typeof setTimeout === 'function') setTimeout(fallback, 600)
          } else fallback()
        } catch (err) { fallback() }
      }
      return h('div', { 'data-enkeep-lastprompt': '', 'data-enkeep-reveal-host': true },
        h('div', { 'data-enkeep-lastprompt-inner': '' },
          h('span', { 'data-enkeep-lastprompt-label': '' }, '上一条指令'),
          h('div', { 'data-enkeep-lastprompt-text': '' }, text),
          h('button', {
            'data-enkeep-lastprompt-copy': '',
            'data-enkeep-reveal': true,
            type: 'button',
            title: '复制上一条指令',
            onClick: copy,
          }, '复制')
        )
      )
    }

    function ActivityBar({ form, openSession, newSession, addWorkspace, openSettings, pinSession, unpinSession, archiveSession, renameSession, deleteWorkspace, useSessions, useSessionStatus, useWorkspaces }) {
      // 活动区 tab：第一个是对话（原列表），第二个是工作区；选中态只影响 +A/+S 新会话目录。
      const [activityTab, setActivityTab] = React.useState('conversations')
      const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState(false)
      // 下区（当前对话的外派对话）独立收起态，与上区 collapsed 互不干扰。
      const [lowerCollapsed, setLowerCollapsed] = React.useState(false)
      // 下区唯一驱动源：selectedId。同步 ref 保证同一帧连点读到最新值；
      // clearLower 由 DispatchPanel 注册，点击行时同步清空下区（防串数据第一道闸）。
      const [selectedId, setSelectedId] = React.useState(null)
      const selectedIdRef = React.useRef(null)
      // 下区「当前外派」与 selectedId（助手对话）解耦：点击外派只改高亮、打开会话，
      // 不动上区选中态也不清下区列表，保证在一个助手对话下能连续查看全部外派。
      const [activeWorkerId, setActiveWorkerId] = React.useState(null)
      const clearLowerRef = React.useRef(null)
      const registerLowerClear = React.useCallback((fn) => { clearLowerRef.current = fn }, [])
      const clearLower = () => {
        if (typeof clearLowerRef.current === 'function') clearLowerRef.current()
      }
      const [sidebarHidden, setSidebarHidden] = React.useState(readSidebarHidden)
      const [, setTick] = React.useState(0)
      const [hours, setHours] = React.useState(24)
      const [itemLimit, setItemLimit] = React.useState(DEFAULT_ITEM_LIMIT)
      const [dispatchLimit, setDispatchLimit] = React.useState(DEFAULT_DISPATCH_LIMIT)
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)
      const [pos, setPos] = React.useState(readActivityPos)
      const [dragging, setDragging] = React.useState(false)
      const dragRef = React.useRef(null)
      // Pinned set + dialogs (row actions).
      const [pinned, setPinnedState] = React.useState(readPinned)
      // Synchronous mirror of the committed pinned list. React state updates are
      // async, so two pin clicks landing in one render frame would both read the
      // stale `pinned` snapshot and overwrite each other (only one stayed pinned).
      // Every mutation goes through commitPinned, which keeps ref + state + disk
      // in lockstep; reads that must see the latest value use pinnedRef.current.
      const pinnedRef = React.useRef(pinned)
      const [confirmArchive, setConfirmArchive] = React.useState(null) // { id, title }
      const [stopArchiveTarget, setStopArchiveTarget] = React.useState(null) // { id, title } — running session
      const [archiveError, setArchiveError] = React.useState(null) // string
      // Workspace deletion: confirm target + visible failure (never silent).
      const [confirmWorkspaceDelete, setConfirmWorkspaceDelete] = React.useState(null) // { workspaceId, title }
      const [workspaceDeleteError, setWorkspaceDeleteError] = React.useState(null) // string
      const [renameTarget, setRenameTarget] = React.useState(null) // { id, title }
      const [renameDraft, setRenameDraft] = React.useState('')
      const [renameError, setRenameError] = React.useState('')
      const commitPinned = (ids) => {
        pinnedRef.current = ids
        setPinnedState(ids)
        writePinned(ids)
      }
      // Archive success must drop the id from our pinned set even across a slow
      // async call — read the ref so a stale `pinned` closure can't resurrect it.
      const unpinLocal = (id) => {
        commitPinned(pinnedRef.current.filter((x) => x !== id))
      }
      // Official marks a running-session archive refusal with a stable error name
      // + rpc code (bundles don't share error-class identity) — detect by field.
      const isSessionActiveError = (err) => {
        if (!err || typeof err !== 'object') return false
        const rpc = err.rpcError || {}
        return rpc.code === 'workspace/session-active'
      }
      const errMessage = (err, fallback) => (err && err.message ? err.message : fallback)

      // Run a header action with a shared busy guard (ref: immune to rapid double-clicks).
      const runAction = (fn) => async () => {
        if (busyRef.current || typeof fn !== 'function') return
        busyRef.current = true
        setBusy(true)
        try { await fn() } catch (error) { console.warn('[enkeep] activity action failed', error) } finally { busyRef.current = false; setBusy(false) }
      }

      // Re-render when the config form changes (window hours / item limit).
      const readLimits = () => {
        const val = (form.getSnapshot().value || {})
        const h = Number(val.activityWindowHours)
        setHours(Number.isFinite(h) && h >= 1 ? h : 24)
        const n = Number(val.activityItemLimit)
        setItemLimit(Number.isFinite(n) && n >= 1 && n <= 200 ? Math.trunc(n) : DEFAULT_ITEM_LIMIT)
        const d = Number(val.dispatchItemLimit)
        setDispatchLimit(Number.isFinite(d) && d >= 1 && d <= 200 ? Math.trunc(d) : DEFAULT_DISPATCH_LIMIT)
      }
      React.useEffect(() => form.subscribe(readLimits), [form])
      React.useEffect(() => { readLimits() }, [form])

      // Time-window sessions must fall out on their own: re-evaluate each minute
      // and whenever the window regains focus. Dispose both on unmount (HMR safe).
      React.useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), 60000)
        const onFocus = () => setTick((n) => n + 1)
        window.addEventListener('focus', onFocus)
        return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
      }, [])

      // Web 侧边栏完全隐藏（纯声明式）：只打 DOM/CSS 标记，不调用原生 toggleSidebar。
      // 原生状态保持不动 → 没有双切/异步属性滞后/卸载误恢复等问题；“显示”即移除标记、
      // 精确回到用户原来的状态（展开还是 56px 图标栏都保持原样）。拖拽手柄用 CSS 隐藏。
      React.useEffect(() => {
        if (!sidebarHidden || typeof document === 'undefined') return undefined
        const frame = getAppFrame()
        if (!frame) return undefined

        // 解析不出列宽就不打标记（宁可不隐藏），避免 CSS fallback 误伤右栏轨道。
        const initial = sidebarGridWithZeroTrack(frame)
        if (!initial) return undefined

        // 定位真正的侧栏列：官方布局里它是 frame 的直接子元素、class 含
        // "sidebarCol"（索引 0）。旧代码用 bottom.previousElementSibling，在
        // sb-01「侧栏在右」时代侥幸正确；卸载后它指向 rightbarCol——标记打错
        // 目标。改为按稳定语义查找，不依赖它在第几列。
        const sidebarCol = [...frame.children].find(
          (c) => typeof c.className === 'string' && c.className.includes('sidebarCol'))
        if (sidebarCol) sidebarCol.setAttribute('data-enkeep-sidebar-col', '')

        const sync = () => {
          const next = sidebarGridWithZeroTrack(frame)
          if (next && frame.style.getPropertyValue('--dsh-enkeep-grid-cols') !== next) {
            frame.style.setProperty('--dsh-enkeep-grid-cols', next)
          }
        }
        sync()
        frame.setAttribute('data-enkeep-sidebar-hidden', '')

        // 原生重绘（缩放/右侧栏开合/拖动）会改写内联列宽，跟随重算变量。
        const obs = new MutationObserver(() => {
          if (frame.hasAttribute('data-enkeep-sidebar-hidden')) sync()
        })
        obs.observe(frame, { attributes: true, attributeFilter: ['style'] })

        return () => {
          obs.disconnect()
          frame.removeAttribute('data-enkeep-sidebar-hidden')
          frame.style.removeProperty('--dsh-enkeep-grid-cols')
          if (sidebarCol) sidebarCol.removeAttribute('data-enkeep-sidebar-col')
        }
      }, [sidebarHidden])

      // Ref mirror: no side effect inside the state updater (StrictMode double-invoke),
      // and rapid double-clicks always flip from the latest committed value.
      const sidebarHiddenRef = React.useRef(sidebarHidden)
      const onToggleSidebarHide = () => {
        const next = !sidebarHiddenRef.current
        sidebarHiddenRef.current = next
        writeSidebarHidden(next)
        setSidebarHidden(next)
      }

      // Drag the bar by its header. Pointer listeners live on window for the
      // duration of a drag so the cursor can leave the element; cleaned up on
      // pointerup and on unmount (HMR safe).
      React.useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current
          if (!d) return
          const next = { x: d.px + (e.clientX - d.cx), y: d.py + (e.clientY - d.cy) }
          setPos(next)
          writeActivityPos(next)
        }
        const onUp = () => {
          if (!dragRef.current) return
          dragRef.current = null
          setDragging(false)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }, [])
      const onDragStart = (e) => {
        if (e.button !== 0) return
        // Let header buttons (new / workspace / settings / collapse) work normally.
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return
        dragRef.current = { cx: e.clientX, cy: e.clientY, px: pos.x, py: pos.y }
        setDragging(true)
        if (typeof e.preventDefault === 'function') e.preventDefault()
      }
      const resetPos = (e) => {
        if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return
        const zero = { x: 0, y: 0 }
        setPos(zero)
        writeActivityPos(zero)
      }

      // --- Row actions: pin / archive / rename ---
      // Debounce entry points: official calls are fire-and-forget (busyRef is
      // released synchronously), so a timestamp guard stops rapid re-clicks from
      // issuing duplicate pin/archive/rename calls. Dialog confirm buttons use
      // busyRef only (they are one-shot and unmount on action).
      const lastRowActionRef = React.useRef({ key: '', at: 0 })
      const rowActionGuard = (key) => {
        const t = Date.now()
        const last = lastRowActionRef.current
        if (busyRef.current) return false
        if (last.key === key && t - last.at < 300) return false
        lastRowActionRef.current = { key, at: t }
        return true
      }
      // Pin is a paired action: always call the official service AND update our
      // private pinned set. Failures on the official side are non-fatal (warn).
      // Use the synchronous ref as the source of truth so rapid clicks on two
      // different rows in one render frame both accumulate instead of the second
      // clobbering the first with a stale snapshot.
      const togglePin = (id) => {
        if (!rowActionGuard('pin:' + id)) return
        const prev = pinnedRef.current
        const isPinned = prev.indexOf(id) !== -1
        const next = isPinned ? prev.filter((x) => x !== id) : [id].concat(prev.filter((x) => x !== id))
        busyRef.current = true
        setBusy(true)
        try {
          const official = isPinned ? unpinSession : pinSession
          if (typeof official === 'function') {
            try { Promise.resolve(official(id)).catch((err) => console.warn('[enkeep] official pin/unpin failed', err)) }
            catch (err) { console.warn('[enkeep] official pin/unpin failed', err) }
          }
          commitPinned(next)
        } finally { busyRef.current = false; setBusy(false) }
      }
      const askArchive = (id, title) => {
        if (!rowActionGuard('archive:' + id)) return
        setArchiveError(null)
        setConfirmArchive({ id, title })
      }
      // Archive: try normal archive first. A running session is refused by the
      // Host with workspace/session-active — surface a second, explicit confirm
      // that stops work and archives (stopActivity:true), matching official UX.
      // On success drop the id from our pinned set (functional update, no stale
      // closure). Any other failure shows a visible error instead of silence.
      const confirmArchiveAction = async () => {
        const target = confirmArchive
        setConfirmArchive(null)
        if (!target || typeof archiveSession !== 'function' || busyRef.current) return
        busyRef.current = true
        setBusy(true)
        try {
          await archiveSession(target.id)
          unpinLocal(target.id)
        } catch (err) {
          console.warn('[enkeep] archive failed', err)
          if (isSessionActiveError(err)) setStopArchiveTarget(target)
          else setArchiveError('归档失败：' + errMessage(err, '请稍后重试'))
        } finally { busyRef.current = false; setBusy(false) }
      }
      const confirmStopArchiveAction = async () => {
        const target = stopArchiveTarget
        setStopArchiveTarget(null)
        if (!target || typeof archiveSession !== 'function' || busyRef.current) return
        busyRef.current = true
        setBusy(true)
        try {
          await archiveSession(target.id, { stopActivity: true })
          unpinLocal(target.id)
        } catch (err) {
          console.warn('[enkeep] stop-and-archive failed', err)
          setArchiveError('停止并归档失败：' + errMessage(err, '请稍后重试'))
        } finally { busyRef.current = false; setBusy(false) }
      }
      // Delete a workspace registration (dsh's own workspaces.delete; folder + logs kept).
      const askDeleteWorkspace = (workspaceId, title) => {
        setWorkspaceDeleteError(null)
        setConfirmWorkspaceDelete({ workspaceId, title })
      }
      const confirmDeleteWorkspace = async () => {
        const target = confirmWorkspaceDelete
        setConfirmWorkspaceDelete(null)
        if (!target || busyRef.current) return
        if (typeof deleteWorkspace !== 'function') {
          setWorkspaceDeleteError('删除服务不可用')
          return
        }
        busyRef.current = true
        setBusy(true)
        try {
          await deleteWorkspace(target.workspaceId)
          // 删除的若是当前选中工作区，清掉选中态，否则 +A/+S 会拿失效 id。
          setSelectedWorkspaceId((cur) => cur === target.workspaceId ? null : cur)
        } catch (err) {
          console.warn('[enkeep] workspace delete failed', err)
          setWorkspaceDeleteError('删除工作区失败：' + errMessage(err, '请稍后重试'))
        } finally { busyRef.current = false; setBusy(false) }
      }
      const askRename = (id, title) => {
        if (!rowActionGuard('rename:' + id)) return
        setRenameError('')
        setRenameTarget({ id, title })
        setRenameDraft(title || '')
      }
      const confirmRenameAction = async () => {
        const target = renameTarget
        const next = renameDraft.trim()
        if (!target || !next || next === (target.title || '')) { setRenameTarget(null); setRenameError(''); return }
        if (typeof renameSession !== 'function' || busyRef.current) return
        setRenameError('')
        busyRef.current = true
        setBusy(true)
        try {
          await renameSession(target.id, next)
          setRenameTarget(null)
        } catch (err) {
          console.warn('[enkeep] rename failed', err)
          // Keep the dialog open so the user sees the error and can retry.
          setRenameError('重命名失败：' + errMessage(err, '请稍后重试'))
        } finally { busyRef.current = false; setBusy(false) }
      }

      // 活跃派生会话映射（只读 ?all=1）：挂载即启动单例轮询，订阅快照传给 selectActivity。
      React.useEffect(() => derivedActivityStore.start(), [])
      const derivedState = useExternalStore(derivedActivityStore)
      const activeDerived = derivedState && derivedState.sessions ? derivedState.sessions : null

      const sessions = useSessions ? useSessions((s) => s) : undefined
      const statuses = useSessionStatus ? useSessionStatus((s) => s) : undefined
      const ws = useWorkspaces ? useWorkspaces((s) => s) : undefined
      const archived = ws && ws.archivedSessionIds ? new Set(ws.archivedSessionIds) : new Set()
      const pinnedSet = new Set(pinned)
      // 上区原样：直接取 conversations 组（原 tab1），不改筛选/排序/截断。
      const groups = selectActivity(sessions, statuses, archived, hours, Date.now(), pinnedSet, itemLimit, activeDerived)
      const items = groups.conversations
      const hasItems = items.length > 0

      // 工作区 tab：排除派任务目录（固定前缀与 dsh-assistant 约定一致）。
      // 工作区项字段：workspaceId / path / title / sessionIds / createdAt（无 label）。
      const TASK_DIR_PREFIX = 'da-task-'
      const baseName = (p) => String(p || '').split(/[\\/]/).pop() || ''
      // 原始工作区数量用于"是否显示活动区"判断：即使全部是任务目录（过滤后为空），
      // 也必须保留 +A/+S 与新增工作区入口，否则用户无法新增工作区。
      const hasAnyWorkspace = !!(ws && Array.isArray(ws.items) && ws.items.length)
      const workspaceItems = (ws && Array.isArray(ws.items) ? ws.items : []).filter((w) => !baseName(w && w.path).startsWith(TASK_DIR_PREFIX))
      const workspaceListNode = !collapsed ? (workspaceItems.length
        ? workspaceItems.map((w) => {
          const title = String(w && w.title || baseName(w && w.path))
          return h('div', { key: w.workspaceId, 'data-enkeep-activity-workspace-row': true, 'data-enkeep-reveal-host': true },
            h('button', {
              type: 'button',
              'data-enkeep-activity-workspace': true,
              'data-selected': selectedWorkspaceId === w.workspaceId ? true : undefined,
              title: String(w && w.path || ''),
              onClick: () => setSelectedWorkspaceId(w.workspaceId),
            },
              h('span', { 'data-enkeep-workspace-label': true }, title),
              h('span', { 'data-enkeep-workspace-count': true }, String((w && w.sessionIds || []).length))),
            h('div', { 'data-enkeep-workspace-actions': true, 'data-enkeep-reveal': true },
              h('button', {
                type: 'button',
                'data-enkeep-row-action': true,
                title: '删除工作区',
                'aria-label': '删除工作区',
                onClick: (e) => { e.stopPropagation(); askDeleteWorkspace(w.workspaceId, title) },
              }, h(HeaderIcon, { kind: 'delete' }))))
        })
        : h('div', { 'data-enkeep-activity-empty': true }, '暂无工作区（可用头部 + 新增）')) : null

      // 助手模式判定：只读 selectedId 对应行的 agentPreset；字段缺失安全降级为非助手。
      // Issue ④: derive from the (s)=>s sessions snapshot already subscribed above
      // instead of opening a second useSessions subscription for the same store.
      const selectedRow = sessions && sessions.byId ? sessions.byId[selectedId] : undefined
      const isAssistant = !!(selectedRow && selectedRow.projectionValues && selectedRow.projectionValues.agentPreset === 'dsh-assistant-main')

      // 点击行：同一事件内先同步更新 selectedId + 清空下区，再异步打开会话。
      // openSession 的完成不写回任何下区状态（selectedId 是下区唯一驱动源）。
      const onSelectRow = (id) => {
        selectedIdRef.current = id
        setSelectedId(id)
        setActiveWorkerId(null) // 换助手对话：旧外派高亮失效，等下区重取后按 current 重定
        clearLower()
        openSession(id)
      }

      // 点击下区外派：只记高亮 + 打开会话；selectedId 保持不变、下区不清空。
      // openSession 会把主界面 current 切到 worker，下面的校正逻辑识别 worker 后不再
      // 改写 selectedId，从而保住上区助手对话与整张外派列表。
      const onOpenWorker = (id) => {
        setActiveWorkerId(id)
        openSession(id)
      }

      // derived current 校正：只在 current 本身变化时介入。初始化（selectedId 为空）
      // 以 current 为准；外部切换/retainedBy 变化走与点击相同的 清空→重设→重取 路径。
      // 例外：current 是外派 worker 会话时（点外派或从侧栏切到 worker），上区助手
      // 对话与下区列表都保持不动，只把高亮同步到该 worker。
      const prevCurrentRef = React.useRef(undefined)
      React.useEffect(() => {
        const prev = prevCurrentRef.current
        prevCurrentRef.current = groups.current
        if (!groups.current) return
        const currentRow = sessions && sessions.byId ? sessions.byId[groups.current] : undefined
        if (isAssistantWorkerSession(groups.current, currentRow)) {
          setActiveWorkerId(groups.current)
          return
        }
        // mainView 回到非 worker（如从官方侧栏点回同一助手、或 worker 被关闭/归档）时
        // 一律清外派高亮；否则下面两个早退分支会让绿高亮残留、与主界面不符。
        setActiveWorkerId(null)
        const adoptingInitial = !selectedIdRef.current
        const correctedExternally = prev !== undefined && prev !== groups.current && selectedIdRef.current !== groups.current
        if (!adoptingInitial && !correctedExternally) return
        clearLower()
        selectedIdRef.current = groups.current
        setSelectedId(groups.current)
      }, [groups.current])

      // 整条隐藏：上区无条目、且下区未处于激活态、且无对话框时才隐藏。
      // 步骤6(a)写「只看上区」，但同一步(c)#3 与矩阵 A15 明确要求「上区空、下区
      // 有内容时活动区仍渲染」，故以验收矩阵为准：下区激活时也保留整条。
      const currentWorkerRow = groups.current && sessions && sessions.byId ? sessions.byId[groups.current] : undefined
      // 冷启动恰好停在 worker 会话时 selectedId 仍为空、下区不渲染，但整条活动区必须
      // 保留（否则用户失去新建/设置入口）——把 worker current 一并算作激活态。
      const workerCurrentActive = !!(groups.current && isAssistantWorkerSession(groups.current, currentWorkerRow))
      const lowerActive = !!(selectedId && isAssistant) || workerCurrentActive
      // 工作区 tab 必须有入口：即使对话列表为空，只要有工作区就保留整条活动区，
      // 否则 tab 与 +A/+S 一起消失，用户无法查看/新增工作区。
      if (!hasItems && !hasAnyWorkspace && !lowerActive && !confirmArchive && !stopArchiveTarget && !archiveError && !confirmWorkspaceDelete && !workspaceDeleteError && !renameTarget) return null

      return h('div', {
        'data-enkeep-activity-bar': true,
        'data-dragging': dragging ? true : undefined,
        title: '拖动标题栏可移动位置，双击标题栏复位',
        style: { transform: `translate(${pos.x}px, ${pos.y}px)` },
      },
        h('div', {
          'data-enkeep-activity-head': true,
          onPointerDown: onDragStart,
          onDoubleClick: resetPos,
        },
          // 活动区 tab：对话（原列表，默认）/ 工作区（排除派任务目录）。
          // 计数跟随当前 tab；头部按钮行在两 tab 下均保留。
          h('div', { 'data-enkeep-activity-tabs': true },
            h('button', {
              type: 'button',
              'data-enkeep-activity-tab': true,
              'data-active': activityTab === 'conversations' ? true : undefined,
              onClick: () => setActivityTab('conversations'),
            }, '对话'),
            h('button', {
              type: 'button',
              'data-enkeep-activity-tab': true,
              'data-active': activityTab === 'workspaces' ? true : undefined,
              onClick: () => setActivityTab('workspaces'),
            }, '工作区')),
          h('span', null, `${activityTab === 'workspaces' ? workspaceItems.length : items.length} 个`),
          h('div', { 'data-enkeep-activity-actions': true },
            h('button', {
              type: 'button',
              'data-enkeep-activity-action': true,
              onClick: onToggleSidebarHide,
              title: sidebarHidden ? '显示侧边栏' : '隐藏侧边栏',
              'aria-label': sidebarHidden ? '显示侧边栏' : '隐藏侧边栏',
              'aria-pressed': sidebarHidden,
            }, h(HeaderIcon, { kind: sidebarHidden ? 'sidebar-show' : 'sidebar-hide' })),
            h('button', {
              type: 'button',
              'data-enkeep-activity-action': true,
              disabled: busy,
              title: '新建助手模式对话',
              'aria-label': '新建助手模式对话',
              onClick: runAction(() => newSession('dsh-assistant-main', selectedWorkspaceId)),
            }, '+A'),
            h('button', {
              type: 'button',
              'data-enkeep-activity-action': true,
              disabled: busy,
              title: '新建标准模式对话',
              'aria-label': '新建标准模式对话',
              onClick: runAction(() => newSession('standard', selectedWorkspaceId)),
            }, '+S'),
            h('button', {
              type: 'button',
              'data-enkeep-activity-action': true,
              disabled: busy,
              title: '新建工作区',
              'aria-label': '新建工作区',
              onClick: runAction(addWorkspace),
            }, h(HeaderIcon, { kind: 'workspace' })),
            h('button', {
              type: 'button',
              'data-enkeep-activity-action': true,
              disabled: busy,
              title: '设置',
              'aria-label': '设置',
              onClick: runAction(openSettings),
            }, h(HeaderIcon, { kind: 'settings' })),
            h('button', {
              type: 'button',
              'data-enkeep-activity-toggle': true,
              onClick: () => setCollapsed((v) => !v),
              title: collapsed ? '展开会话列表' : '收起会话列表',
              'aria-label': collapsed ? '展开会话列表' : '收起会话列表',
            }, h(HeaderIcon, { kind: collapsed ? 'expand' : 'collapse' })))),
        h('div', { 'data-enkeep-activity-list': true },
          activityTab === 'workspaces' ? workspaceListNode : (!collapsed && (items.length
            ? items.map((it) =>
                h('div', {
                  key: it.id,
                  'data-enkeep-activity-item': true,
                  'data-enkeep-pinned': it.pinned ? true : undefined,
                  // 单一高亮源：优先 selectedId（下区驱动的助手对话），未选时退回 current。
                  // 不用 OR —— 从侧栏切到另一个助手而 openSession 未落地时，OR 会让旧 current
                  // 与新 selectedId 同帧双高亮；单一源始终只亮一行。
                  'data-enkeep-current': it.id === (selectedId || groups.current) ? true : undefined,
                },
                  h('button', {
                    type: 'button',
                    'data-enkeep-activity-main': true,
                    // tooltip 与高亮同源：点外派后 mainView 是 worker，被驱动的助手标
                    // 「外派来源对话」，真正 mainView 的助手才标「当前对话」。
                    title: it.label + (it.awaiting ? '（等待互动）' : '')
                      + (it.id !== (selectedId || groups.current) ? ''
                        : (it.current ? '（当前对话）' : '（外派来源对话）')),
                    onClick: () => onSelectRow(it.id),
                  },
                    h('span', { 'data-enkeep-dot': it.state }),
                    h('span', { 'data-enkeep-activity-label': true }, it.label)),
                  h('div', { 'data-enkeep-activity-row-actions': true },
                    h('button', {
                      type: 'button',
                      'data-enkeep-row-action': true,
                      title: '重命名',
                      'aria-label': '重命名',
                      onClick: (e) => { e.stopPropagation(); askRename(it.id, it.rawTitle) },
                    }, h(HeaderIcon, { kind: 'rename' })),
                    h('button', {
                      type: 'button',
                      'data-enkeep-row-action': true,
                      title: '归档',
                      'aria-label': '归档',
                      onClick: (e) => { e.stopPropagation(); askArchive(it.id, it.label) },
                    }, h(HeaderIcon, { kind: 'archive' })),
                    h('button', {
                      type: 'button',
                      'data-enkeep-row-action': true,
                      'data-enkeep-row-pin': it.pinned ? true : undefined,
                      title: it.pinned ? '取消置顶' : '置顶',
                      'aria-label': it.pinned ? '取消置顶' : '置顶',
                      onClick: (e) => { e.stopPropagation(); togglePin(it.id) },
                    }, h(HeaderIcon, { kind: it.pinned ? 'unpin' : 'pin' })))))
            : h('div', { 'data-enkeep-activity-empty': true }, '暂无活动会话')))),
        h(DispatchPanel, {
          selectedId,
          selectedIdRef,
          isAssistant,
          registerClear: registerLowerClear,
          // Issue ④: pass the already-subscribed snapshots down; DispatchPanel
          // no longer opens its own broad (s)=>s subscriptions.
          sessions,
          statuses,
          archivedIds: archived,
          lowerCollapsed,
          onToggleLower: () => setLowerCollapsed((v) => !v),
          // 下区外派独立上限（ActivityBar 已订阅 dispatchItemLimit）。
          dispatchLimit,
          // 当前外派高亮 + 点击处理：不动 selectedId、不清空下区列表。
          activeWorkerId,
          onOpenWorker,
        }),
        // Dialogs are portaled to document.body: the bar root carries a CSS
        // transform (drag offset), which would otherwise make position:fixed
        // resolve against the 300px bar instead of the viewport, and would trap
        // z-index inside the overlay layer. Portaling escapes both.
        portalToBody(confirmArchive ? h('div', { 'data-enkeep-modal-mask': true, onClick: () => setConfirmArchive(null) },
          h('div', { 'data-enkeep-modal': true, onClick: (e) => e.stopPropagation() },
            h('strong', null, '归档会话'),
            h('p', null, '确定归档会话「' + confirmArchive.title + '」？归档后可在工作区取消归档。'),
            h('div', { 'data-enkeep-modal-actions': true },
              h('button', { type: 'button', onClick: () => setConfirmArchive(null) }, '取消'),
              h('button', { type: 'button', 'data-enkeep-modal-primary': true, onClick: confirmArchiveAction }, '确定归档')))) : null),
        // Second confirm for a running session refused with workspace/session-active.
        portalToBody(stopArchiveTarget ? h('div', { 'data-enkeep-modal-mask': true, onClick: () => setStopArchiveTarget(null) },
          h('div', { 'data-enkeep-modal': true, onClick: (e) => e.stopPropagation() },
            h('strong', null, '会话正在运行'),
            h('p', null, '会话「' + stopArchiveTarget.title + '」仍在进行工作。是否停止其工作并归档？（取消则不改动）'),
            h('div', { 'data-enkeep-modal-actions': true },
              h('button', { type: 'button', onClick: () => setStopArchiveTarget(null) }, '取消'),
              h('button', { type: 'button', 'data-enkeep-modal-primary': true, onClick: confirmStopArchiveAction }, '停止并归档')))) : null),
        // Generic visible failure (archive / stop-and-archive) — never silent.
        portalToBody(archiveError ? h('div', { 'data-enkeep-modal-mask': true, onClick: () => setArchiveError(null) },
          h('div', { 'data-enkeep-modal': true, onClick: (e) => e.stopPropagation() },
            h('strong', null, '操作失败'),
            h('p', { 'data-enkeep-modal-error': true }, archiveError),
            h('div', { 'data-enkeep-modal-actions': true },
              h('button', { type: 'button', 'data-enkeep-modal-primary': true, onClick: () => setArchiveError(null) }, '确定')))) : null),
        // Workspace deletion confirm + visible failure — never silent.
        portalToBody(confirmWorkspaceDelete ? h('div', { 'data-enkeep-modal-mask': true, onClick: () => setConfirmWorkspaceDelete(null) },
          h('div', { 'data-enkeep-modal': true, onClick: (e) => e.stopPropagation() },
            h('strong', null, '删除工作区'),
            h('p', null, '确定删除工作区「' + confirmWorkspaceDelete.title + '」？仅从列表移除，文件夹与会话记录会保留。'),
            h('div', { 'data-enkeep-modal-actions': true },
              h('button', { type: 'button', onClick: () => setConfirmWorkspaceDelete(null) }, '取消'),
              h('button', { type: 'button', 'data-enkeep-modal-primary': true, onClick: confirmDeleteWorkspace }, '删除工作区')))) : null),
        portalToBody(workspaceDeleteError ? h('div', { 'data-enkeep-modal-mask': true, onClick: () => setWorkspaceDeleteError(null) },
          h('div', { 'data-enkeep-modal': true, onClick: (e) => e.stopPropagation() },
            h('strong', null, '操作失败'),
            h('p', { 'data-enkeep-modal-error': true }, workspaceDeleteError),
            h('div', { 'data-enkeep-modal-actions': true },
              h('button', { type: 'button', 'data-enkeep-modal-primary': true, onClick: () => setWorkspaceDeleteError(null) }, '确定')))) : null),
        portalToBody(renameTarget ? h('div', { 'data-enkeep-modal-mask': true, onClick: () => setRenameTarget(null) },
          h('div', { 'data-enkeep-modal': true, onClick: (e) => e.stopPropagation() },
            h('strong', null, '重命名会话'),
            h('input', {
              'data-enkeep-rename-input': true,
              value: renameDraft,
              autoFocus: true,
              onChange: (e) => setRenameDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') confirmRenameAction(); else if (e.key === 'Escape') setRenameTarget(null) },
            }),
            renameError ? h('p', { 'data-enkeep-modal-error': true }, renameError) : null,
            h('div', { 'data-enkeep-modal-actions': true },
              h('button', { type: 'button', onClick: () => setRenameTarget(null) }, '取消'),
              h('button', { type: 'button', 'data-enkeep-modal-primary': true, onClick: confirmRenameAction }, '确定')))) : null))
    }

    // --- Common words / structured prompts (ported from dsh-wordbox, upgraded) --
    // localStorage keys — enkeep-owned. They hold v2 Prompt objects now; any
    // legacy string[] left in them is migrated on read by normalizePromptList.
    const WORDS_GLOBAL_KEY = 'dsh.enkeep.words.global.v1'
    const WORDS_PROJECT_KEY = 'dsh.enkeep.words.project.v1'
    const WORDS_MODE_KEY = 'dsh.enkeep.words.mode.v1'
    const WORDS_MODES = ['all', 'global', 'current']
    const WORDS_SYNC_URL = '/dsh-enkeep-words/state'
    const WORDS_SYNC_HEADERS = { 'x-dsh-enkeep-words': '1' }
    const WORDS_SYNC_POLL_MS = 10000
    const WORDS_FLOW_SPEED = 60 // px/s for long-label marquee

    // v2 Prompt = { id, keyword, content, useCount }. v1 string → object, zero loss.
    function normalizePrompt(raw, i) {
      if (typeof raw === 'string') {
        return raw === '' ? null : { id: 'legacy-' + i, keyword: '', content: raw, useCount: 0 }
      }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
      const content = typeof raw.content === 'string' ? raw.content : ''
      if (content === '') return null
      let id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
      if (id === '') {
        let hash = 0
        for (const ch of content) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0
        id = 'auto-' + i + '-' + (hash >>> 0).toString(36)
      }
      const keyword = typeof raw.keyword === 'string' ? raw.keyword : ''
      const useCount = Number.isFinite(raw.useCount) ? Math.max(0, Math.trunc(raw.useCount)) : 0
      return { id, keyword, content, useCount }
    }
    function normalizePromptList(list) {
      if (!Array.isArray(list)) return []
      const out = []
      const seen = new Set()
      list.forEach((raw, i) => {
        const p = normalizePrompt(raw, i)
        if (p !== null && !seen.has(p.id)) { seen.add(p.id); out.push(p) }
      })
      return out
    }

    function wordsLoadList(key) {
      try { return normalizePromptList(JSON.parse(localStorage.getItem(key))) } catch { return [] }
    }
    function wordsLoadProjects() {
      try {
        const parsed = JSON.parse(localStorage.getItem(WORDS_PROJECT_KEY))
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out = {}
        for (const [dir, list] of Object.entries(parsed)) {
          const items = normalizePromptList(list)
          if (items.length > 0) out[dir] = items
        }
        return out
      } catch { return {} }
    }
    function wordsSaveList(key, list) {
      try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* quota/disabled: ignore */ }
    }
    function wordsSaveProjects(projects) {
      try {
        const out = {}
        for (const [dir, list] of Object.entries(projects)) {
          if (Array.isArray(list) && list.length > 0) out[dir] = list
        }
        localStorage.setItem(WORDS_PROJECT_KEY, JSON.stringify(out))
      } catch { /* ignore */ }
    }
    function wordsLoadMode() {
      try {
        const raw = localStorage.getItem(WORDS_MODE_KEY)
        return WORDS_MODES.includes(raw) ? raw : 'all'
      } catch { return 'all' }
    }
    function wordsSaveMode(mode) {
      try { localStorage.setItem(WORDS_MODE_KEY, mode) } catch { /* ignore */ }
    }
    function wordsNormalizeProject(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return null
      return cwd.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase()
    }
    // Button/label text: keyword first, else first 8 chars of content (whitespace collapsed).
    function promptLabel(p) {
      if (typeof p.keyword === 'string' && p.keyword.trim() !== '') return p.keyword
      const text = String(p.content || '').replace(/\s+/g, ' ')
      return text.length > 8 ? text.slice(0, 8) + '…' : text
    }

    // Three-way merge by id: base=last synced, theirs=server, mine=local.
    // Local edits win; a side's deletion is respected; shared ids take the max
    // useCount so concurrent usage never loses counts.
    function mergePrompts(base, theirs, mine) {
      const baseIds = new Set(base.map((p) => p.id))
      const theirsIds = new Set(theirs.map((p) => p.id))
      const mineIds = new Set(mine.map((p) => p.id))
      const out = []
      const seen = new Set()
      for (const p of mine) {
        if (baseIds.has(p.id) && !theirsIds.has(p.id)) continue // deleted by server
        out.push(p); seen.add(p.id)
      }
      for (const p of theirs) {
        if (!seen.has(p.id)) {
          if (baseIds.has(p.id) && !mineIds.has(p.id)) continue // deleted locally
          out.push(p); seen.add(p.id)
        } else {
          const idx = out.findIndex((x) => x.id === p.id)
          if (p.useCount > out[idx].useCount) out[idx] = { ...out[idx], useCount: p.useCount }
        }
      }
      return out
    }

    /**
     * Module-level single source of truth shared by the panel (input.right), the
     * quick row (composer.dock) and the settings editor. Owning sync here avoids two
     * components each running their own poll/push and clobbering each other.
     */
    function createWordStore() {
      let state = {
        mode: wordsLoadMode(),
        global: wordsLoadList(WORDS_GLOBAL_KEY),
        projects: wordsLoadProjects(),
      }
      let rev = 0
      let hydrated = false
      let sentFp = null
      let baseState = null
      let warned = false
      let started = false
      let inserter = null
      let pushTimer = null
      let pullTimer = null
      const listeners = new Set()

      const fp = (m, g, p) => JSON.stringify([m, g, p])
      const getSnapshot = () => state

      const persist = () => {
        wordsSaveList(WORDS_GLOBAL_KEY, state.global)
        wordsSaveProjects(state.projects)
        wordsSaveMode(state.mode)
      }
      const notify = () => { for (const fn of listeners) fn() }
      const commit = (next) => {
        state = next
        persist()
        notify()
        schedulePush()
      }
      const schedulePush = () => {
        if (!hydrated) return
        if (pushTimer !== null) clearTimeout(pushTimer)
        pushTimer = setTimeout(push, 800)
      }
      const subscribe = (fn) => {
        listeners.add(fn)
        if (!started) start()
        return () => { listeners.delete(fn) }
      }
      const registerInserter = (fn) => {
        inserter = fn
        return () => { if (inserter === fn) inserter = null }
      }
      const locate = (id) => {
        const g = state.global.find((p) => p.id === id)
        if (g) return { list: 'global', key: null, prompt: g }
        for (const [k, list] of Object.entries(state.projects)) {
          const item = list.find((p) => p.id === id)
          if (item) return { list: 'projects', key: k, prompt: item }
        }
        return null
      }
      const genId = () => 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
      const bump = (list, id) => list.map((p) => (p.id === id ? { ...p, useCount: p.useCount + 1 } : p))

      // Public actions — every one goes through commit() so both subscribers update.
      const insert = (id) => {
        const loc = locate(id)
        if (!loc) return
        if (typeof inserter === 'function') {
          try { inserter(loc.prompt.content) } catch (e) { console.warn('[enkeep] prompt insert failed', e) }
        }
        if (loc.list === 'global') commit({ ...state, global: bump(state.global, id) })
        else commit({ ...state, projects: { ...state.projects, [loc.key]: bump(state.projects[loc.key], id) } })
      }
      const upsert = (prompt, bucket, key) => {
        const p = normalizePrompt({ ...prompt, id: prompt.id || genId() }, 0)
        if (!p) return
        if (bucket === 'global') {
          const exists = state.global.some((x) => x.id === p.id)
          commit({ ...state, global: exists ? state.global.map((x) => (x.id === p.id ? p : x)) : [...state.global, p] })
        } else {
          if (!key) return
          const cur = state.projects[key] ?? []
          const exists = cur.some((x) => x.id === p.id)
          commit({ ...state, projects: { ...state.projects, [key]: exists ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p] } })
        }
      }
      const remove = (id, bucket, key) => {
        if (bucket === 'global') commit({ ...state, global: state.global.filter((p) => p.id !== id) })
        else if (key) commit({ ...state, projects: { ...state.projects, [key]: (state.projects[key] ?? []).filter((p) => p.id !== id) } })
      }
      const resetCount = (id, bucket, key) => {
        const zero = (list) => list.map((p) => (p.id === id ? { ...p, useCount: 0 } : p))
        if (bucket === 'global') commit({ ...state, global: zero(state.global) })
        else if (key) commit({ ...state, projects: { ...state.projects, [key]: zero(state.projects[key] ?? []) } })
      }
      const resetAllCounts = () => {
        const zero = (list) => list.map((p) => ({ ...p, useCount: 0 }))
        const projects = {}
        for (const [k, list] of Object.entries(state.projects)) projects[k] = zero(list)
        commit({ ...state, global: zero(state.global), projects })
      }
      const setMode = (mode) => {
        if (!WORDS_MODES.includes(mode) || mode === state.mode) return
        commit({ ...state, mode })
      }
      const addToGlobal = (id) => {
        const loc = locate(id)
        if (!loc || loc.list !== 'projects') return
        // fresh id: an identical id in both buckets would make insert(id) ambiguous
        commit({ ...state, global: [...state.global, { ...loc.prompt, id: genId() }] })
      }

      // ---- shared-file sync (single instance) ----
      const fromServer = (s) => {
        if (!s || typeof s !== 'object' || Array.isArray(s)) return null
        const mode = WORDS_MODES.includes(s.mode) ? s.mode : 'all'
        const r = Number.isFinite(s.rev) ? s.rev : 0
        const global = normalizePromptList(s.words)
        const projects = {}
        const rp = s.projects && typeof s.projects === 'object' && !Array.isArray(s.projects) ? s.projects : {}
        for (const [dir, list] of Object.entries(rp)) {
          const key = wordsNormalizeProject(dir) ?? String(dir).toLowerCase()
          const items = normalizePromptList(list)
          if (items.length > 0) projects[key] = items
        }
        return { rev: r, mode, global, projects }
      }
      const mergeProjects = (baseP, theirsP, mineP) => {
        const out = {}
        const keys = new Set([...Object.keys(baseP), ...Object.keys(theirsP), ...Object.keys(mineP)])
        for (const k of keys) {
          const items = mergePrompts(baseP[k] ?? [], theirsP[k] ?? [], mineP[k] ?? [])
          if (items.length > 0) out[k] = items
        }
        return out
      }
      const warn = (e) => {
        if (!warned) { warned = true; console.warn('[enkeep] 常用词服务端同步不可用，已退回本地存储', e) }
      }
      const pull = async () => {
        try {
          const res = await fetch(WORDS_SYNC_URL, { headers: WORDS_SYNC_HEADERS })
          if (!res.ok) return
          const data = await res.json()
          const server = fromServer(data && data.state)
          if (!server) return
          if (hydrated && server.rev <= rev) return
          const serverFp = fp(server.mode, server.global, server.projects)
          const dirty = fp(state.mode, state.global, state.projects) !== sentFp
          const base = baseState || { mode: 'all', global: [], projects: {} }
          rev = server.rev
          sentFp = serverFp
          baseState = { mode: server.mode, global: server.global, projects: server.projects }
          hydrated = true
          if (!dirty) {
            commit({ mode: server.mode, global: server.global, projects: server.projects })
            return
          }
          commit({
            mode: state.mode,
            global: mergePrompts(base.global, server.global, state.global),
            projects: mergeProjects(base.projects, server.projects, state.projects),
          })
        } catch (e) { warn(e) }
      }
      const push = async () => {
        const cur = fp(state.mode, state.global, state.projects)
        if (cur === sentFp) return
        const base = baseState || { mode: 'all', global: [], projects: {} }
        try {
          const res = await fetch(WORDS_SYNC_URL, {
            method: 'POST',
            headers: { ...WORDS_SYNC_HEADERS, 'content-type': 'application/json' },
            body: JSON.stringify({ baseRev: rev, mode: state.mode, words: state.global, projects: state.projects }),
          })
          if (!res.ok) return
          const data = await res.json()
          const server = fromServer(data && data.state)
          if (!server) return
          rev = server.rev
          if (data.conflict !== true) {
            sentFp = cur
            baseState = { mode: state.mode, global: state.global, projects: state.projects }
            return
          }
          const mg = mergePrompts(base.global, server.global, state.global)
          const mp = mergeProjects(base.projects, server.projects, state.projects)
          const retry = await fetch(WORDS_SYNC_URL, {
            method: 'POST',
            headers: { ...WORDS_SYNC_HEADERS, 'content-type': 'application/json' },
            body: JSON.stringify({ baseRev: rev, mode: state.mode, words: mg, projects: mp }),
          })
          if (!retry.ok) return
          const rd = await retry.json()
          const rs = fromServer(rd && rd.state)
          if (rs) rev = rs.rev
          const merged = { mode: state.mode, global: mg, projects: mp }
          sentFp = fp(merged.mode, merged.global, merged.projects)
          baseState = merged
          commit(merged)
        } catch (e) { warn(e) }
      }
      const onVisible = () => { if (typeof document === 'undefined' || !document.hidden) pull() }
      const onStorage = (e) => {
        if (e.key === WORDS_GLOBAL_KEY || e.key === WORDS_PROJECT_KEY || e.key === WORDS_MODE_KEY) {
          state = { mode: wordsLoadMode(), global: wordsLoadList(WORDS_GLOBAL_KEY), projects: wordsLoadProjects() }
          sentFp = fp(state.mode, state.global, state.projects)
          notify()
        }
      }
      const start = () => {
        if (started) return
        started = true
        ;(async () => {
          try {
            const res = await fetch(WORDS_SYNC_URL, { headers: WORDS_SYNC_HEADERS })
            if (!res.ok) return
            const data = await res.json()
            if (fromServer(data && data.state) === null) {
              await fetch(WORDS_SYNC_URL + '?migrate=1', {
                method: 'POST',
                headers: { ...WORDS_SYNC_HEADERS, 'content-type': 'application/json' },
                body: JSON.stringify({ mode: state.mode, words: state.global, projects: state.projects }),
              })
            }
            await pull()
            pullTimer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) pull() }, WORDS_SYNC_POLL_MS)
            if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
            if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
          } catch (e) { warn(e) }
        })()
      }

      // Insert arbitrary text through the registered composer inserter without
      // requiring an existing library entry (used by unfavorited skill rows).
      const insertContent = (content) => {
        if (typeof inserter !== 'function') return
        try { inserter(content) } catch (e) { console.warn('[enkeep] prompt insert failed', e) }
      }

      return { subscribe, getSnapshot, registerInserter, insert, insertContent, upsert, remove, resetCount, resetAllCounts, setMode, addToGlobal }
    }
    const wordStore = createWordStore()
    const derivedActivityStore = createDerivedActivityStore()

    // --- Skill quick-pick: read-only fetch of installed skills -------------
    // All logic lives in enkeep itself (no skill-picker plugin, no fork). The
    // host route is GET /dsh-enkeep-skills?cwd=… behind a custom header.
    const SKILLS_URL = '/dsh-enkeep-skills'
    const SKILLS_HEADER = 'x-dsh-enkeep-skills'
    /**
     * Fetch the skill list once. `signal` cancels an in-flight request so a
     * closing/unmounting panel never writes state. Returns [] on any failure —
     * skills are an additive convenience, never a blocker for common words.
     */
    async function fetchSkills(cwd, signal) {
      try {
        const q = typeof cwd === 'string' && cwd !== '' ? ('?cwd=' + encodeURIComponent(cwd)) : ''
        const res = await fetch(SKILLS_URL + q, {
          headers: { [SKILLS_HEADER]: '1' },
          signal,
        })
        if (!res || !res.ok) return []
        const data = await res.json()
        if (!data || data.ok !== true || !Array.isArray(data.skills)) return []
        return data.skills.filter((s) => s && typeof s.name === 'string' && s.name !== '')
      } catch (err) {
        if (err && err.name === 'AbortError') return []
        console.warn('[enkeep] fetch skills failed', err)
        return []
      }
    }

    // Subscribe helper: prefer React's native external-store hook when available;
    // the fallback works on any React 18 without that export.
    function useExternalStore(store) {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      }
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
      return store.getSnapshot()
    }

    // A word row in the panel: show the FULL content so long multi-line prompts
    // are readable. Marquee on hover reveals the tail when it overflows.
    // Keyword (when present) is shown as a leading tag; it never replaces the
    // body. The 8-char truncation is only for the space-limited quick chips.
    function WordsRow({ prompt, showToGlobal, alreadyGlobal, onInsert, onRemove, onAddToGlobal }) {
      const hasKw = typeof prompt.keyword === 'string' && prompt.keyword.trim() !== ''
      const label = hasKw ? prompt.keyword + '：' + prompt.content : prompt.content
      const [hovered, setHovered] = React.useState(false)
      const [overflow, setOverflow] = React.useState(0)
      const btnRef = React.useRef(null)
      const textRef = React.useRef(null)
      React.useEffect(() => {
        const btn = btnRef.current, text = textRef.current
        if (btn === null || text === null) { setOverflow(0); return }
        setOverflow(hovered ? Math.max(0, text.scrollWidth - btn.clientWidth) : 0)
      }, [hovered])
      const flowDuration = overflow > 0 ? overflow / WORDS_FLOW_SPEED : 0
      const toGlobalIcon = h('svg', { viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': true },
        h('path', { d: 'M6 1.5v6M3.5 4L6 1.5 8.5 4M2 8.5v2h8v-2', stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }))
      return h('li', { className: 'ekeep-w-row', onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) },
        h('button', {
          ref: btnRef, type: 'button', className: 'ekeep-w-word', title: prompt.content,
          onMouseDown: (e) => e.preventDefault(), onClick: () => onInsert(prompt.id),
        }, h('span', {
          ref: textRef, className: 'ekeep-w-wordText',
          style: hovered && overflow > 0 ? {
            transform: 'translateX(-' + overflow + 'px)',
            transitionDuration: flowDuration.toFixed(2) + 's',
            transitionTimingFunction: 'linear',
          } : undefined,
        }, label)),
        showToGlobal && !alreadyGlobal ? h('button', {
          type: 'button', className: 'ekeep-w-toGlobal', title: '添加到全局', 'aria-label': '添加到全局',
          onMouseDown: (e) => e.preventDefault(), onClick: () => onAddToGlobal(prompt.id),
        }, toGlobalIcon) : null,
        h('button', {
          type: 'button', className: 'ekeep-w-del', title: '删除', 'aria-label': '删除',
          onMouseDown: (e) => e.preventDefault(), onClick: () => onRemove(prompt.id),
        }, '×'))
    }

    // Trigger icon: inline SVG bookmark, same 16x16 / 1.5 stroke spec as HeaderIcon.
    function WordsTriggerIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M4 2.75h8a1 1 0 0 1 1 1v9.5l-5-3-5 3v-9.5a1 1 0 0 1 1-1z' }))
    }

    /**
     * CommonWords — the "词" panel on conversation.input.right (session scope).
     * Now a thin view over wordStore: no local library state, no own sync loop.
     */
    function CommonWords({ useInput, inputActions, useSessions, sessionId }) {
      const [open, setOpen] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [draftWord, setDraftWord] = React.useState('')
      const [view, setView] = React.useState('words') // 'words' | 'skills' — panel-local, not persisted
      const [skills, setSkills] = React.useState([])
      const [skillsLoading, setSkillsLoading] = React.useState(false)
      const [skillsRefresh, setSkillsRefresh] = React.useState(0)
      const state = useExternalStore(wordStore)
      const draft = typeof useInput === 'function' ? (useInput((s) => (s === void 0 ? '' : s.draft)) ?? '') : ''
      const cwd = typeof useSessions === 'function'
        ? useSessions((s) => (sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd))
        : void 0
      const projectKey = wordsNormalizeProject(cwd)
      const projectWords = projectKey === null ? [] : (state.projects[projectKey] ?? [])

      // This slot definitely has inputActions: register it as the store's inserter.
      const draftRef = React.useRef(draft); draftRef.current = draft
      React.useEffect(() => {
        if (typeof inputActions?.setDraft !== 'function') return undefined
        return wordStore.registerInserter((content) => {
          const base = draftRef.current || ''
          const sep = base !== '' && !/\s$/.test(base) ? ' ' : ''
          inputActions.setDraft(base + sep + content)
        })
      }, [inputActions])

      // Load skills only while the panel is open on the skill tab. Abort on
      // close/tab-switch/cwd change so a late response never updates state.
      React.useEffect(() => {
        if (!open || view !== 'skills') return undefined
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null
        let alive = true
        setSkillsLoading(true)
        fetchSkills(cwd, ctrl ? ctrl.signal : undefined).then((list) => {
          if (alive) setSkills(list)
        }).finally(() => { if (alive) setSkillsLoading(false) })
        return () => { alive = false; if (ctrl) ctrl.abort() }
      }, [open, view, cwd, skillsRefresh])

      // Panel positioning: read composer card rect, write ONLY panel's own style.
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      React.useEffect(() => {
        if (!open || !panelRef.current) return undefined
        const p = panelRef.current, r = rootRef.current
        if (!r) return undefined
        const c = r.closest('[data-composer-card]') || r.closest('[data-composer-seat]') ||
          r.closest('[class*="composer"]') || r.parentElement?.parentElement?.parentElement || r.parentElement
        if (!c) return undefined
        const u = () => {
          const q = c.getBoundingClientRect()
          p.style.left = q.left + 'px'
          p.style.width = q.width + 'px'
          p.style.bottom = (window.innerHeight - q.top + 8) + 'px'
        }
        u()
        window.addEventListener('resize', u)
        return () => window.removeEventListener('resize', u)
      }, [open])

      // close on Esc / outside click
      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setEditing(false) } }
        const onPointer = (e) => {
          if (rootRef.current !== null && e.target instanceof Node && !rootRef.current.contains(e.target)) {
            setOpen(false); setEditing(false)
          }
        }
        window.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onPointer)
        return () => {
          window.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onPointer)
        }
      }, [open])

      const visible = React.useMemo(() => {
        if (state.mode === 'global') return state.global
        if (state.mode === 'current') return projectWords
        const seen = new Set(state.global.map((p) => p.id))
        return [...state.global, ...projectWords.filter((p) => !seen.has(p.id))]
      }, [state.mode, state.global, projectWords])

      const addWord = () => {
        const word = draftWord.trim()
        if (word === '') return
        wordStore.upsert({ keyword: '', content: word, useCount: 0 }, state.mode === 'global' ? 'global' : 'project', projectKey)
        setDraftWord(''); setEditing(false)
      }
      const removeWord = (id) => {
        if (state.global.some((p) => p.id === id)) wordStore.remove(id, 'global')
        else if (projectKey !== null) wordStore.remove(id, 'project', projectKey)
      }
      const addToGlobal = (id) => wordStore.addToGlobal(id)

      // A skill is "favorited" once a v2 prompt with content '/name ' exists.
      // The trailing space mirrors the official picker: it delimits the gesture
      // so typing immediately after the chip never merges into the skill name.
      const skillContent = (name) => '/' + name + ' '
      const findSkillPrompt = (name) => {
        const content = skillContent(name)
        return state.global.find((p) => p.content === content) ||
          Object.values(state.projects).flat().find((p) => p.content === content)
      }
      const isSkillFavorited = (name) => findSkillPrompt(name) !== undefined
      // Clicking a skill row inserts the gesture immediately — favoriting is
      // optional. Reuse insert() when already favorited so useCount increments;
      // otherwise push the text straight through the shared inserter.
      const insertSkill = (name) => {
        const found = findSkillPrompt(name)
        if (found) wordStore.insert(found.id)
        else wordStore.insertContent(skillContent(name))
      }
      const favoriteSkill = (name) => {
        if (isSkillFavorited(name)) return
        wordStore.upsert({ keyword: name, content: skillContent(name), useCount: 0 },
          state.mode === 'global' ? 'global' : 'project', projectKey)
      }

      const emptyText = state.mode === 'global' ? '还没有常用词，点击下方按钮添加'
        : state.mode === 'current' ? (projectKey === null ? '当前没有项目' : '当前项目还没有常用词')
          : '还没有任何常用词，点击下方按钮添加'

      const chevron = h('span', {
        className: 'ekeep-w-chevron' + (open ? ' ekeep-w-chevronOpen' : ''),
      }, h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
        h('path', { d: 'M2 6l3-3 3 3' })))

      return h('div', { className: 'ekeep-w-root', ref: rootRef },
        h('button', {
          type: 'button', className: 'ekeep-w-trigger', title: '常用词', 'aria-label': '常用词',
          'aria-haspopup': 'listbox', 'aria-expanded': open,
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => { if (open) setEditing(false); setOpen((v) => !v) },
        }, h(WordsTriggerIcon), chevron),
        open ? h('div', { ref: panelRef, className: 'ekeep-w-panel', role: 'listbox', 'aria-label': '常用词' },
          view === 'words' ? (editing ? h('div', { className: 'ekeep-w-addRow' },
            h('input', {
              className: 'ekeep-w-addInput', autoFocus: true, value: draftWord,
              placeholder: '输入词或句子…',
              onChange: (e) => setDraftWord(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') addWord()
                else if (e.key === 'Escape') { setEditing(false); setDraftWord('') }
              },
            }),
            h('button', { type: 'button', className: 'ekeep-w-addConfirm', disabled: draftWord.trim() === '', onClick: addWord }, '确定'),
            h('button', {
              type: 'button', className: 'ekeep-w-addConfirm',
              onClick: () => { setEditing(false); setDraftWord('') },
            }, '取消')
          ) : visible.length === 0 ? h('div', { className: 'ekeep-w-empty' }, emptyText)
            : h('ul', { className: 'ekeep-w-list' }, visible.map((p) => h(WordsRow, {
              key: p.id, prompt: p,
              showToGlobal: state.mode === 'current',
              alreadyGlobal: state.global.some((g) => g.content === p.content),
              onInsert: (id) => wordStore.insert(id),
              onRemove: removeWord, onAddToGlobal: addToGlobal,
            })))) : null,
          // Skill tab body (independent section; does not touch WORDS_MODES).
          view === 'skills' ? (skillsLoading && skills.length === 0
            ? h('div', { className: 'ekeep-w-empty' }, '正在读取技能…')
            : skills.length === 0
              ? h('div', { className: 'ekeep-w-empty' }, '没有找到可插入的技能（可在设置里检查技能目录）')
              : h('ul', { className: 'ekeep-w-list' }, skills.map((s) => {
                const faved = isSkillFavorited(s.name)
                return h('li', { key: s.name, className: 'ekeep-w-row' },
                  h('button', {
                    type: 'button', className: 'ekeep-w-word ekeep-w-skillName',
                    title: '插入 /' + s.name + (s.description ? ' — ' + s.description : ''),
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => insertSkill(s.name),
                  }, '/' + s.name),
                  s.description ? h('span', { className: 'ekeep-w-skillDesc', title: s.description }, s.description) : null,
                  h('div', { className: 'ekeep-w-skillTools' },
                    h('button', {
                      type: 'button', className: 'ekeep-w-fav', disabled: faved,
                      title: faved ? '已加入常用词' : '收藏为常用词（插入 /' + s.name + '）',
                      onMouseDown: (e) => e.preventDefault(),
                      onClick: () => favoriteSkill(s.name),
                    }, faved ? '已收藏' : '＋收藏')))
              }))
          ) : null,
          h('div', { className: 'ekeep-w-actions' },
            // The add/refresh button keeps its original left position via
            // margin-right:auto; views+modes stay grouped on the right so the
            // pre-existing words-panel layout is unchanged.
            view === 'words' ? (!editing ? h('button', {
              type: 'button', className: 'ekeep-w-add',
              onMouseDown: (e) => e.preventDefault(), onClick: () => setEditing(true),
            }, '＋ 添加') : null) : h('button', {
              type: 'button', className: 'ekeep-w-add',
              onMouseDown: (e) => e.preventDefault(),
              onClick: () => setSkillsRefresh((n) => n + 1),
            }, '↻ 刷新'),
            h('div', { className: 'ekeep-w-views', role: 'group', 'aria-label': '面板分区' },
              [['words', '常用词'], ['skills', '技能']].map(([value, label]) => h('button', {
                key: value, type: 'button',
                className: 'ekeep-w-view' + (view === value ? ' ekeep-w-viewActive' : ''),
                'aria-pressed': view === value, title: label,
                onMouseDown: (e) => e.preventDefault(),
                onClick: () => { setEditing(false); setView(value) },
              }, label))),
            view === 'words' ? h('div', { className: 'ekeep-w-modes', role: 'group', 'aria-label': '显示范围' },
              [['all', '全部'], ['global', '全局'], ['current', '当前']].map(([value, label]) => h('button', {
                key: value, type: 'button',
                className: 'ekeep-w-mode' + (state.mode === value ? ' ekeep-w-modeActive' : ''),
                'aria-pressed': state.mode === value, title: label,
                onMouseDown: (e) => e.preventDefault(), onClick: () => wordStore.setMode(value),
              }, label))) : null
          )
        ) : null)
    }

    /**
     * QuickPrompts — top-N (by useCount) prompt buttons rendered inline right
     * after the current-session chip, on conversation.composer.dock. Single-line
     * horizontal scroll; clicking inserts the full content via the store.
     */
    function QuickPrompts({ form, useInput, inputActions, useSessions, sessionId }) {
      const state = useExternalStore(wordStore)
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const rawN = Number((form.getSnapshot().value || {}).quickPromptCount)
      const n = Number.isFinite(rawN) ? Math.max(1, Math.min(12, Math.trunc(rawN))) : 6
      const draft = typeof useInput === 'function' ? (useInput((s) => (s === void 0 ? '' : s.draft)) ?? '') : ''
      const cwd = typeof useSessions === 'function'
        ? useSessions((s) => (sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd))
        : void 0
      const projectKey = wordsNormalizeProject(cwd)
      const draftRef = React.useRef(draft); draftRef.current = draft
      React.useEffect(() => {
        if (typeof inputActions?.setDraft !== 'function') return undefined
        return wordStore.registerInserter((content) => {
          const base = draftRef.current || ''
          const sep = base !== '' && !/\s$/.test(base) ? ' ' : ''
          inputActions.setDraft(base + sep + content)
        })
      }, [inputActions])
      const top = React.useMemo(() => {
        const all = [...state.global, ...(projectKey === null ? [] : (state.projects[projectKey] ?? []))]
        return all.slice().sort((a, b) =>
          (b.useCount - a.useCount) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, n)
      }, [state.global, state.projects, projectKey, n])
      if (top.length === 0) return null
      return h('div', { 'data-enkeep-quick': true }, top.map((p) =>
        h('button', {
          key: p.id, type: 'button', 'data-enkeep-quick-item': true,
          title: p.content,
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => wordStore.insert(p.id),
        }, promptLabel(p))))
    }

    /**
     * PromptsEditor — settings-page CRUD over wordStore. Keyword single-line,
     * content multi-line textarea (large text OK), frequency read-only + reset.
     */
    function PromptsEditor({ store }) {
      const state = useExternalStore(store)
      const [editId, setEditId] = React.useState(null) // null=closed | 'new' | prompt id
      const [bucket, setBucket] = React.useState('global')
      const [key, setKey] = React.useState(null)
      const [kw, setKw] = React.useState('')
      const [content, setContent] = React.useState('')
      const [confirmId, setConfirmId] = React.useState(null)

      const rows = React.useMemo(() => {
        const out = []
        state.global.forEach((p) => out.push({ prompt: p, bucket: 'global', key: null, origin: '全局' }))
        for (const [k, list] of Object.entries(state.projects)) {
          list.forEach((p) => out.push({ prompt: p, bucket: 'project', key: k, origin: k }))
        }
        return out
      }, [state.global, state.projects])

      const trimmedKw = kw.trim()
      const duplicate = trimmedKw !== '' && rows.some((r) => r.prompt.id !== editId && r.prompt.keyword.trim() === trimmedKw)
      const beginEdit = (r) => {
        setEditId(r.prompt.id); setBucket(r.bucket); setKey(r.key)
        setKw(r.prompt.keyword); setContent(r.prompt.content); setConfirmId(null)
      }
      const beginNew = () => { setEditId('new'); setBucket('global'); setKey(null); setKw(''); setContent(''); setConfirmId(null) }
      const cancel = () => { setEditId(null); setKw(''); setContent('') }
      const save = () => {
        const c = content.trim()
        if (c === '') return
        const existing = editId !== 'new' ? rows.find((r) => r.prompt.id === editId) : null
        store.upsert({ id: editId === 'new' ? undefined : editId, keyword: trimmedKw, content: c, useCount: existing ? existing.prompt.useCount : 0 }, bucket, key)
        cancel()
      }
      const preview = (s) => {
        const t = String(s || '').replace(/\s+/g, ' ')
        return t.length > 60 ? t.slice(0, 60) + '…' : t
      }
      const removeRow = (r) => {
        if (confirmId === r.prompt.id) { store.remove(r.prompt.id, r.bucket, r.key); setConfirmId(null) }
        else setConfirmId(r.prompt.id)
      }

      return h('div', { className: 'ekeep-p-wrap' },
        h('div', { className: 'ekeep-p-toolbar' },
          h('button', { type: 'button', className: 'ekeep-p-btn ekeep-p-btnPrimary', onClick: beginNew }, '＋ 新增提示词'),
          h('button', { type: 'button', className: 'ekeep-p-btn', onClick: () => store.resetAllCounts() }, '全部频率归零'),
          h('span', { className: 'ekeep-p-count' }, `共 ${rows.length} 条`)),
        editId !== null ? h('div', { className: 'ekeep-p-edit' },
          h('span', { className: 'ekeep-p-fieldlabel' }, '关键字（可选，3~6 字）'),
          h('input', { className: 'ekeep-p-input', value: kw, placeholder: '例：审核', onChange: (e) => setKw(e.target.value) }),
          duplicate ? h('span', { className: 'ekeep-p-dup' }, '关键字与其他条目重复，仍可保存') : null,
          h('span', { className: 'ekeep-p-fieldlabel' }, '内容（支持多行大段文字）'),
          h('textarea', { className: 'ekeep-p-textarea', rows: 5, value: content, placeholder: '输入提示词正文…', onChange: (e) => setContent(e.target.value) }),
          h('div', { className: 'ekeep-p-toolbar' },
            h('button', { type: 'button', className: 'ekeep-p-btn ekeep-p-btnPrimary', disabled: content.trim() === '', onClick: save }, '确定'),
            h('button', { type: 'button', className: 'ekeep-p-btn', onClick: cancel }, '取消'))) : null,
        rows.length === 0 ? h('div', { className: 'ekeep-p-empty' }, '还没有提示词，点“新增提示词”开始。')
          : h('ul', { className: 'ekeep-p-list' }, rows.map((r) => h('li', {
            key: r.bucket + ':' + r.key + ':' + r.prompt.id, className: 'ekeep-p-row',
          },
            h('div', { className: 'ekeep-p-main' },
              h('span', { className: 'ekeep-p-kw', title: r.prompt.keyword || '（无关键字）' }, r.prompt.keyword || '（无关键字）'),
              h('span', { className: 'ekeep-p-prev', title: r.prompt.content }, r.origin + ' · ' + preview(r.prompt.content))),
            h('span', { className: 'ekeep-p-uses' }, r.prompt.useCount + ' 次'),
            h('div', { className: 'ekeep-p-acts' },
              h('button', { type: 'button', className: 'ekeep-p-mini', onClick: () => beginEdit(r) }, '编辑'),
              h('button', { type: 'button', className: 'ekeep-p-mini', onClick: () => store.resetCount(r.prompt.id, r.bucket, r.key) }, '归零'),
              h('button', { type: 'button', className: 'ekeep-p-mini ekeep-p-miniDanger', onClick: () => removeRow(r) },
                confirmId === r.prompt.id ? '确认删除' : '删除')))))
      )
    }

    // --- Settings UI: side tab bar, one independent config page per feature ---
    // Both the center panel (gear "设置" / plugin detail) and the global settings
    // section share this tabbed body so every feature gets its own page instead
    // of everything being crammed together.
    const SETTINGS_TABS = [
      { id: 'prompts', label: '常用提示词' },
      { id: 'width', label: '聊天宽度' },
      { id: 'activity', label: '浮动对话' },
      { id: 'display', label: '显示与快捷栏' },
    ]

    function EnkeepSettingsBody({ form, store }) {
      const [tab, setTab] = React.useState('prompts')
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const value = form.getSnapshot().value || {}
      const show = value.showLauncher !== false
      const showWords = value.showCommonWords !== false
      const wide = value.chatWidth === 'wide'
      const hoursRaw = Number(value.activityWindowHours)
      const hours = Number.isFinite(hoursRaw) && hoursRaw >= 1 ? hoursRaw : 24
      const limitRaw = Number(value.activityItemLimit)
      const itemLimit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? Math.trunc(limitRaw) : DEFAULT_ITEM_LIMIT
      const dispatchRaw = Number(value.dispatchItemLimit)
      const dispatchLimit = Number.isFinite(dispatchRaw) && dispatchRaw >= 1 && dispatchRaw <= 200 ? Math.trunc(dispatchRaw) : DEFAULT_DISPATCH_LIMIT
      const qRaw = Number(value.quickPromptCount)
      const quickN = Number.isFinite(qRaw) ? Math.max(1, Math.min(12, Math.trunc(qRaw))) : 6
      const busy = React.useRef(false)
      const set = async (field, v) => {
        if (busy.current) return
        busy.current = true
        try { await form.set(field, v) } finally { busy.current = false; force((n) => n + 1) }
      }
      const numStyle = { width: 72, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit' }
      const choice = (active, label, onClick) => h('button', {
        type: 'button', disabled: busy.current, onClick,
        style: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', background: active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent', color: 'inherit', cursor: 'pointer' },
      }, label)

      let pane
      if (tab === 'prompts') {
        pane = h(PromptsEditor, { store })
      } else if (tab === 'width') {
        pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { fontWeight: 600 } }, '聊天区宽度'),
          h('p', { style: { opacity: 0.75, lineHeight: 1.6, margin: 0 } }, '窄屏使用原生布局；宽屏去掉 920px 上限，并按可用列宽自适应。'),
          h('div', { style: { display: 'flex', gap: 8 } },
            choice(!wide, '窄屏', () => set('chatWidth', 'narrow')),
            choice(wide, '宽屏', () => set('chatWidth', 'wide'))),
          h('p', { style: { fontSize: 12, opacity: 0.6, margin: 0 } }, `当前：${wide ? '宽屏' : '窄屏'}。设置保存在插件配置中，重启后保持。`))
      } else if (tab === 'activity') {
        pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { fontWeight: 600 } }, '浮动对话时间窗'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', null, '时间窗（小时）'),
            h('input', {
              type: 'number', min: 1, max: 720, step: 1, value: hours, disabled: busy.current, style: numStyle,
              onChange: (e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 720) set('activityWindowHours', n)
              },
            }),
            h('span', { style: { fontSize: 12, opacity: 0.6 } }, '列出更新于该时长内 / 运行中 / 未读的会话')),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', null, '最多显示会话数（1~200）'),
            h('input', {
              type: 'number', min: 1, max: 200, step: 1, value: itemLimit, disabled: busy.current, style: numStyle,
              onChange: (e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 200) set('activityItemLimit', Math.trunc(n))
              },
            }),
            h('span', { style: { fontSize: 12, opacity: 0.6 } }, '上区对话列表最多列出 N 个会话（置顶优先，仍计入名额）')),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', null, '外派列表最多显示（1~200）'),
            h('input', {
              type: 'number', min: 1, max: 200, step: 1, value: dispatchLimit, disabled: busy.current, style: numStyle,
              onChange: (e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 200) set('dispatchItemLimit', Math.trunc(n))
              },
            }),
            h('span', { style: { fontSize: 12, opacity: 0.6 } }, '下区「当前对话的外派对话」独立上限（默认 10，与上方会话数互不影响）')))
      } else {
        pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          h('div', { style: { fontWeight: 600 } }, '显示与快捷栏'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('input', { type: 'checkbox', checked: show, onChange: (e) => set('showLauncher', e.target.checked) }),
            h('span', null, '显示侧栏按钮')),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('input', { type: 'checkbox', checked: showWords, onChange: (e) => set('showCommonWords', e.target.checked) }),
            h('span', null, '显示常用词按钮（输入框右侧）')),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', null, '高频提示词数量（1~12）'),
            h('input', {
              type: 'number', min: 1, max: 12, step: 1, value: quickN, disabled: busy.current, style: numStyle,
              onChange: (e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 12) set('quickPromptCount', n)
              },
            }),
            h('span', { style: { fontSize: 12, opacity: 0.6 } }, '按使用频率显示前 N 个，点击即插入')))
      }

      return h('div', { className: 'ekeep-set-body' },
        h('nav', { className: 'ekeep-set-tabs' }, SETTINGS_TABS.map((t) => h('button', {
          key: t.id, type: 'button',
          className: 'ekeep-set-tab' + (tab === t.id ? ' ekeep-set-tabActive' : ''),
          onClick: () => setTab(t.id),
          title: t.label,
        }, t.label))),
        h('div', { className: 'ekeep-set-pane' }, pane))
    }

    // Center-column panel opened by the activity-bar gear ("设置") and the
    // plugin-detail action. onClose calls layout.selectPanel(null) -> conversation.
    function EnkeepPanel({ form, store, onClose }) {
      return h('div', { className: 'ekeep-set-root' },
        h('div', { className: 'ekeep-set-head' },
          h('span', { className: 'ekeep-set-title' }, 'Enkeep 设置'),
          typeof onClose === 'function'
            ? h('button', { type: 'button', className: 'ekeep-set-close', onClick: onClose, title: '关闭设置（返回对话）', 'aria-label': '关闭设置' }, '✕')
            : null),
        h(EnkeepSettingsBody, { form, store }))
    }

    // Global settings-page section reuses the same tabbed body.
    function EnkeepSettings({ form, store }) {
      return h(EnkeepSettingsBody, { form, store })
    }

    return {
      // Service names taken from the client context (not package names — those
      // belong in dsh.client.inject). 'layout' is acquired lazily via ctx.inject.
      inject: ['slots', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(NAMESPACE)

        // (1) Chat width: insert/remove a <style> tag that overrides the
        // conversation body variable directly (stable selector, no hash).
        ctx.effect(() => {
          let disposeWidth = null
          const applyWidth = () => {
            const value = form.getSnapshot().value || {}
            const wantWide = value.chatWidth === 'wide'
            if (wantWide && disposeWidth === null) {
              disposeWidth = installWideStyle()
            } else if (!wantWide && disposeWidth !== null) {
              const stop = disposeWidth
              disposeWidth = null
              stop()
            }
          }
          applyWidth()
          const stopSub = form.subscribe(applyWidth)
          return () => { stopSub(); disposeWidth?.() }
        }, 'enkeep: width')

        // (1b) Optional git-panel split handle: inert when git-panel is absent.
        ctx.effect(() => {
          const stopStyle = installGitPanelStyle()
          const stopSplit = setupGitPanelSplit()
          return () => { stopSplit(); stopStyle() }
        }, 'enkeep: gitpanel-split')

        // (2) Sidebar launcher + center panel. Structure follows dsh-im:
        // one ctx.inject(['layout']) whose callback owns and returns a single
        // disposer; the main keyed panel is the parent registration, and the
        // sidebar.panellist row (same id as the panel key) is toggled by config.
        // Guard for older/partial installations where layout is absent.
        if (typeof ctx.inject === 'function') {
          ctx.inject(['layout'], (layoutCtx) =>
            layoutCtx.slots.inject('main', () => {
              const closePanel = () => {
                const l = layoutCtx.layout
                if (l && typeof l.selectPanel === 'function') l.selectPanel(null)
              }
              const unregisterPage = layoutCtx.slots.register({
                name: 'main',
                key: PANEL_ID,
                inject: () => ({ form, store: wordStore, onClose: closePanel }),
              }, ({ form: f, store: s, onClose }) => h(EnkeepPanel, { form: f, store: s, onClose }))

              let stopSidebar = null
              const sync = () => {
                const value = form.getSnapshot().value || {}
                const want = value.showLauncher !== false
                if (want && stopSidebar === null) {
                  stopSidebar = layoutCtx.slots.inject('sidebar.panellist', () =>
                    layoutCtx.slots.register({
                      name: 'sidebar.panellist',
                      id: PANEL_ID,
                      order: 10,
                      label: 'Enkeep',
                    }, EnkeepSidebarIcon))
                } else if (!want && stopSidebar !== null) {
                  const stop = stopSidebar
                  stopSidebar = null
                  stop()
                }
              }
              const stopSub = form.subscribe(sync)
              sync()

              // Also offer an explicit "open" action on our plugin detail page.
              const stopActions = layoutCtx.slots.inject('plugins.detail.actions', () =>
                layoutCtx.slots.register({
                  name: 'plugins.detail.actions',
                  id: 'enkeep-open',
                  order: 20,
                  inject: () => ({ onOpen: () => layoutCtx.layout.selectPanel(PANEL_ID) }),
                }, ({ onOpen }) => h('button', { type: 'button', onClick: onOpen }, '打开 Enkeep')))

              return () => {
                stopSub()
                stopSidebar?.()
                stopActions()
                unregisterPage()
              }
            }))
        }

        // (3) Activity bar: always-on floating strip on shell.overlay (additive).
        // openSession is resolved lazily at click time: the uiWorkspace service
        // is shipped by client-ui-workspace and may mount after us; ctx.get +
        // optional chain keeps us safe. Style install is idempotent + disposed.
        ctx.effect(() => {
          const stopStyle = installActivityStyle()
          const get = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
          const openSession = (sessionId) => {
            const uiWorkspace = get('uiWorkspace')
            if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
              uiWorkspace.openSession(sessionId)
            } else {
              console.warn('[enkeep] uiWorkspace.openSession unavailable; cannot open session', sessionId)
            }
          }
          // New session: same public call the sidebar's Ctrl+N uses.
          // Optional preset starts the session under a specific agent preset;
          // optional workspaceId pins the new session to the selected workspace.
          // No-arg keeps the original dsh-default behaviour (backwards compatible).
          const newSession = (preset, workspaceId) => {
            const uiWorkspace = get('uiWorkspace')
            if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
              if (preset) {
                if (workspaceId) uiWorkspace.startSession(workspaceId, { agentPreset: preset })
                else uiWorkspace.startSession(undefined, { agentPreset: preset })
              } else uiWorkspace.startSession()
            } else console.warn('[enkeep] uiWorkspace.startSession unavailable')
          }
          // Add workspace: the sidebar's addRequested flow is private; these two
          // documented public calls produce the same result (pick dir -> adopt it).
          const addWorkspace = async () => {
            const uiWorkspace = get('uiWorkspace')
            const workspaces = get('workspaces')
            if (!uiWorkspace || typeof uiWorkspace.pickDirectory !== 'function' || !workspaces || typeof workspaces.create !== 'function') {
              console.warn('[enkeep] add-workspace services unavailable'); return
            }
            const path = await uiWorkspace.pickDirectory()
            if (path) await workspaces.create({ path })
          }
          // Settings: open our own Enkeep config panel via the same public call
          // used by the plugin detail "打开 Enkeep" action (no global-settings API).
          const openSettings = () => {
            const layout = get('layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
            else console.warn('[enkeep] layout.selectPanel unavailable; cannot open settings panel')
          }
          // Row actions: official pin/unpin/archive are public uiWorkspace methods.
          const pinSession = (id) => {
            const uiWorkspace = get('uiWorkspace')
            if (uiWorkspace && typeof uiWorkspace.pinSession === 'function') return uiWorkspace.pinSession(id)
            console.warn('[enkeep] uiWorkspace.pinSession unavailable'); return undefined
          }
          const unpinSession = (id) => {
            const uiWorkspace = get('uiWorkspace')
            if (uiWorkspace && typeof uiWorkspace.unpinSession === 'function') return uiWorkspace.unpinSession(id)
            console.warn('[enkeep] uiWorkspace.unpinSession unavailable'); return undefined
          }
          // options (e.g. { stopActivity: true }) are forwarded as-is; the official
          // archiveSession(sessionId, options = {}) applies its own default for
          // undefined. Throw on a missing service so the caller's catch shows a
          // visible failure instead of treating `undefined` as success (which
          // would clear our local pinned set without actually archiving).
          const archiveSession = (id, options) => {
            const uiWorkspace = get('uiWorkspace')
            if (uiWorkspace && typeof uiWorkspace.archiveSession === 'function') {
              return uiWorkspace.archiveSession(id, options)
            }
            throw new Error('uiWorkspace.archiveSession 服务不可用')
          }
          // Rename uses the public low-level sessions.using(...).rename path —
          // the official rename dialog trigger is an internal slot, not exposed.
          // Workspace deletion uses the same public service the sidebar uses:
          // workspaces.delete(workspaceId) — removes the registration only,
          // keeping the folder and session logs.
          const deleteWorkspace = async (workspaceId) => {
            const workspaces = get('workspaces')
            if (!workspaces || typeof workspaces.delete !== 'function') {
              throw new Error('workspaces.delete 服务不可用')
            }
            return workspaces.delete(workspaceId)
          }
          const renameSession = async (id, title) => {
            const sessionsSvc = get('sessions')
            if (!sessionsSvc || typeof sessionsSvc.using !== 'function') {
              throw new Error('sessions 服务不可用')
            }
            const result = await sessionsSvc.using(id, { source: 'workspaceOperation' }, (ref) => ref.binding.session.rename(title))
            if (result && result.ok === false) throw new Error(result.error && result.error.message ? result.error.message : 'rename rejected')
          }
          const stopOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-enkeep.activity-bar',
            order: 100,
            inject: () => ({ form, openSession, newSession, addWorkspace, openSettings, pinSession, unpinSession, archiveSession, renameSession, deleteWorkspace }),
          }, (props) => h(ActivityBar, {
            form: props.form,
            openSession: props.openSession,
            newSession: props.newSession,
            addWorkspace: props.addWorkspace,
            openSettings: props.openSettings,
            pinSession: props.pinSession,
            unpinSession: props.unpinSession,
            archiveSession: props.archiveSession,
            renameSession: props.renameSession,
            deleteWorkspace: props.deleteWorkspace,
            useSessions: props.useSessions,
            useSessionStatus: props.useSessionStatus,
            useWorkspaces: props.useWorkspaces,
          })))
          // Last-prompt bar: register as an additive LIST entry in the same
          // conversation.input.dock slot the git chip + task bar use, so the
          // official layout stacks us in normal flow (never overlapping).
          const stopDock = ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'enkeep-last-prompt',
            order: 200, // after git chip (100) / task bar → closest to input
          }, () => h(LastPromptDockBar)))
          return () => { stopOverlay(); stopDock(); stopStyle() }
        }, 'enkeep: activity bar')

        // (3a) Last user prompt bar stylesheet: idempotent install + dispose.
        // The bar DOM itself is a React component registered into the additive
        // conversation.input.dock list slot (see the activity-bar effect above)
        // and lives in normal document flow, so it never overlaps other plugins
        // and is never clobbered by official message-list re-renders. Observer +
        // text extraction live in the component; this effect only owns the CSS.
        ctx.effect(() => {
          const stopStyle = installLastPromptStyle()
          return () => { stopStyle() }
        }, 'enkeep: last prompt bar')

        // (3b) Header title: prefix the NATIVE current crumb with the workspace
        // dir and enlarge it in place (done by HEADER_CSS). We register an
        // empty-render driver in the additive LIST slot
        // "conversation.session.header.actions" purely to get reactive session
        // data for the prefix string — it adds no visible entry to the header.
        // NOTE: never use "conversation.session.header.lineage" — it is
        // kind:"single", is already registered by
        // @deepseek-ai/dsh-client-ui-subagent, and a second registration at the
        // same priority throws, which fails that entry at web boot
        // ("1 entry did not activate"). Style/disposer are idempotent.
        ctx.effect(() => {
          const stopStyle = installHeaderStyle()
          const stopCompactStyle = installCompactHeaderStyle()
          const stopHeader = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'enkeep-header-title',
            order: 5,
            inject: () => ({}),
          }, (props) => h(HeaderTitle, {
            useSessions: props.useSessions,
            sessionId: props.sessionId,
          })))
          return () => {
            stopHeader()
            stopStyle()
            stopCompactStyle()
            if (typeof document !== 'undefined') {
              document.documentElement.style.removeProperty('--enkeep-dir-prefix')
              document.documentElement.style.removeProperty('--enkeep-tabs-left')
              document.documentElement.style.removeProperty('--enkeep-tabs-shift')
            }
          }
        }, 'enkeep: header title')

        // (3c) Derived-task stats chip in the SAME additive header.actions list,
        // order 25 -> right after job-list (20). Never register lineage.
        ctx.effect(() => {
          const stopStyle = installTaskStatsStyle()
          const stopChip = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'enkeep-assistant-task-stats',
            order: 25,
          }, (props) => h(AssistantTaskStats, { sessionId: props.sessionId })))
          return () => { stopChip(); stopStyle() }
        }, 'enkeep: assistant task stats')

        // (4) Settings page entry with toggles + activity window input.
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'enkeep',
          order: 30,
          label: 'Enkeep',
          inject: () => ({ form, store: wordStore }),
        }, ({ form: f, store: s }) => h(EnkeepSettings, { form: f, store: s }))), 'enkeep: settings')

        // (5) Below-input composer dock: current-session label + quick prompts in
        // one full-width row prepended above the ENTIRE native stats row (turns /
        // speed / token / cache-hit / context-ratio stay together as one line).
        // order:-1 puts our row first in the dock so the native pills + ContextMeter
        // all wrap to the second line as a unit. Standard props
        // (useSessions/sessionId/useInput/inputActions) are auto-injected by the
        // renderer into session-scope slot entries; `form` comes from inject so the
        // quick row reads quickPromptCount live.
        ctx.effect(() => {
          const stopStyle = installCurrentStyle()
          const stopDock = ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'enkeep-composer-dock',
            order: -1,
            inject: () => ({ form }),
          }, (props) => h(ComposerDock, {
            form: props.form,
            useSessions: props.useSessions,
            sessionId: props.sessionId,
            useInput: props.useInput,
            inputActions: props.inputActions,
          })))
          return () => { stopDock(); stopStyle() }
        }, 'enkeep: composer dock')

        // (6) Common words: trigger + panel on the composer's trailing side.
        // conversation.input.right is a session-scope list slot; useInput /
        // inputActions / useSessions / sessionId are standard injected props.
        ctx.effect(() => {
          const stopStyle = installWordsStyle()
          let stopWords = null
          const sync = () => {
            const want = (form.getSnapshot().value || {}).showCommonWords !== false
            if (want && stopWords === null) {
              stopWords = ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
                name: 'conversation.input.right',
                id: 'enkeep-common-words',
                order: 30,
              }, (props) => h(CommonWords, {
                useInput: props.useInput,
                inputActions: props.inputActions,
                useSessions: props.useSessions,
                sessionId: props.sessionId,
              })))
            } else if (!want && stopWords !== null) {
              const stop = stopWords
              stopWords = null
              stop()
            }
          }
          const stopSub = form.subscribe(sync)
          sync()
          return () => { stopSub(); stopWords?.(); stopStyle() }
        }, 'enkeep: common words')
      },
    }
  },
})
