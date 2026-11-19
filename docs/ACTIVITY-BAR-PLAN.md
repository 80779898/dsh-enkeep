# dsh-enkeep「活动区」常驻悬浮切换条 — 实施方案

> 状态：用户已确认方向（2026-11-19），待按第五节开发计划实施
> 基线：DSH `0.2.1-rc.2`；插件 `dsh-enkeep@0.1.0`（bundle skeleton，来源 `git+https://github.com/80779898/dsh-enkeep.git`，不锁 SHA）
> 本地源码开发副本：`C:\dev\dsh-enkeep`（clone 自上述仓库）
> 约束：纯插件实现（不依赖其他第三方插件、不改宿主包）；不锁 commit；新增可设置项须 `.volatile()`

---

## 一、需求（已与用户逐项确认）

同一个插件里的**第三个需求**。现状：侧栏"工作区"把所有会话按目录（工作区）分组、树型堆叠。用户要新增一个**活动区**：把"当前值得关注的少数会话"用一条**始终悬浮的切换条**常驻展示。

| 决策点 | 确认结果 |
|---|---|
| 落点形态 | **常驻悬浮条**（`shell.overlay`，additive），不是侧栏内嵌区块、不是点开的面板 |
| 是否点面板 | **否**。不做"点 Enkeep 图标再在面板里看"，要一直悬浮可见 |
| 列表结构 | **扁平**，不分组、不树型；数量少（10–20 条） |
| 标签内容 | `目录名: 对话标题`（目录名取会话 `cwd` 的最后一级；标题取会话 title） |
| 入选规则（OR，命中其一即显示） | ① 更新于 **N 小时内**（默认 24，可设置）② **正在运行中** ③ **有结果但没看过**（官方"点点"，`completionUnread`） |
| 点点 | **保留**，并用颜色区分三类主状态（进行中 / 完成未读 / 仅时间命中） |
| 时间窗口设置 | **可设置**，放在 Enkeep 设置页（新增 `activityWindowHours`） |
| 交互 | 点某条 → 官方 `openSession(id)` 直接切到该对话；切走后该条"未读点点"自动消失 |
| 空态 | 0 条命中时整条隐藏，不占位 |
| 视觉克制 | 小、半透明、贴边、hover 变实、可一键收起；不遮挡聊天正文 |

---

## 二、调研结论（实现所依赖的已核实事实）

1. **落点槽位**：`shell.overlay` — `kind:list`、`scope:root`、`replaceRisk:none`、由 `client-ui-layout` 声明，渲染在框架级 `[data-shell-overlay]` 覆盖层（`dsh-client-ui-layout/lib/client.js:313,349-353`），是"自定义框架级浮层"的官方 additive 席位。用**全新 id** 注册（如 `dsh-enkeep.activity-bar`）即与官方 11 个占用项并存。
2. **数据 hooks 免费注入**：`shell.overlay` 槽位组件自动获得标准 props `useSessions` / `useSessionStatus` / `useWorkspaces`（`dsh-cordis-client-runner/lib/client.js:5460-5470`），**无需在 `inject` 里加服务、无需自己订阅**。
3. **会话字段**（`SessionSummary`）：`id`、`title?`、`displayTitle`、`cwd?`、`running:boolean`、`blank:boolean`、`updatedAt:number`、`origin?:'subagent'`、`retainedBy`（见 `dsh-api-session-controller/.../sessions/service.d.ts:16-44`）。客户端行**没有 `createdAt`** → 时间窗口一律用 `updatedAt`。
4. **点点来源**：`SessionStatus.completionUnread:boolean`（`dsh-client-ui-session/.../index.d.ts:29-37`）；`SessionStatusSnapshot = ReadonlyMap<SessionId, SessionStatus>`；会话成为主视图时该标志自动清除（`dsh-client-ui-session/lib/client.js:948-991`）。工作区"点点"就是它驱动的 `StateDot`。
5. **切对话 API**：`ctx.get('uiWorkspace').openSession(sessionId)` —— 官方 `UiWorkspace.openSession`（`dsh-client-ui-workspace/.../navigation.d.ts:16-21`），dsh-im 已在用（`dsh-im/plugin-src/client/index.js:96`）。调用时动态取服务、可选链兜底。
6. **配置持久化**：客户端 `configForms.get('enkeep')` 的 `form.set(field,value)` → Host `dsh-settings` → `configEditor.edit()` 写入当前 profile 的 `cordis.patch.yml`；**非 volatile 字段会被 Host 拒绝**（`dsh-settings/lib/index.js:505-520`）。故新字段必须 `.volatile()`。schemastery v3.18.5 支持 `.number().step(1).min(1).max(720).default(24).volatile()`（实例见 `dsh-agent-loop/lib/index.js:1554`）。
7. **官方 UI 规范**：贡献一律走 `ctx.slots.inject(owner, () => ctx.slots.register(...))`；不读别的插件 DOM/样式表、不在组件外写 DOM、不 import 官方 Client 包做模块；用 `--dsw-alias-*` 主题 token（`dsh-doc/references/ui-plugin.md`、`practices.md`）。本插件已用"自建 `<style>` 标签 + data 属性幂等 + disposer"的合规范式（`client.js:60-70`）。
8. **浮层注意**：`shell.overlay` 层本身 **click-through**，条目必须自己开 `pointer-events:auto` 才能点中（槽位文档 L5437）。框架列顺序：此机侧栏被 sb-01 补丁固定在**右侧**（grid 最后一列，`client-ui-layout/lib/client.js:321`）。

