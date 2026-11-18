# dsh-enkeep 开发计划（步骤 / 功能 / 技术 / 验收标准）

> 范围：只做两件事——**聊天区宽窄切换**、**侧栏按钮 + 显隐开关**（侧栏左右切换不做）。
> 约束：纯插件实现，不依赖 dsh-wordbox 等其他插件；宽屏接管并撤销旧补丁 wb-01/wb-05。
> 参照样本：本机 `@xmanrui/dsh-im` v5.7.0 的 `sidebar.panellist` + `main` + `settings.section` 范式。
> 本机版本：DSH 0.2.1-rc.2；文档版本偏差见 `~/.dsh/references/dsh-plugin-dev/插件开发流程.md`。
> 本计划**不含时间安排**。
>
> **实施后的修正（2026-11-18，覆盖下文早期描述）**：
> 1. **默认宽屏**：`chatWidth` 默认值从 `narrow` 改为 `wide`（`index.js` schema + `cordis.patch.yml`），安装后默认即宽屏。下文"默认 narrow"的描述为早期设计，已过时。
> 2. **宽度控制最终改用 `styles.insert` 注入 CSS（放弃 body 级 override）**：早期设计用 `ctx.theme.overrideTokens` 在 `<body>` 写变量，两次真实浏览器（Edge headless）实测均失败：
>    - 写 `--dsh-chat-content-width`：被 conversation body DIV 自身定义（带 920px 硬顶）遮蔽，无效；
>    - 写 `--dsh-chat-user-width` + `var(--dsh-conversation-column-width)`：内层 var 在 body 上下文求值，取不到 JS 写在深层的栏宽 → 回退 `100vw`，忽略侧栏、整体过宽；
>    - 写 `--dsh-chat-user-width` + `100%`：`100%` 在文字列与输入框各自的使用处按不同包含块解析 → 文字列比输入框缩进去。
>    最终方案：用 client 运行时的 `styles.insert(css)`（闭包参数，返回 disposer）注入规则到稳定选择器 `[data-conversation-content]`，直接覆盖 `--dsh-chat-content-width: clamp(640px, calc(var(--dsh-conversation-column-width) - 64px), 100%)!important`，与原 wb-01 效果一致且无哈希依赖。验证：文字列 1136px、输入框 1168px、差 32px（输入框 = 文字 + 32px，原生关系）。`inject` 中已移除不再使用的 `theme`。

---

## 0. 总体架构与技术选型

### 0.1 产物形态
一个 **Host + Client 双半体 bundle**：

| 文件 | 角色 | 技术 |
|---|---|---|
| `package.json` | 清单 | `dsh.bundle.patch` + `dsh.client`（`platform: web`, `immediately`, `inject: [client-ui-slots, client-ui-settings, client-ui-theme, client-runtime, client-connection, client-locale]`），`exports: {'.','./client','./locale/*.json','./icon'}` |
| `cordis.patch.yml` | 配置层 | `- insert: - id: enkeep; name: dsh-enkeep; config: {chatWidth: narrow, showLauncher: true}` |
| `index.js` | Host 半体 | `export const name`, `Config`（Schemastery schema，两个 volatile 字段）, `inject: ['webServer']`, `apply(ctx)` 注册 RPC 端点 + `dsh-enkeep/state` 文件读写 |
| `client.js` | Client 半体 | lazy-CJS factory（`window.__ModuleLoader__.load`），factory 内 `require('react')`，返回 `{inject:['slots','layout','locale',...], apply(ctx)}`；注册 slot + 调用 `ctx.theme.overrideTokens` |
| `locale/en.json`、`zh.json` | 文案 | `meta.title/description/detail` + 按钮/面板/设置页文案 |
| `docs/DETAIL.md` | 详情页 | 功能说明、安装、限制 |
| `icon.svg` | 图标 | 36×36 自包含 SVG（已有，可复用） |

### 0.2 状态与真相源（已简化：无需自建 RPC）
- **Host 侧 Config volatile 字段**（写在 profile 的 `cordis.patch.yml`）为唯一真相源：
  - `chatWidth: 'narrow' | 'wide'`（默认 `narrow`）
  - `showLauncher: boolean`（默认 `true`）
