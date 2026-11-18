/**
 * dsh-enkeep — Client half of the bundle.
 *
 * Two capabilities, no dependencies on other plugins:
 *   1) Chat column width: narrow (native) / wide (no 920px cap) via
 *      ctx.theme.overrideTokens writing the --dsh-chat-content-width variable.
 *   2) Sidebar launcher button: a sidebar.panellist entry that opens a panel in
 *      the center column, with visibility controlled by the showLauncher config.
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
    const THEME_SOURCE = 'dsh-enkeep'

    // Wide-mode override: remove the native 920px cap, keep a 640px floor.
    // Values are scheme-invariant, so light/dark repeat the same string.
    const WIDE_WIDTH = 'clamp(640px, calc(var(--dsh-conversation-column-width, 100%) - 64px), 100%)'
    const WIDE_COMPOSER = 'calc(100% - 16px)'
    const WIDE_TOKENS = {
      '--dsh-chat-content-width': { light: WIDE_WIDTH, dark: WIDE_WIDTH },
      '--dsh-composer-card-max-width': { light: WIDE_COMPOSER, dark: WIDE_COMPOSER },
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

    // --- Center-column panel: width toggle + short usage note ----------------
    function EnkeepPanel({ form }) {
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const state = form.getSnapshot()
      const value = state.value || {}
      const width = value.chatWidth === 'wide' ? 'wide' : 'narrow'
      const busy = React.useRef(false)

      const setWidth = async (next) => {
        if (busy.current) return
        busy.current = true
        try { await form.set('chatWidth', next) } finally { busy.current = false; force((n) => n + 1) }
      }

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
        h('p', { style: { marginTop: 12, fontSize: 12, opacity: 0.6 } }, `当前：${width === 'wide' ? '宽屏' : '窄屏'}。设置保存在插件配置中，重启后保持。`))
    }

    // Settings page: two toggles (showLauncher, chatWidth) via the same form.
    function EnkeepSettings({ form }) {
      const [, force] = React.useState(0)
      React.useEffect(() => form.subscribe(() => force((n) => n + 1)), [form])
      const value = form.getSnapshot().value || {}
      const show = value.showLauncher !== false
      const wide = value.chatWidth === 'wide'
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
          h('input', { type: 'checkbox', checked: wide, onChange: (e) => set('chatWidth', e.target.checked ? 'wide' : 'narrow') }),
          h('span', null, '宽屏聊天区（去掉 920px 上限）')))
    }

    return {
      // Service names taken from the client context (not package names — those
      // belong in dsh.client.inject). 'layout' is acquired lazily via ctx.inject.
      inject: ['slots', 'theme', 'configForms', 'locale'],
      apply(ctx) {
        const form = ctx.configForms.get(NAMESPACE)

        // (1) Chat width: stack/unstack the theme token override layer.
        ctx.effect(() => {
          let disposeWidth = null
          const applyWidth = () => {
            const value = form.getSnapshot().value || {}
            const wantWide = value.chatWidth === 'wide'
            if (wantWide && disposeWidth === null) {
              disposeWidth = ctx.theme.overrideTokens(THEME_SOURCE, WIDE_TOKENS)
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
                locale: NAMESPACE,
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
                      label: () => 'Enkeep',
                      locale: NAMESPACE,
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
                  locale: NAMESPACE,
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

        // (3) Settings page entry with the two toggles.
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'enkeep',
          order: 30,
          label: () => 'Enkeep',
          locale: NAMESPACE,
          inject: () => ({ form }),
        }, ({ form: f }) => h(EnkeepSettings, { form: f }))), 'enkeep: settings')
      },
    }
  },
})