---

## 三、详细方案

### 3.1 数据流

```
shell.overlay 槽位组件 ActivityBar
  ├─ props: useSessions(s=>s)          → { ids, byId, phase }        （免费注入）
  ├─ props: useSessionStatus(s=>s)     → Map<id,{running,completionUnread,pendingInteraction}>（免费注入）
  ├─ props: useWorkspaces(s=>s)        → { archivedSessionIds, ... }（免费注入，用于排除归档）
  ├─ inject: () => ({ form, openSession })  （form=configForms.get('enkeep')；openSession 闭包动态取 uiWorkspace）
  └─ 本地 state: collapsed（一键收起，不持久化）
```

### 3.2 筛选规则（单个纯函数 `selectActivity(sessions, statuses, workspaces, hours, now)`）

对 `sessions.ids` 逐条：
- 排除：`byId[id]` 不存在、`row.blank === true`、`origin === 'subagent'`、归档集合命中。
- 计算：`st = statuses.get(id)`；`running = st?.running ?? row.running`；`unread = st?.completionUnread === true`；`recent = (now - row.updatedAt) <= hours*3600_000`。
- 入选：`running || unread || recent`。
- 状态标签（决定点点颜色，优先级）：`running → 'ongoing'`、`unread → 'unread'`、`recent → 'idle'`。
- 当前对话（叠加维度，非互斥）：与工作区侧栏高亮同一数据源——`byId` 中 `retainedBy.mainView > 0` 的那条记为 `current=true`；当前通常也是运行中，故呈"双重标识"（运行中圆点 + 当前徽标）。
- 行标签：`dir = basename(row.cwd)`；`title = row.title?.trim()`；若 `title` 为空，标签退化为 `dir`（避免 `dir: dir` 重复），否则 `dir + ': ' + title`。
- 排序：**按 `SessionId` 字典序**（用户 2026-11-19 定稿："不一定要创建顺序，只要稳定即可"）；渲染上限 `MAX_ITEMS = 30`（防止极端情况下刷屏；用户预期 10–20）。
  - 为什么不用 `updatedAt` / `ids` 顺序：两者都随聊天变化——Host `dsh-api-session-controller/lib/types/list.js:144` 按 `updatedAt` 降序排，`sessions.ids` 沿用该顺序；点开会话聊天会刷新 `updatedAt`，导致列表重排跳动。
  - 为什么不用 `createdAt`：创建时间只在 Host 线协议头 `SessionWireHeader` 上，未暴露给 `useSessions` 的列表行（`SessionSummary`/`SessionListEntry` 只有 `updatedAt`）。`SessionId` 是 `session-<随机UUID>`（不编码时间），字典序不是时间序，但 **id 不可变**，给出固定顺序——点击/聊天都不动，满足"稳定"要求。
  - **current 不参与排序**：它随点击而变（`retainedBy.mainView` 变化），若作排序键会导致整列反复重排。当前对话改用蓝色高亮 + "当前"徽标标识，仍能一眼定位，只是不再物理置顶。
  - 入选仍看活跃度（N 小时内更新 / 运行中 / 未读），只是"显示哪些"用 `updatedAt`、`"按什么顺序显示"`用 id——两者解耦。