- 禁止插件手改 `cordis.patch.yml`。
- **Client 半体用 `ctx.configForms.get('<namespace>')` 直接读写 Host Config 的 volatile 字段**（本机实证：`dsh-client-ui-theme` 等均用此路径），**不需要自建 RPC 端点、不需要状态文件**：
  - 读：`form.getSnapshot().value` / `form.subscribe(listener)`；
  - 写：`await form.set('chatWidth', 'wide')` / `await form.set('showLauncher', false)`（返回 boolean = Host 是否接受）；
  - namespace 就是 Host 设置的 settings namespace；用 `ctx.configForms.describe()` 可枚举确认。
- `configEditor.edit` 是 Host 侧服务，Client 不用。
- volatile 字段就地更新、不重启插件；Host 侧读取用 `config.chatWidth.get()`，变更监听 `ctx.on('loader/volatile-update')`。
- **本机实证依据**：`dsh-client-ui-settings/lib/types/client/config-form.d.ts` L92-96/L137/L65；provider `lib/client.js:1270`；consumer 实例 `dsh-client-ui-theme/lib/client.js:2028` `ctx.configForms.get('ui-theme')`。

### 0.3 两个功能的落点
- **宽窄**：Client 调 `ctx.theme.overrideTokens('dsh-enkeep', {'--dsh-chat-content-width': {light,dark}, '--dsh-composer-card-max-width': {light,dark}})`；`wide` 注入覆盖值，`narrow` 时 dispose 覆盖、回原生。
  - 原生值：`--dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width,0px)*.64), 920px))`
  - 宽屏覆盖值：`clamp(640px, calc(var(--dsh-conversation-column-width,100%) - 64px), 100%)`
  - 注意：`validateOverrides()` 只校验 `{light,dark}` 字符串对、不校验 token 名；`--dsh-*` 属越界用法，上游收紧校验会失效——验收时必须确认本机 0.2.1-rc.2 实际生效。
- **按钮 + 开关**（照 dsh-im）：
  - `sidebar.panellist` 注册图标按钮（`id: 'enkeep'`, `order`, `label: () => t('buttonLabel')`）
  - 点击 → `ctx.layout.selectPanel('enkeep')` 在中央区打开 `main` keyed 面板
  - `plugins.detail.actions` 加"打开"入口
  - `settings.section` 注册 `id: 'enkeep'` 设置页，放两个开关（宽窄、按钮显隐）
  - `showLauncher` 为 false 时**不注册** sidebar slot（而非渲染空组件），从源头消失

---

## 1. 步骤分解

### 步骤 1 — 扩展 bundle 骨架（Host 配置与 RPC 底座）

**功能内容**
- `package.json` 加 `dsh.client` 声明与 `./client` 导出；`cordis.patch.yml` 写两个 Config 默认值。
- `index.js` 导出 `Config` schema（两 volatile 字段）、`name`、`inject: ['webServer']`。
- `apply(ctx)` 注册 RPC 端点 `GET /dsh-enkeep/state`（返回 `{chatWidth, showLauncher}`）、`POST`（校验 + 写 `$DSH_HOME/dsh-enkeep-state.json` + `configEditor.edit` 同步 Config）。
- 状态文件读写：原子写（tmp + rename）、损坏隔离、轻量 schema 校验（参照 dsh-im / wordbox 的做法）。

**技术**
Schemastery `z.object({chatWidth: z.union([...]).default('narrow').volatile(), showLauncher: z.boolean().default(true).volatile()})`；Cordis `ctx.effect()` 管理路由 disposer；Node `fs/promises`。

**完成定义**
- `node --check index.js` 通过；`npm pack --dry-run` 清单含全部运行时文件。
- `dsh --profile web --dump-config` 能看到 enkeep 层与两个默认值。
- RPC 端点 `GET /dsh-enkeep/state` 返回合法 JSON。

**验收方法**
- 静态：`node --check index.js`、`node -e import('./index.js')` 验证导出形态（`name`/`Config`/`apply`，无 default）。
- 启动：`dsh plugin --profile web add ./dsh-enkeep` 安装后 `dsh --profile web --dump-config` 验层；启动 web 用 curl 打 `GET /dsh-enkeep/state`。

**成功标准**
- 插件能被 Loader 加载、Config 校验通过（fiber ACTIVE，非 FAILED/PENDING）。
- RPC 返回 `{chatWidth:'narrow', showLauncher:true}`（默认值）。
- 无 `apply` 抛错、无模块解析失败日志。

