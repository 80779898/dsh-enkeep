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
      'right:calc(var(--dsh-windows-sidebar-width, var(--dsh-sidebar-width, 260px)) + var(--dsh-sidebar-inline-padding, 12px) + 8px);',
      'width:380px;max-width:calc(100vw - 32px);z-index:40;',
      'display:flex;flex-direction:column;gap:4px;padding:8px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:10px;',
      'background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #202124) 94%, #000);',
      'box-shadow:0 4px 20px rgba(0,0,0,.28);pointer-events:auto;',
      'opacity:1;}',
      // 侧栏折叠时主侧栏列收缩为 56px 图标栏（cols.sidebar=56）；
      // 不隐藏，改为贴着图标栏继续显示，保证“始终悬浮”。
      '[data-sidebar-collapsed] [data-enkeep-activity-bar]{',
      'right:calc(56px + var(--dsh-sidebar-inline-padding, 12px) + 8px);}',
      '[data-enkeep-activity-head]{display:flex;align-items:center;gap:6px;',
      'font-size:12px;opacity:.75;padding:0 2px 2px;cursor:move;user-select:none;}',
      // Dragging state: stronger shadow + grabbing cursor; transform is set inline
      // on the bar by the component (叠加在默认 CSS 定位之上).
      '[data-enkeep-activity-bar][data-dragging]{cursor:grabbing;',
      'box-shadow:0 10px 32px rgba(0,0,0,.42);transition:none;}',
      '[data-enkeep-activity-head] strong{font-weight:600;}',
      '[data-enkeep-activity-actions]{display:flex;align-items:center;gap:2px;margin-left:auto;}',
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
      // 当前对话(叠加高亮行 + “当前”徽标；当前通常也是运行中，故双重标识)。
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
      'background:color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8bf5) 12%, transparent);}',
      '[data-enkeep-current-badge]{flex:none;font-size:10px;line-height:14px;padding:0 5px;',
      'border-radius:6px;color:var(--dsw-alias-state-business-primary, #4c8bf5);',
      'border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #4c8bf5) 45%, transparent);}',
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

    // --- Composer current-session chip ---------------------------------------
    // Current-session label + quick prompts, rendered on composer.composer.dock
    // (the composer's bottom row, below the textarea). Our content sits on the
    // LEFT of that single row; the native stats pills + ContextMeter stay RIGHT.
    const CURRENT_STYLE_ID = 'enkeep-current'
    const CURRENT_CSS = [
      // Stretch the shared dock to the composer card width so our left content
      // lines up with the textarea and the native stats sit flush-right. This only
      // READS the width var as a max (never writes/overrides it) -> isolation kept.
      '[data-composer-dock]{width:100%;max-width:var(--dsh-composer-card-max-width,100%);}',
      // Grow to absorb free space, pushing native stats to the right edge.
      '[data-enkeep-composer-current]{',
      'display:flex;justify-content:flex-start;align-items:center;gap:6px;',
      'flex:1 1 auto;width:auto;min-width:0;max-width:none;margin:0;}',
      // Current-session chip: keep native (white) text for readability, and use a
      // soft amber border + a very faint amber wash to read as "current" at a glance
      // — noticeable but not jumpy. warn-primary maps to dsw amber (#f59e0b) and
      // color-mix keeps it coherent in both themes; no new tokens or deps.
      '[data-enkeep-current-chip]{',
      'display:inline-flex;align-items:center;max-width:100%;flex:none;',
      'padding:3px 10px;font-size:12px;line-height:18px;',
      'border-radius:999px;',
      'border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 50%, transparent);',
      'background:color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 8%, var(--dsw-alias-bg-layer-2, #202124));',
      'color:var(--dsw-alias-text-1);}',
      '[data-enkeep-current-label]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      // High-frequency quick-access row: single line, horizontal scroll, never wraps
      // and never writes chat-width variables (width isolation).
      '[data-enkeep-quick]{display:flex;align-items:center;gap:4px;',
      'min-width:0;flex:1 1 auto;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;}',
      '[data-enkeep-quick]::-webkit-scrollbar{height:4px;}',
      '[data-enkeep-quick]::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3);border-radius:4px;}',
      '[data-enkeep-quick-item]{flex:0 0 auto;max-width:170px;overflow:hidden;text-overflow:ellipsis;',
      'white-space:nowrap;padding:3px 9px;font-size:12px;line-height:18px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:999px;',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-text-2);cursor:pointer;}',
      '[data-enkeep-quick-item]:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-text-1);}',
      '[data-enkeep-quick-item]:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px;}',
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
    // 排除 blank、subagent 子行、归档会话。返回按 SessionId 字典序的有限列表（稳定不重排）。
    const MAX_ITEMS = 30
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
    function selectActivity(sessions, statuses, archivedIds, hours, now, pinnedSet) {
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
        const recent = (now - (row.updatedAt || 0)) <= winMs
        const isPinned = pinned.has(id)
        // 归档/subagent/blank 已在上面剔除（归档优先：即使置顶也不显示）。
        // 置顶会话锁定常显；等待互动的会话即使超时也保留——两者都需要用户注意。
        if (!running && !unread && !recent && !isPinned && !awaiting) continue
        // state 决定圆点：等待互动 > 运行中 > 完成未看 > 完成已看(未超时)。
        // current 是叠加维度（当前通常也是运行中），单独标记。
        const state = awaiting ? 'awaiting' : (running ? 'ongoing' : (unread ? 'unread' : 'idle'))
        // rawTitle is the actual session title (no directory prefix) — used by the
        // rename dialog so editing never bakes "dir: " into the stored title.
        const rawTitle = (row.title && row.title.trim()) || row.displayTitle || id
        out.push({ id, state, awaiting, current: id === current, pinned: isPinned, label: sessionLabel(row, id), rawTitle })
      }
      // 排序分两段：置顶区在前，普通区在后；各自按 SessionId 字典序——
      // id 是不可变的（session-<uuid>），顺序固定，点击/聊天都不会让其重排。
      // current 只作高亮/徽标，不排序。
      const byIdOrder = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      const pinnedRows = out.filter((r) => r.pinned).sort(byIdOrder)
      const normalRows = out.filter((r) => !r.pinned).sort(byIdOrder)
      return pinnedRows.concat(normalRows).slice(0, MAX_ITEMS)
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
      return null
    }

    // Above-composer dock: current-session plain label (left) + high-frequency
    // prompt buttons (right, same row). `useSessions`/`sessionId`/`useInput`/
    // `inputActions` are standard props auto-injected into session-scope slots.
    // `form` is supplied via inject so the quick row can read quickPromptCount.
    function ComposerDock({ form, useSessions, sessionId, useInput, inputActions }) {
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const row = typeof useSessions === 'function'
        ? useSessions((s) => (sessionId === void 0 ? void 0 : (s && s.byId) ? s.byId[sessionId] : undefined))
        : void 0
      const label = row ? sessionLabel(row, sessionId) : ''
      const chip = label ? h('div', { 'data-enkeep-current-chip': true, title: label },
        h('span', { 'data-enkeep-current-label': true }, label)) : null
      const showWords = (form.getSnapshot().value || {}).showCommonWords !== false
      const quick = showWords ? h(QuickPrompts, { form, useInput, inputActions, useSessions, sessionId }) : null
      if (!chip && !quick) return null
      return h('div', { 'data-enkeep-composer-current': true }, chip, quick)
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

    function ActivityBar({ form, openSession, newSession, addWorkspace, openSettings, pinSession, unpinSession, archiveSession, renameSession, useSessions, useSessionStatus, useWorkspaces }) {
      const [collapsed, setCollapsed] = React.useState(false)
      const [, setTick] = React.useState(0)
      const [hours, setHours] = React.useState(24)
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

      // Re-render when the config form changes (window hours).
      React.useEffect(() => form.subscribe(() => {
        const v = Number((form.getSnapshot().value || {}).activityWindowHours)
        setHours(Number.isFinite(v) && v >= 1 ? v : 24)
      }), [form])
      React.useEffect(() => {
        const v = Number((form.getSnapshot().value || {}).activityWindowHours)
        setHours(Number.isFinite(v) && v >= 1 ? v : 24)
      }, [form])

      // Time-window sessions must fall out on their own: re-evaluate each minute
      // and whenever the window regains focus. Dispose both on unmount (HMR safe).
      React.useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), 60000)
        const onFocus = () => setTick((n) => n + 1)
        window.addEventListener('focus', onFocus)
        return () => { clearInterval(timer); window.removeEventListener('focus', onFocus) }
      }, [])

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

      const sessions = useSessions ? useSessions((s) => s) : undefined
      const statuses = useSessionStatus ? useSessionStatus((s) => s) : undefined
      const ws = useWorkspaces ? useWorkspaces((s) => s) : undefined
      const archived = ws && ws.archivedSessionIds ? new Set(ws.archivedSessionIds) : new Set()
      const pinnedSet = new Set(pinned)
      const items = selectActivity(sessions, statuses, archived, hours, Date.now(), pinnedSet)

      if (items.length === 0 && !confirmArchive && !stopArchiveTarget && !archiveError && !renameTarget) return null

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
          h('strong', null, '活动区'),
          h('span', null, `${items.length} 个`),
          h('div', { 'data-enkeep-activity-actions': true },
            h('button', {
              type: 'button',
              'data-enkeep-activity-action': true,
              disabled: busy,
              title: '新建对话',
              'aria-label': '新建对话',
              onClick: runAction(newSession),
            }, h(HeaderIcon, { kind: 'new' })),
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
              title: collapsed ? '展开活动区' : '收起活动区',
              'aria-label': collapsed ? '展开活动区' : '收起活动区',
            }, h(HeaderIcon, { kind: collapsed ? 'expand' : 'collapse' })))),
        !collapsed && items.map((it) =>
          h('div', {
            key: it.id,
            'data-enkeep-activity-item': true,
            'data-enkeep-pinned': it.pinned ? true : undefined,
            'data-enkeep-current': it.current ? true : undefined,
          },
            h('button', {
              type: 'button',
              'data-enkeep-activity-main': true,
              title: it.label + (it.awaiting ? '（等待互动）' : '') + (it.current ? '（当前对话）' : ''),
              onClick: () => openSession(it.id),
            },
              h('span', { 'data-enkeep-dot': it.state }),
              h('span', { 'data-enkeep-activity-label': true }, it.label),
              it.current ? h('span', { 'data-enkeep-current-badge': true }, '当前') : null),
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
              }, h(HeaderIcon, { kind: it.pinned ? 'unpin' : 'pin' }))))),
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
    function useWordStore(store) {
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
      const state = useWordStore(wordStore)
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
      const state = useWordStore(wordStore)
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
      const state = useWordStore(store)
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
      { id: 'activity', label: '活动区' },
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
          h('div', { style: { fontWeight: 600 } }, '活动区时间窗'),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', null, '时间窗（小时）'),
            h('input', {
              type: 'number', min: 1, max: 720, step: 1, value: hours, disabled: busy.current, style: numStyle,
              onChange: (e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 720) set('activityWindowHours', n)
              },
            }),
            h('span', { style: { fontSize: 12, opacity: 0.6 } }, '列出更新于该时长内 / 运行中 / 未读的会话')))
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
          const newSession = () => {
            const uiWorkspace = get('uiWorkspace')
            if (uiWorkspace && typeof uiWorkspace.startSession === 'function') uiWorkspace.startSession()
            else console.warn('[enkeep] uiWorkspace.startSession unavailable')
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
            inject: () => ({ form, openSession, newSession, addWorkspace, openSettings, pinSession, unpinSession, archiveSession, renameSession }),
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
            useSessions: props.useSessions,
            useSessionStatus: props.useSessionStatus,
            useWorkspaces: props.useWorkspaces,
          })))
          return () => { stopOverlay(); stopStyle() }
        }, 'enkeep: activity bar')

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