### 3.3 UI 与交互

- 根：`<div data-enkeep-activity-bar style={{pointerEvents:'auto'}}>`，内部一条横向胶囊列表；每项一个 `<button>`：`<span class=enkeep-dot data-state=...>` + 文字标签。
- 四种标识（用户 2026-11-19 定稿，放弃参考官方环形 spinner，改用更易区分的组合）：
  - **运行中**：绿色圆点 + 缓慢脉冲光环（`--dsw-alias-state-success-primary`，`prefers-reduced-motion` 下停动画）。
  - **已完成·未看**：橙色实心点 + 淡橙外圈（`--dsw-alias-state-warn-label`，醒目提醒）。
  - **已完成·已看（未超时）**：灰色圆点（`--dsw-alias-text-4`，安静）。
  - **当前对话**：叠加浅色高亮行 + "当前"徽标（`--dsw-alias-state-business-primary`），不置顶、不参与排序（都会随点击跳动）；因其本身通常也在运行，故与运行中圆点同时出现（双重标识）。
- **始终显示**：侧栏折叠时 `cols.sidebar` 收缩为 56px，条不改 `display:none`，改 `right:calc(56px + padding + 8px)` 贴图标栏继续显示。
- 常驻但克制：默认 `opacity:.82`，hover 容器 `opacity:1`；右侧一个收起按钮切换 `collapsed`（本地 state）。0 条命中 → 组件返回 `null`（整条隐藏）。
- 点击项：`onOpen(id)` → `openSession(id)`（可选链，服务缺失时仅 `console.warn`，不抛错）。切成主视图后 `completionUnread` 由官方自动清除，点点随之消失。
- **背景不透明**（用户 2026-11-19 追加）：去掉 `backdrop-filter` 与整体 `opacity:.82`，改为 100% 不透明，`background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#202124) 94%, #000)` 略压深，避免透出背景颜色。
- **标题栏三个动作按钮**（用户 2026-11-19 追加，放在"收起"前，busy ref 防重复点击）：
  - 四个头部按钮（新建 / 工作区 / 设置 / 收起）统一为 22×22 尺寸盒 + 15px 内联 SVG（统一 viewBox 16×16、stroke 1.5），保证视觉大小一致；字符符号因字形差异大小不一，已弃用。收起/展开改用同尺寸上/下箭头图标。
  - `＋` 新建对话：`ctx.get('uiWorkspace').startSession()`——官方公开方法，与侧栏 Ctrl+N 同一实现。
  - `⊞` 新建工作区：`uiWorkspace.pickDirectory()` → `workspaces.create({ path })`；侧栏的 `addRequested` 流程是私有 store、无法外部触发，这两个公开方法效果等价（选目录→纳入工作区）。
  - `⚙` 设置：`ctx.get('layout').selectPanel('enkeep')` 打开本插件配置面板（全局设置面板无公开外部入口；强用 settings.launcher 单槽会挤掉账户菜单，故不改）。Enkeep 面板已含宽窄切换 + 活动区时间窗输入，作为单一配置页。
  - 三个服务均 `ctx.get` + 可选链 + try/catch 兜底，缺失只 `console.warn`，不抛错。
- 定时刷新：`useEffect` 内 `setInterval`（60_000ms）触发 `setTick(n=>n+1)` 让时间窗口随时间失效，卸载时 `clearInterval`；另监听 `window.focus` 重算。

### 3.3.1 输入框上方"当前对话"横条（用户 2026-11-19 追加）