---

### 步骤 2 — 聊天区宽窄切换（纯插件）

**功能内容**
- Client factory 返回 `{inject:['slots','theme',...], apply(ctx)}`。
- `apply` 内按 `chatWidth` 调用/释放 `ctx.theme.overrideTokens`，写 `--dsh-chat-content-width` 与 `--dsh-composer-card-max-width`。
- 订阅状态变更（轮询 RPC 或 `POST` 后前端事件），切换时重新 apply override。
- 面板/设置页里提供"宽屏 / 窄屏"切换控件，写入状态。

**技术**
`ctx.theme.overrideTokens(source, {token:{light,dark}})` 返回 disposer，放进 `ctx.effect()`；CSS 变量覆盖；React 组件（自己写控件，不 require 其他 client 包）。

**完成定义**
- 选 `wide`：对话列 `max-width` 计算值 > 920px（无硬顶），下限 640px。
- 选 `narrow`：对话列恢复原生（上限 920px）。
- 切换不重启插件、不刷新整页即可生效。

**验收方法**
- 浏览器 DevTools 查 `.column`（`--dsh-chat-content-width` 所在元素）的 computed `max-width`：宽屏/窄屏各测一次。
- 切换后 `curl GET /dsh-enkeep/state` 确认 `chatWidth` 已持久化。
- 重启 DSH 后再查 computed 值，确认恢复。

**成功标准**
- 宽屏生效（>920px）、窄屏回原生，两者可反复切换。
- 状态持久化（重启后保持）。
- 无 console 报错、无 slot entry crash。
- **若 overrideTokens 对 `--dsh-*` 不生效**：记录为阻塞，回到方案评估（可能需要补丁），不算本步成功。

---

### 步骤 3 — 撤销旧补丁 wb-01 / wb-05

**功能内容**
- 从 `~/.dsh/patches/manifest.json` 移除 `wb-01-panel` 与 `wb-05-chatwidth-hash-refresh` 两条。
- 把 `dsh-wordbox/lib/client.js` 中这两条注入的 CSS 恢复为原版（用 `restore.mjs` 或反向应用，禁止用旧快照覆盖——会降级）。
- 更新 `notes` / `_MANIFEST` 说明宽度控制权已移交 dsh-enkeep。

**技术**
本机补丁工具链：`patches/restore.mjs`、`apply.mjs`、`verify.mjs`、`guard.mjs`、`replay-all.mjs`；`node --check` 语法门禁。

**完成定义**
- manifest 中无 wb-01/wb-05；wordbox client.js 中无 `--dsh-chat-content-width: clamp(640px...` 注入。
- `node patches/verify.mjs` 与 `node replay-all.mjs`（`DSH_PATCH_PROFILE=web`）全绿。
- `guard.mjs` 不再把这两条补回（15 分钟节拍）。

**验收方法**
- `grep` wordbox client.js 确认注入串消失。
- 跑 `verify.mjs` / `replay-all.mjs` / `guard.mjs` 三条。
- 浏览器 Ctrl+F5：宽度完全由插件控制（先切窄屏验证——若 wordbox 补丁还在，窄屏会被 `!important` 顶回宽屏）。

**成功标准**
- 补丁链全绿且无 wb-01/wb-05。
- 窄屏切换确实生效（证明旧补丁已彻底移除，插件独占宽度控制）。
- 其他补丁（sb-01、wordbox 面板等）未被误伤——`verify.mjs` 全绿即证据。

> 注意：本步改动本机 `~/.dsh/patches/`，**执行前需用户确认**。

---

### 步骤 4 — 侧栏按钮 + 中央面板

**功能内容**
- Client 注册 `sidebar.panellist` 图标按钮（`id:'enkeep'`, `order` 自定, `label` 走 locale, 图标组件自绘）。
- 点击 → `ctx.layout.selectPanel('enkeep')`。
- 注册 `main` keyed 面板（`key:'enkeep'`），内容先放最小版本：宽窄切换控件 + 使用说明。
- 注册 `plugins.detail.actions` 的"打开"入口。

**技术**
`ctx.slots.inject(ownerKey, () => ctx.slots.register({name, id/key, order, label, locale, inject: () => ({...})}, Component))`；模块作用域稳定 function component；`role/aria` 行为；CSS Module 样式 + `--dsw-alias-*` token；不 require 其他 client 包。

