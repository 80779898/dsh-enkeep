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
      'width:300px;max-width:calc(100vw - 32px);z-index:40;',
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
      'font-size:12px;opacity:.75;padding:0 2px 2px;}',
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
      '[data-enkeep-activity-item]{display:flex;align-items:center;gap:8px;width:100%;',
      'text-align:left;border:0;border-radius:6px;padding:5px 8px;',
      'background:transparent;color:inherit;cursor:pointer;font-size:12px;}',
      '[data-enkeep-activity-item]:hover{background:var(--dsw-alias-bg-layer-3);}',
      // 四种标识：运行中(绿+脉冲环) / 完成未看(橙点) / 完成已看(灰点) /
      // 当前对话(叠加高亮行 + “当前”徽标；当前通常也是运行中，故双重标识)。
      '[data-enkeep-dot]{flex:0 0 auto;width:8px;height:8px;border-radius:50%;',
      'background:var(--dsw-alias-text-4, #8b8b8b);}',
      '[data-enkeep-dot="ongoing"]{background:var(--dsw-alias-state-success-primary, #35b37e);',
      'animation:enkeep-activity-pulse 1.6s ease-in-out infinite;}',
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
    // A plain label above the input box (conversation.input.dock), same position
    // as dsh-git-panel's branch chip but no dropdown. Width follows the text.
    const CURRENT_STYLE_ID = 'enkeep-current'
    const CURRENT_CSS = [
      '[data-enkeep-composer-current]{',
      'display:flex;justify-content:flex-start;',
      'width:100%;max-width:var(--dsh-composer-card-max-width,800px);margin:0 auto;}',
      '[data-enkeep-current-chip]{',
      'display:inline-flex;align-items:center;max-width:100%;',
      'padding:3px 10px;font-size:12px;line-height:18px;',
      'border:1px solid var(--dsw-alias-border-l3);border-radius:999px;',
      'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-text-1);}',
      '[data-enkeep-current-label]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
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
    function selectActivity(sessions, statuses, archivedIds, hours, now) {
      const byId = (sessions && sessions.byId) || {}
      const ids = (sessions && sessions.ids) || []
      const archived = archivedIds || new Set()
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
        const recent = (now - (row.updatedAt || 0)) <= winMs
        if (!running && !unread && !recent) continue
        // state 决定圆点：运行中 > 完成未看 > 完成已看(未超时)。
        // current 是叠加维度（当前通常也是运行中），单独标记。
        const state = running ? 'ongoing' : (unread ? 'unread' : 'idle')
        out.push({ id, state, current: id === current, label: sessionLabel(row, id) })
      }
      // 按 SessionId 字典序——id 是不可变的（session-<uuid>），顺序固定，
      // 点击切换或聊天（更新 updatedAt）都不会让列表重排，真正稳定。
      // 说明：创建时间未暴露给列表行（仅 Host 线协议头有 createdAt），
      // 且 ids 顺序本身是 updatedAt 降序（聊天会变），id 排序是唯一可用的
      // 不可变稳定键；顺序看似随机但恒定，符合要求。current 只作高亮/徽标，不排序。
      out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      return out.slice(0, MAX_ITEMS)
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
      return null
    }

    // Current-session chip rendered above the composer input. `useSessions`
    // (root) and `sessionId` (session scope) are standard props auto-injected
    // into every conversation.input.dock entry — no service inject needed.
    // Plain label only: no "当前" badge, no dropdown, not clickable.
    function CurrentSessionBar({ useSessions, sessionId }) {
      if (!sessionId || !useSessions) return null
      const row = useSessions((s) => (s && s.byId) ? s.byId[sessionId] : undefined)
      if (!row) return null
      const label = sessionLabel(row, sessionId)
      if (!label) return null
      return h('div', { 'data-enkeep-composer-current': true },
        h('div', { 'data-enkeep-current-chip': true, title: label },
          h('span', { 'data-enkeep-current-label': true }, label)))
    }

    // --- Activity bar: always-on floating strip of active sessions -----------
    // Standard hook props (useSessions/useSessionStatus/useWorkspaces) are injected
    // by the renderer into every shell.overlay slot component — no service inject.
    function ActivityBar({ form, openSession, newSession, addWorkspace, openSettings, useSessions, useSessionStatus, useWorkspaces }) {
      const [collapsed, setCollapsed] = React.useState(false)
      const [, setTick] = React.useState(0)
      const [hours, setHours] = React.useState(24)
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)

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

      const sessions = useSessions ? useSessions((s) => s) : undefined
      const statuses = useSessionStatus ? useSessionStatus((s) => s) : undefined
      const ws = useWorkspaces ? useWorkspaces((s) => s) : undefined
      const archived = ws && ws.archivedSessionIds ? new Set(ws.archivedSessionIds) : new Set()
      const items = selectActivity(sessions, statuses, archived, hours, Date.now())

      if (items.length === 0) return null

      return h('div', { 'data-enkeep-activity-bar': true },
        h('div', { 'data-enkeep-activity-head': true },
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
          h('button', {
            type: 'button',
            key: it.id,
            'data-enkeep-activity-item': true,
            'data-enkeep-current': it.current ? true : undefined,
            title: it.label + (it.current ? '（当前对话）' : ''),
            onClick: () => openSession(it.id),
          },
            h('span', { 'data-enkeep-dot': it.state }),
            h('span', { 'data-enkeep-activity-label': true }, it.label),
            it.current ? h('span', { 'data-enkeep-current-badge': true }, '当前') : null)))
    }

    // --- Common words (ported from dsh-wordbox) --------------------------------
    // localStorage keys — enkeep-owned, isolated from wordbox's dsh.common-word-box.*
    const WORDS_GLOBAL_KEY = 'dsh.enkeep.words.global.v1'
    const WORDS_PROJECT_KEY = 'dsh.enkeep.words.project.v1'
    const WORDS_MODE_KEY = 'dsh.enkeep.words.mode.v1'
    const WORDS_MODES = ['all', 'global', 'current']
    const WORDS_SYNC_URL = '/dsh-enkeep-words/state'
    const WORDS_SYNC_HEADERS = { 'x-dsh-enkeep-words': '1' }
    const WORDS_SYNC_POLL_MS = 10000
    const WORDS_FLOW_SPEED = 60 // px/s for long-word marquee

    function wordsLoadList(key) {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((w) => typeof w === 'string') : []
      } catch { return [] }
    }
    function wordsLoadProjects() {
      try {
        const raw = localStorage.getItem(WORDS_PROJECT_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out = {}
        for (const [dir, list] of Object.entries(parsed)) {
          out[dir] = Array.isArray(list) ? list.filter((w) => typeof w === 'string') : []
        }
        return out
      } catch { return {} }
    }
    function wordsSaveList(key, words) {
      try { localStorage.setItem(key, JSON.stringify(words)) } catch { /* quota/disabled: ignore */ }
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

    // Single word row: long text truncated, marquee on hover, delete + optional "to global".
    function WordsRow({ word, showToGlobal, alreadyGlobal, onInsert, onRemove, onAddToGlobal }) {
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
          ref: btnRef, type: 'button', className: 'ekeep-w-word', title: word,
          onMouseDown: (e) => e.preventDefault(), onClick: () => onInsert(word),
        }, h('span', {
          ref: textRef, className: 'ekeep-w-wordText',
          style: hovered && overflow > 0 ? {
            transform: 'translateX(-' + overflow + 'px)',
            transitionDuration: flowDuration.toFixed(2) + 's',
            transitionTimingFunction: 'linear',
          } : undefined,
        }, word)),
        showToGlobal && !alreadyGlobal ? h('button', {
          type: 'button', className: 'ekeep-w-toGlobal', title: '添加到全局', 'aria-label': '添加到全局',
          onMouseDown: (e) => e.preventDefault(), onClick: () => onAddToGlobal(word),
        }, toGlobalIcon) : null,
        h('button', {
          type: 'button', className: 'ekeep-w-del', title: '删除', 'aria-label': '删除',
          onMouseDown: (e) => e.preventDefault(), onClick: () => onRemove(word),
        }, '×'))
    }

    // Trigger icon: inline SVG bookmark/list glyph, same 16x16 / 1.5 stroke spec as HeaderIcon.
    function WordsTriggerIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M4 2.75h8a1 1 0 0 1 1 1v9.5l-5-3-5 3v-9.5a1 1 0 0 1 1-1z' }))
    }

    /**
     * CommonWords — registered into conversation.input.right (session scope).
     * Standard props: useInput / inputActions / useSessions / sessionId.
     * Hardcoded Chinese labels to stay consistent with enkeep's other components.
     */
    function CommonWords({ useInput, inputActions, useSessions, sessionId }) {
      const [open, setOpen] = React.useState(false)
      const [editing, setEditing] = React.useState(false)
      const [draftWord, setDraftWord] = React.useState('')
      const [mode, setMode] = React.useState(wordsLoadMode)
      const [globalWords, setGlobalWords] = React.useState(() => wordsLoadList(WORDS_GLOBAL_KEY))
      const [projects, setProjects] = React.useState(wordsLoadProjects)
      const draft = typeof useInput === 'function' ? (useInput((s) => (s === void 0 ? '' : s.draft)) ?? '') : ''
      const cwd = typeof useSessions === 'function'
        ? useSessions((s) => (sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd))
        : void 0
      const projectKey = wordsNormalizeProject(cwd)
      const projectWords = projectKey === null ? [] : (projects[projectKey] ?? [])

      // Persist to localStorage (instant cache + offline fallback).
      React.useEffect(() => { wordsSaveList(WORDS_GLOBAL_KEY, globalWords) }, [globalWords])
      React.useEffect(() => { wordsSaveProjects(projects) }, [projects])
      React.useEffect(() => { wordsSaveMode(mode) }, [mode])

      // Cross-tab sync via storage events.
      React.useEffect(() => {
        const onStorage = (event) => {
          if (event.key === WORDS_GLOBAL_KEY) setGlobalWords(wordsLoadList(WORDS_GLOBAL_KEY))
          else if (event.key === WORDS_PROJECT_KEY) setProjects(wordsLoadProjects())
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])

      // --- server shared storage (three-way merge) ---
      const syncRevRef = React.useRef(0)
      const syncHydratedRef = React.useRef(false)
      const syncSentRef = React.useRef(null)
      const syncBaseRef = React.useRef(null)
      const syncStateRef = React.useRef({ mode: 'all', globalWords: [], projects: {} })
      syncStateRef.current = { mode, globalWords, projects }
      const fp = (m, w, p) => JSON.stringify([m, w, p])
      if (syncSentRef.current === null) syncSentRef.current = fp(mode, globalWords, projects)
      if (syncBaseRef.current === null) syncBaseRef.current = { mode, words: globalWords, projects }

      const mergeWords = (base, theirs, mine) => {
        const removedByTheirs = new Set(base.filter((w) => !theirs.includes(w)))
        const removedByMine = new Set(base.filter((w) => !mine.includes(w)))
        const out = []
        for (const w of mine) if (!removedByTheirs.has(w) && !out.includes(w)) out.push(w)
        for (const w of theirs) if (!removedByMine.has(w) && !out.includes(w)) out.push(w)
        return out
      }

      const warnedRef = React.useRef(false)
      const syncPull = React.useCallback(async () => {
        try {
          const res = await fetch(WORDS_SYNC_URL, { headers: WORDS_SYNC_HEADERS })
          if (!res.ok) return
          const data = await res.json()
          const state = data === null || typeof data !== 'object' || Array.isArray(data) ? null : data.state
          if (state === null || typeof state !== 'object' || Array.isArray(state)) return
          const rev = Number.isFinite(state.rev) ? state.rev : 0
          if (syncHydratedRef.current && rev <= syncRevRef.current) return
          const nextMode = WORDS_MODES.includes(state.mode) ? state.mode : 'all'
          const nextWords = Array.isArray(state.words) ? state.words.filter((w) => typeof w === 'string') : []
          const nextProjects = state.projects !== null && typeof state.projects === 'object' && !Array.isArray(state.projects) ? state.projects : {}
          const serverFp = fp(nextMode, nextWords, nextProjects)
          const cur = syncStateRef.current
          const dirty = fp(cur.mode, cur.globalWords, cur.projects) !== syncSentRef.current
          const base = syncBaseRef.current
          syncRevRef.current = rev
          syncSentRef.current = serverFp
          syncBaseRef.current = { mode: nextMode, words: nextWords, projects: nextProjects }
          syncHydratedRef.current = true
          if (!dirty) {
            setMode(nextMode); setGlobalWords(nextWords); setProjects(nextProjects)
            return
          }
          const mergedWords = mergeWords(Array.isArray(base.words) ? base.words : [], nextWords, cur.globalWords)
          const sProjects = nextProjects !== null && typeof nextProjects === 'object' ? nextProjects : {}
          const bProjects = base.projects !== null && typeof base.projects === 'object' ? base.projects : {}
          const lProjects = cur.projects !== null && typeof cur.projects === 'object' ? cur.projects : {}
          const mergedProjects = {}
          for (const dir of new Set([...Object.keys(bProjects), ...Object.keys(sProjects), ...Object.keys(lProjects)])) {
            const items = mergeWords(bProjects[dir] ?? [], sProjects[dir] ?? [], lProjects[dir] ?? [])
            if (items.length > 0) mergedProjects[dir] = items
          }
          setMode(cur.mode); setGlobalWords(mergedWords); setProjects(mergedProjects)
        } catch (error) {
          if (!warnedRef.current) {
            warnedRef.current = true
            console.warn('[enkeep] 常用词服务端同步不可用，已退回本地存储', error)
          }
        }
      }, [])

      // First load: seed via migrate=1 if server has no file, then pull authoritative state.
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const res = await fetch(WORDS_SYNC_URL, { headers: WORDS_SYNC_HEADERS })
            if (!res.ok) return
            const data = await res.json()
            if (!alive) return
            if (data !== null && typeof data === 'object' && data.state === null) {
              const cur = syncStateRef.current
              await fetch(WORDS_SYNC_URL + '?migrate=1', {
                method: 'POST',
                headers: { ...WORDS_SYNC_HEADERS, 'content-type': 'application/json' },
                body: JSON.stringify({ mode: cur.mode, words: cur.globalWords, projects: cur.projects }),
              })
            }
            if (alive) await syncPull()
          } catch { /* no server: stay local */ }
        })()
        return () => { alive = false }
      }, [syncPull])

      // Debounced push (800ms).
      React.useEffect(() => {
        if (!syncHydratedRef.current) return
        const currentFp = fp(mode, globalWords, projects)
        if (currentFp === syncSentRef.current) return
        const timer = window.setTimeout(async () => {
          try {
            const res = await fetch(WORDS_SYNC_URL, {
              method: 'POST',
              headers: { ...WORDS_SYNC_HEADERS, 'content-type': 'application/json' },
              body: JSON.stringify({ baseRev: syncRevRef.current, mode, words: globalWords, projects }),
            })
            if (!res.ok) return
            const data = await res.json()
            const state = data === null || typeof data !== 'object' || Array.isArray(data) ? null : data.state
            if (state === null || typeof state !== 'object' || Array.isArray(state)) return
            const rev = Number.isFinite(state.rev) ? state.rev : 0
            syncRevRef.current = rev
            if (data.conflict !== true) {
              syncSentRef.current = currentFp
              syncBaseRef.current = { mode, words: globalWords, projects }
              return
            }
            let base = ['all', [], {}]
            try { base = JSON.parse(syncSentRef.current || '["all",[],{}]') } catch { /* ignore */ }
            const serverProjects = state.projects !== null && typeof state.projects === 'object' ? state.projects : {}
            const mergedWords = mergeWords(Array.isArray(base[1]) ? base[1] : [], Array.isArray(state.words) ? state.words : [], globalWords)
            const mergedProjects = { ...serverProjects }
            for (const [dir, list] of Object.entries(projects)) {
              mergedProjects[dir] = mergeWords((base[2] ?? {})[dir] ?? [], serverProjects[dir] ?? [], list)
            }
            const retry = await fetch(WORDS_SYNC_URL, {
              method: 'POST',
              headers: { ...WORDS_SYNC_HEADERS, 'content-type': 'application/json' },
              body: JSON.stringify({ baseRev: rev, mode, words: mergedWords, projects: mergedProjects }),
            })
            if (!retry.ok) return
            const rd = await retry.json()
            const rs = rd !== null && typeof rd === 'object' ? rd.state : null
            if (rs !== null && typeof rs === 'object' && Number.isFinite(rs.rev)) syncRevRef.current = rs.rev
            syncSentRef.current = fp(mode, mergedWords, mergedProjects)
            syncBaseRef.current = { mode, words: mergedWords, projects: mergedProjects }
            setGlobalWords(mergedWords); setProjects(mergedProjects)
          } catch { /* push failed silently; next change/poll will realign */ }
        }, 800)
        return () => window.clearTimeout(timer)
      }, [mode, globalWords, projects, syncPull])

      // Poll every 10s only while panel is open; pause when tab hidden.
      React.useEffect(() => {
        if (!open) return
        syncPull()
        const id = window.setInterval(() => { if (!document.hidden) syncPull() }, WORDS_SYNC_POLL_MS)
        const onVisible = () => { if (!document.hidden) syncPull() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          window.clearInterval(id)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [open, syncPull])

      // panel positioning (wb-03): read composer card rect → write ONLY panel's own style.
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      React.useEffect(() => {
        if (!open || !panelRef.current) return
        const p = panelRef.current, r = rootRef.current
        if (!r) return
        const c = r.closest('[data-composer-card]') || r.closest('[data-composer-seat]') ||
          r.closest('[class*="composer"]') || r.parentElement?.parentElement?.parentElement || r.parentElement
        if (!c) return
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

      // close on Esc / outside click.
      React.useEffect(() => {
        if (!open) return
        const onKey = (e) => {
          if (e.key === 'Escape') { setOpen(false); setEditing(false) }
        }
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
        if (mode === 'global') return globalWords
        if (mode === 'current') return projectWords
        const seen = new Set(globalWords)
        return [...globalWords, ...projectWords.filter((w) => !seen.has(w))]
      }, [mode, globalWords, projectWords])

      const insert = (word) => {
        const base = draft || ''
        const sep = base !== '' && !/\s$/.test(base) ? ' ' : ''
        if (typeof inputActions?.setDraft === 'function') inputActions.setDraft(base + sep + word)
      }
      const addWord = () => {
        const word = draftWord.trim()
        if (word === '') return
        if (mode === 'global') {
          setGlobalWords((prev) => prev.includes(word) ? prev : [...prev, word])
        } else {
          if (projectKey === null) return
          setProjects((prev) => {
            const cur = prev[projectKey] ?? []
            return cur.includes(word) ? prev : { ...prev, [projectKey]: [...cur, word] }
          })
        }
        setDraftWord(''); setEditing(false)
      }
      const removeWord = (word) => {
        setGlobalWords((prev) => prev.filter((w) => w !== word))
        if (projectKey !== null) {
          setProjects((prev) => {
            const cur = prev[projectKey] ?? []
            return cur.includes(word) ? { ...prev, [projectKey]: cur.filter((w) => w !== word) } : prev
          })
        }
      }
      const addToGlobal = (word) => {
        setGlobalWords((prev) => prev.includes(word) ? prev : [...prev, word])
      }

      const emptyText = mode === 'global' ? '还没有常用词，点击下方按钮添加'
        : mode === 'current' ? (projectKey === null ? '当前没有项目' : '当前项目还没有常用词')
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
          editing ? h('div', { className: 'ekeep-w-addRow' },
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
            : h('ul', { className: 'ekeep-w-list' }, visible.map((word) => h(WordsRow, {
              key: word, word,
              showToGlobal: mode === 'current',
              alreadyGlobal: globalWords.includes(word),
              onInsert: insert, onRemove: removeWord, onAddToGlobal: addToGlobal,
            }))),
          h('div', { className: 'ekeep-w-actions' },
            !editing ? h('button', {
              type: 'button', className: 'ekeep-w-add',
              onMouseDown: (e) => e.preventDefault(), onClick: () => setEditing(true),
            }, '＋ 添加') : null,
            h('div', { className: 'ekeep-w-modes', role: 'group', 'aria-label': '显示范围' },
              [['all', '全部'], ['global', '全局'], ['current', '当前']].map(([value, label]) => h('button', {
                key: value, type: 'button',
                className: 'ekeep-w-mode' + (mode === value ? ' ekeep-w-modeActive' : ''),
                'aria-pressed': mode === value, title: label,
                onMouseDown: (e) => e.preventDefault(), onClick: () => setMode(value),
              }, label)))
          )
        ) : null)
    }

    // --- Center-column panel: width toggle + short usage note ----------------
    function EnkeepPanel({ form }) {
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const state = form.getSnapshot()
      const value = state.value || {}
      const width = value.chatWidth === 'wide' ? 'wide' : 'narrow'
      const hoursRaw = Number(value.activityWindowHours)
      const hours = Number.isFinite(hoursRaw) && hoursRaw >= 1 ? hoursRaw : 24
      const busy = React.useRef(false)

      const set = async (field, v) => {
        if (busy.current) return
        busy.current = true
        try { await form.set(field, v) } finally { busy.current = false; force((n) => n + 1) }
      }
      const setWidth = (next) => set('chatWidth', next)

      return h('div', { style: { padding: 24, maxWidth: 720 } },
        h('h2', null, 'Enkeep'),
        h('p', { style: { opacity: 0.75, lineHeight: 1.6 } }, '聊天区宽度设置。窄屏使用原生布局；宽屏去掉 920px 上限，并按可用列宽自适应。'),
        h('div', { style: { marginTop: 16, display: 'flex', gap: 8 } },
          h('button', {
            type: 'button',
            disabled: busy.current,
            onClick: () => setWidth('narrow'),
            style: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', background: width === 'narrow' ? 'var(--dsw-alias-bg-layer-2)' : 'transparent', color: 'inherit', cursor: 'pointer' },
          }, '窄屏'),
          h('button', {
            type: 'button',
            disabled: busy.current,
            onClick: () => setWidth('wide'),
            style: { padding: '6px 14px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', background: width === 'wide' ? 'var(--dsw-alias-bg-layer-2)' : 'transparent', color: 'inherit', cursor: 'pointer' },
          }, '宽屏')),
        h('p', { style: { marginTop: 12, fontSize: 12, opacity: 0.6 } }, `当前：${width === 'wide' ? '宽屏' : '窄屏'}。设置保存在插件配置中，重启后保持。`),
        h('div', { style: { marginTop: 20, display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', null, '活动区时间窗（小时）'),
          h('input', {
            type: 'number', min: 1, max: 720, step: 1,
            value: hours,
            disabled: busy.current,
            style: { width: 72, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit' },
            onChange: (e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 1 && n <= 720) set('activityWindowHours', n)
            },
          }),
          h('span', { style: { fontSize: 12, opacity: 0.6 } }, '列出更新于该时长内 / 运行中 / 未读的会话')))
    }

    // Settings page: toggles + activity window via the same form.
    function EnkeepSettings({ form }) {
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const value = form.getSnapshot().value || {}
      const show = value.showLauncher !== false
      const showWords = value.showCommonWords !== false
      const wide = value.chatWidth === 'wide'
      const hoursRaw = Number(value.activityWindowHours)
      const hours = Number.isFinite(hoursRaw) && hoursRaw >= 1 ? hoursRaw : 24
      const busy = React.useRef(false)
      const set = async (field, v) => {
        if (busy.current) return
        busy.current = true
        try { await form.set(field, v) } finally { busy.current = false; force((n) => n + 1) }
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { type: 'checkbox', checked: show, onChange: (e) => set('showLauncher', e.target.checked) }),
          h('span', null, '显示侧栏按钮')),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { type: 'checkbox', checked: showWords, onChange: (e) => set('showCommonWords', e.target.checked) }),
          h('span', null, '显示常用词按钮（输入框右侧）')),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { type: 'checkbox', checked: wide, onChange: (e) => set('chatWidth', e.target.checked ? 'wide' : 'narrow') }),
          h('span', null, '宽屏聊天区（去掉 920px 上限）')),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', null, '活动区时间窗（小时）'),
          h('input', {
            type: 'number', min: 1, max: 720, step: 1,
            value: hours,
            disabled: busy.current,
            style: { width: 72, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit' },
            onChange: (e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 1 && n <= 720) set('activityWindowHours', n)
            },
          }),
          h('span', { style: { fontSize: 12, opacity: 0.6 } }, '列出更新于该时长内 / 运行中 / 未读的会话')))
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

        // (2) Sidebar launcher + center panel. Structure follows dsh-im:
        // one ctx.inject(['layout']) whose callback owns and returns a single
        // disposer; the main keyed panel is the parent registration, and the
        // sidebar.panellist row (same id as the panel key) is toggled by config.
        // Guard for older/partial installations where layout is absent.
        if (typeof ctx.inject === 'function') {
          ctx.inject(['layout'], (layoutCtx) =>
            layoutCtx.slots.inject('main', () => {
              const unregisterPage = layoutCtx.slots.register({
                name: 'main',
                key: PANEL_ID,
                inject: () => ({ form }),
              }, ({ form: f }) => h(EnkeepPanel, { form: f }))

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
          const stopOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-enkeep.activity-bar',
            order: 100,
            inject: () => ({ form, openSession, newSession, addWorkspace, openSettings }),
          }, (props) => h(ActivityBar, {
            form: props.form,
            openSession: props.openSession,
            newSession: props.newSession,
            addWorkspace: props.addWorkspace,
            openSettings: props.openSettings,
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
          inject: () => ({ form }),
        }, ({ form: f }) => h(EnkeepSettings, { form: f }))), 'enkeep: settings')

        // (5) Current-session chip above the composer input. Same slot/position
        // as the git-panel branch chip, but a plain non-interactive label.
        // Standard props (useSessions from root, sessionId from session scope)
        // are auto-injected by the renderer into session-scope slot entries.
        ctx.effect(() => {
          const stopStyle = installCurrentStyle()
          const stopChip = ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'enkeep-current-session',
            order: 100,
          }, (props) => h(CurrentSessionBar, {
            useSessions: props.useSessions,
            sessionId: props.sessionId,
          })))
          return () => { stopChip(); stopStyle() }
        }, 'enkeep: current session chip')

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