- **位置**：注册到 `conversation.input.dock` slot（`list` 类型、session scope），渲染在 composer 输入框正上方——与 `dsh-git-panel` 的分支 chip 同一 slot（`dsh-git-panel/lib/client.js:3990`）。只借位置，**不做下拉**（用户明确"他那个是下来，我们不要下来"）。
- **内容**：与活动区当前项**完全一致**的 label（`dir: title`），复用同一个纯函数 `sessionLabel(row, id)`（活动区与横条共用，避免重复）；**不带"当前"徽标、不带状态圆点**。
- **当前对话定位**：用 session scope 标准 prop `sessionId`（渲染器注入，见 `dsh-client-ui-renderer/lib/client.js:696-699` + `dsh-client-ui-session/lib/client.js:758`），配合 root 标准 hook `useSessions` 取 `byId[sessionId]`——比活动区用 `mainView` 推断更直接精确。两者都是标准 props，无需 service inject。
- **宽度随内容**：chip `width:auto; max-width:100%` + 文字 ellipsis；外层与官方一致 `max-width:var(--dsh-composer-card-max-width,800px); margin:0 auto`，不占满整行、不固定 220px。
- **纯展示**：无点击、无下拉、无 service 调用；row 缺失或 label 空则返回 `null`。独立 `<style data-plugin-css="enkeep-current">`，随 entry 生命周期 dispose。
- **审核**：位置/内容/宽度/无下拉/无重复/标准 props 可用/样式隔离均确认；取舍——未复制列表的状态圆点（那是状态标识，非"当前标识"，且需额外 `useSessionStatus`）。

### 3.4 配置项

- 新增 `activityWindowHours: Schema.number().step(1).min(1).max(720).default(24).volatile()`（Host `index.js` 的 `Config`）。
- `cordis.patch.yml` 的 `config` 段**重述全部键**（patch 整行替换，不是合并）：
  ```yaml
  - insert:
      - id: enkeep
        name: dsh-enkeep
        config:
          chatWidth: wide
          showLauncher: true
          activityWindowHours: 24
  ```
- 设置页 `EnkeepSettings` 增一个数字输入（受控 `form.set('activityWindowHours', Number(v))`，`busy` 守卫 + `finally` 复位 + `subscribe` 重渲染），沿用现有手写 `h()` 控件风格。

### 3.5 文件改动清单（均在 `C:\dev\dsh-enkeep`）

| 文件 | 改动 |
|---|---|
| `index.js` | `Config` 增 `activityWindowHours`；`loader/volatile-update` 诊断可附加打印该值 |
| `cordis.patch.yml` | config 段补 `activityWindowHours: 24`（保留全部旧键） |
| `client.js` | 新增 `ActivityBar` 组件 + 悬浮样式注入（幂等 `<style>` + disposer）+ `shell.overlay` 注册；`EnkeepSettings` 增数字输入 |
| `docs/ACTIVITY-BAR-PLAN.md` | 本方案文档（已创建） |
| `locale/{en,zh}.json` | 可选：更新 `meta.description` 反映新能力（非必需，UI 文案沿用现状硬编码中文） |

### 3.6 关键技术决策与备选（已排除）

- ❌ **替换 `sidebar.workspaces`**：single 槽位、`shadows-shipped-ui`，会替换掉工作区 → 排除。
- ❌ **侧栏内嵌新区块**：无 additive 侧栏槽位，需改宿主 `client-ui-sidebar` → 非纯插件、与 PatchGuard 联动 → 排除。
- ❌ **点 Enkeep 图标在面板里看**：用户明确否决（要一直悬浮）→ 排除。
- ✅ **`shell.overlay` 常驻浮层**：additive、官方指定自定义浮层席位、自动注入会话 hooks → 采用。

---

## 四、方案自审（遗漏 / 错误 / 重复 / 多余 / 逻辑问题）