**完成定义**
- 侧栏图标行出现 enkeep 按钮，点击后中央区显示面板。
- 插件详情页有"打开"按钮。
- 组件卸载/插件卸载时 slot 注册被清理（无残留图标）。

**验收方法**
- 浏览器实测：点图标 → 面板出现；切到别的面板 → 面板消失；再点 → 恢复。
- 禁用插件（`set_plugin enabled:false`）→ 图标消失；重新启用 → 图标恢复。
- console 无 `slot entry crashed`。

**成功标准**
- 按钮可见、可点、面板正确出现在中央区。
- 显隐与生命周期正确（卸载清理、重启恢复）。
- 视觉与 host 一致（主题 token、明暗主题都正常）。

---

### 步骤 5 — 显隐开关 + 设置页

**功能内容**
- `settings.section` 注册 `id:'enkeep'` 设置页，含两个开关：按钮显隐、宽窄。
- `showLauncher` 为 false 时**不注册** `sidebar.panellist`（dsh-im 范式：由 visible 控制注册/注销，而非渲染空组件）。
- 开关写入：Client 通过 `ctx.configForms.get('enkeep').set(field, value)` 直接写 Host Config 的 volatile 字段（无需自建 RPC / 状态文件）。

**技术**
`slots.inject('settings.section', ...)`；`ctx.configForms`（读写 volatile Config）；volatile 字段原地更新；Host 侧 `loader/volatile-update` 仅作诊断日志。

**完成定义**
- 默认 `showLauncher:true` → 按钮显示。
- 设置页关掉 → 按钮立即消失；打开 → 立即出现。
- 重启 DSH / Ctrl+F5 后状态保持。

**验收方法**
- 浏览器实测开关 → 按钮显隐即时变化。
- `curl GET /dsh-enkeep/state` 确认 `showLauncher:false` 已持久化。
- 检查 `cordis.patch.yml` 中 enkeep 行 config 被正确写入（`showLauncher:false`），且其他插件行未被改动。
- 重启后重复验证。

**成功标准**
- 默认显示、可在设置页关闭、持久化、重启保持。
- 写配置不破坏用户 patch 的其他内容（configEditor 保证）。
- 无"谎报已保存"——写入被拒时要报告。

---

### 步骤 6 — 文案 / 元数据 / 图标 / 详情页完善

**功能内容**
- `locale/en.json`、`zh.json`：meta.title/description/detail + 按钮 label + 面板标题 + 设置页两个开关 label。
- `docs/DETAIL.md`：功能、安装、宽窄说明、显隐说明、限制（内部 CSS 变量越界风险）。
- `icon.svg`：确认 36×36、主题 token 兼容、双主题可读。

**技术**
官方 host-plugin.md 展示清单：`meta.title/description/detail`、locale 双语、`./locale/*.json` 与 `./icon` 导出、`files` 含全部资源。

**完成定义**
- 插件管理器里显示正确标题/描述/图标/详情页（中英双语文案随 locale）。
- 详情页无裸 HTML、无失效链接。

**验收方法**
- 插件管理页面 / 设置页查看展示元数据与图标（英/中切换）。
- 有浏览器控制时看真实渲染；无浏览器控制时"安装后请用户确认"并声明未做视觉验证。

**成功标准**
- 展示元数据与图标正确，无 fallback 默认图、无 metadata 诊断。
- 无"同一模板文案残留"（写实际功能，不是 skeleton 文案）。

---

### 步骤 7 — 全量静态校验 + 真实安装验收

**功能内容**
- 跑所有静态门禁；按官方 `verification.md` 做真实安装验收与 UX 审查。

**技术**
`node --check`、`node -e import`、`npm pack --dry-run`、`dsh --profile web --dump-config`；官方 `dsh-doc/references/verification.md` 的 UX 专家审查（subagent）；`dsh plugin` 安装/启用/禁用。

**完成定义**
- 静态校验全绿；用户可见能力实测通过；UX 审查完成。

**验收方法**
- 静态：`node --check index.js client.js`、`import()` 验证导出、`npm pack --dry-run` 清单正确。
- 安装：`dsh plugin --profile web add github:80779898/dsh-enkeep#<sha>`（或本地路径），看 `application: applied`、`warnings` 为空。
- 能力实测：宽窄切换、按钮显隐、设置页开关、面板打开——逐项在浏览器操作。
- UX 审查：派 subagent 做一次（可发现性、主流程、反馈、视觉一致性），无 subagent 则自己做并声明。
- 恢复测试期间改动的用户状态。

**成功标准**
- `application: applied` 且实际能力可用——**不是**只看日志/进程/安装成功。
- 官方验收清单 A/B/C/D 相关项全绿（见 `插件开发流程.md` 第 6 节）。
- 报告未验证项；UX 审查发现的问题在范围内修复并复验。

---

### 步骤 8 — 提交与推送

**功能内容**
- git add / commit / push 到 `github:80779898/dsh-enkeep` 的 main。
- commit message 按功能拆分（避免单个巨型 commit）。

**技术**
git。

**完成定义**
- 工作区干净；`git log` 有各步骤的提交；`origin/main` 同步。

**验收方法**
- `git status --short --branch` 显示 `## main...origin/main` 无差异。
- GitHub API 查 tree 确认远程文件齐全。

**成功标准**
- 本地与远程一致，无未提交改动。
- 不误提交本机配置/密钥/临时文件。

---

## 2. 全局验收清单（收官标准 + 实际状态）

> 实际状态更新于 2026-11-18。✅=已验证；⏳=需浏览器/用户在场验证（本会话无浏览器控制）。

- [x] 静态校验全绿：`node --check index.js/client.js`、`import()` 导出形态正确（无 default）、`npm pack --dry-run` 清单 11 文件
- [x] Config schema 构造成功（`Schema.union(['narrow','wide']).default().volatile()`，本机 schemastery 3.18.5 实测）
- [x] patch 层正确：`dsh --profile web --dump-config` 显示 `# == dsh-enkeep` 且默认值 `chatWidth:narrow / showLauncher:true`
- [x] 真实安装成功：`dsh plugin --profile web add <本地路径>` 返回 0；fiber 未报 FAILED/PENDING（dump-config 正常）
- [x] wb-01 已改为面板专用（保留 fixed/不透明/500px），wb-05 已移除；wordbox client.js 中 `--dsh-chat-content-width` 注入已清除
- [x] 补丁链 verify 13 条全绿、replay-all 逐字节一致、幂等通过、wb-05 专项优雅跳过
- [x] 远程同步：本地与 origin/main 一致，工作区干净；GitHub API 确认文件齐全
- [x] 代码审查：无模块级 store / useLayoutEffect / appendChild / 跨插件 require；locale 声明已清理
- [ ] ⏳ 宽屏 >920px、窄屏回原生，可反复切换且重启保持 —— **需浏览器 DevTools 实测 computed max-width**
- [ ] ⏳ 侧栏按钮默认显示、点击打开中央面板、设置页可关闭且持久化 —— **需浏览器交互实测**
- [ ] ⏳ 展示元数据/图标双主题、无 console 报错 / slot crash —— **需浏览器实测**
- [ ] ⏳ UX 专家审查 —— 浏览器控制不可用，未做视觉审查

**结论**：代码与配置层全部完成并验证；**浏览器端视觉/交互验收因本会话无浏览器控制而未能执行**，按官方 `verification.md` 如实报告为"未验证"，不声称视觉成功。用户在浏览器刷新后可按上面 ⏳ 项逐条确认。

## 3. 风险与回退

| 风险 | 回退方式 |
|---|---|
| `overrideTokens` 对 `--dsh-*` 不生效 | 本步判失败；回到补丁方案或改用 `!important` 全局 CSS（需重新评估） |
| 撤销 wb-01/wb-05 后其他补丁受影响 | 用 `restore.mjs` 回到当前状态，或 `archive-sb-01-sidebar-right.json` 反向恢复；禁止旧快照覆盖 |
| 侧栏 slot 注册冲突（被占用） | 换 `sidebar.footer.action` 或 `shell.overlay`，并在文中记录原因 |
| 配置写入被更高层覆盖 | `configEditor.edit` 返回拒绝时报告用户，不谎报保存成功 |
| 升级后 token / slot 名变化 | 每次 DSH 升级后重跑全量验收；版本偏差以本机 0.2.1-rc.2 为准 |