| # | 类别 | 发现的问题 | 处理 |
|---|---|---|---|
| 1 | 遗漏 | 归档会话、空白新会话、subagent 子行会污染列表 | 筛选函数显式排除 `blank`、`origin==='subagent'`、归档集合命中项 |
| 2 | 遗漏 | 时间窗口基于 `Date.now()`，组件不主动重算则会话不会随时间自动消失 | 加 60s `setInterval` + `window.focus` 重算，卸载清理 |
| 3 | 错误 | `shell.overlay` 层 click-through，不设 `pointer-events` 则按钮点不中 | 根元素显式 `pointerEvents:'auto'`（槽位文档 L5437） |
| 4 | 重复 | 无 title 时 `displayTitle` 已含目录名，拼成 `dir: dir` | 仅当有真实 title 才拼 `dir: title`，否则只显示 `dir` |
| 5 | 逻辑 | running 与 completionUnread 是否冲突 | 官方在 running 时清除 completionUnread，二者不会同时；但状态优先级仍按 `ongoing>done>idle` 固定 |
| 6 | 逻辑 | 当前打开的会话（main view）无点点但"近 24h"会命中 | 符合预期；点它 `openSession` 幂等 |
| 7 | 多余 | 是否再加一个 `showActivityBar` 布尔配置 | 不加；收起用本地 state，避免多余持久字段 |
| 8 | 合规 | 不能 import 官方 primitives 拿 `StateDot`/颜色 | 手写圆点 + `--dsw-alias-*` token + 固定色 fallback |
| 9 | 合规 | HMR 安全：style 标签与槽位注册必须可释放 | 沿用 `ctx.effect(() => { ...return disposer })`，style 用 data 属性幂等并在 disposer 里 remove |
| 10 | 错误 | `form.set` 失败不能误报成功 | `busy` 守卫、`finally` 复位、以返回值/subscribe 为准刷新 |
| 11 | 风险 | 侧栏折叠 / 窗口缩放时浮层定位偏移 | 用文档化 CSS 变量定位 + `[data-sidebar-collapsed]` 适配；列为实机验收项 |
| 12 | 风险 | `ctx.get('uiWorkspace')` 在某些时刻可能未挂载 | 点击时动态取 + 可选链 + warn 兜底，不在 apply 期缓存 |
| 13 | 校验 | 新字段非 volatile 会被 Host 拒绝 | `activityWindowHours` 显式 `.volatile()`；`cordis.patch.yml` 重述全部键 |
| 14 | 范围 | 本需求不改聊天宽度 / 侧栏显隐 | 保持既有 `chatWidth`、`showLauncher` 逻辑原样，避免回归 |

> 自审结论：方案无阻断性缺陷；第 2/3/4/9/11 项须在开发计划中作为明确验收点落实。

---

## 五、开发计划（只列步骤与内容，不排时间）

### 步骤 1 — Host 配置字段与补丁
- **功能**：新增可设置的时间窗口 `activityWindowHours`（默认 24）。
- **技术**：`index.js` 的 `Config` 增 `.number().step(1).min(1).max(720).default(24).volatile()`；`cordis.patch.yml` 的 config 段重述全部键并加入该键。
- **完成**：两文件改完；`node --check index.js` 通过。
- **验收**：启动/重组后 `configForms.get('enkeep')` 快照中可见 `activityWindowHours: 24`；`form.set('activityWindowHours', 12)` 被 Host 接受且不报 "not volatile"。
- **成功标准**：设置值写入 profile 补丁并在重启后保持；无 schema 校验失败告警。

### 步骤 2 — 悬浮条注册与样式基座
- **功能**：一条常驻、贴边、可收起的浮层容器出现，0 条时隐藏。
- **技术**：`client.js` 增幂等 `<style>`（data 属性标识、disposer 移除）；`ctx.effect` 内 `ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay', id:'dsh-enkeep.activity-bar', order:100, inject:()=>({form, openSession})}, ActivityBar))`；根元素 `pointerEvents:'auto'`。
- **完成**：槽位注册 + 样式 + disposer 三者齐备且可释放。
- **验收**：实机框架覆盖层出现容器；HMR 反复加载不残留重复 `<style>` 或重复条目（dispose 生效）。
- **成功标准**：不遮挡聊天正文；侧栏折叠/展开与窗口缩放下位置不崩；0 命中时整条消失。

### 步骤 3 — 筛选、点点与标签
- **功能**：`ActivityBar` 按三类规则筛选会话，扁平渲染，点点分色，`dir: title` 标签，可收起，定时刷新。
- **技术**：props 用 `useSessions`/`useSessionStatus`/`useWorkspaces`；实现 `selectActivity()`；状态点三态 token；`setInterval`+`focus` 重算；`MAX_ITEMS=30`；排除 blank/subagent/归档。
- **完成**：筛选纯函数 + 渲染组件 + 刷新机制。
- **验收**：构造/等待三类会话各出现于条中；点点颜色与官方语义一致；无 `dir: dir` 重复；时间到点自动移除；收起/展开正常。
- **成功标准**：列表内容随会话状态实时正确变化；无重复项、无空白项、无归档项。

### 步骤 4 — 点击切换对话
- **功能**：点条目直接切到对应对话，未读点点随之消失。
- **技术**：`inject` 传入 `openSession=(id)=>ctx.get('uiWorkspace')?.openSession(id)`；点击调用，服务缺失时 warn 兜底。
- **完成**：点击链路打通。
- **验收**：点"未读"条 → 对话切换且该条点点消失；点"运行中"条 → 正确切到该会话；异常场景无未捕获错误。
- **成功标准**：点击行为与工作区里点会话一致，无报错、无卡死。

### 步骤 5 — 设置页时间窗口输入
- **功能**：Enkeep 设置页可改 N 小时（1–720）。
- **技术**：`EnkeepSettings` 增受控 `<input type=number>`，`form.set('activityWindowHours', Number(v))`，`busy` 守卫 + `subscribe` 刷新。
- **完成**：输入控件接入现有设置页。
- **验收**：改成 6 → 悬浮条立即按 6h 重算；越界值被 schema 拦截；重启后保持。
- **成功标准**：设置持久化正确，UI 无失真显示。

### 步骤 6 — 语法与静态自检
- **功能**：无语法/引用错误。
- **技术**：`node --check index.js`、`node --check client.js`；核对 slot 名、hook 名、字段名与调研一致；按第四节自审表逐条回归。
- **完成**：检查全绿。
- **验收**：两个文件语法检查 0 退出码；自审表 14 项均有结论。
- **成功标准**：无遗留 TODO、无调试残留。

### 步骤 7 — 部署与实机验证
- **功能**：让运行中的 web GUI 加载新代码并验证效果。
- **技术**：把改动同步到已安装副本 `C:\Users\mason\.dsh\profiles\web\node_modules\dsh-enkeep`（保持 package.json 的 git+https 依赖不变、不锁 SHA）；client.js 由 HMR 热更新；Host Config 变更需 profile 重组/重启——与用户协同执行，避免中断当前会话。
- **完成**：新代码在运行实例生效。
- **验收**：在真实页面看 `application` 与 `warnings`（有 `cordis_inspect` 时）；肉眼确认悬浮条位置/点点/点击/收起/空态；时间设置生效。
- **成功标准**：页面无加载错误或告警；交互符合第一节需求。

### 步骤 8 — 全量复检
- **功能**：交付前总复盘。
- **技术**：按第四节自审表 + 第五节各步验收标准逐条复核；确认既有宽窄/按钮功能无回归；恢复验证期间改动的用户状态。
- **完成**：复检记录。
- **验收**：无遗漏/错误/重复/多余/逻辑问题残留。
- **成功标准**：全部验收项通过，未验证项明确列出。

---

## 六、验收总清单

- [ ] `activityWindowHours` 可设置、持久化、影响筛选
- [ ] 悬浮条常驻可见、贴边、不挡正文、可收起、0 条隐藏
- [ ] 三类会话命中正确（24h / running / completionUnread），无 blank/subagent/归档污染
- [ ] 点点三态分色与官方语义一致；`dir: title` 无重复
- [ ] 点击切对话成功、未读点点自动消失
- [ ] HMR 安全（无重复 style / 重复槽位 / 定时器泄漏）
- [ ] 侧栏折叠与窗口缩放下定位正常
- [ ] 既有 chatWidth / showLauncher 功能无回归
- [ ] `node --check` 全绿；自审表 14 项有结论
