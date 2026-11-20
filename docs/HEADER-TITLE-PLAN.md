# 会话标题栏显示「目录: 名字」+ 移除底部重复 chip —— 开发计划

> 状态：已规划，待实施
> 落点：写在我们自己的 `dsh-enkeep` 插件（`client.js`，纯前端），**不改任何 DSH 核心源码**
> 决策已定：① 顶部隐藏原生名、由我们重画成橙色 `dir: title`；② 底部 chip 直接删除（不加配置开关）
> 本计划不含时间安排，只列步骤、内容（功能 + 技术）、每步完成定义、验收标准、成功标准

---

## 1. 目标

1. 顶部会话标题行（面包屑 crumbs）的**当前会话**显示为醒目的橙色 `dir: title`，与活动区/底部原来的名字格式一致，并且**带上工作目录**（原生只有名字、没有目录）。
2. 祖先面包屑（subagent 链）**保持原生外观与可点击**，不受影响。
3. 删除底部输入行我们自己的 `data-enkeep-current-chip`，避免与顶部重复；该行的快捷提示词保持不变。

---

## 2. 现状调研（已确认事实）

- 顶部名字渲染在会话标题行的面包屑里（`dsh-client-ui-conversation`）：
  - `ConversationSessionHeader` 用 `useSessions(s => deriveAncestry(s, sessionId))` 得到 `ancestry`（只有 `{id, displayTitle, subagent}`，**刻意不含 cwd**）。
  - 插槽只在 `lineage = last || subagent` 的 crumb 上渲染，且**两种结构不同**（源码 18012/18025，关键差异）：
    - **末级、非 subagent**（最常见：`{title}{slot}`）——原生名 `span.crumbCurrent` 是插槽锚点的**前一个兄弟**，需要隐藏。
    - **末级、subagent / 各级 subagent 祖先**（`renderSlot(lineageOwner, { fallback: title })`）——注册条目后 fallback 的 `title` **根本不渲染**，插槽前面只有 `/` 分隔符（`crumbSep`），**没有原生名可隐藏**。
    - 普通祖先（非末级、非 subagent，`lineage=false`）完全不走插槽，保持纯原生。
  - `lineageOwner = { lineageSessionId, displayTitle, ...(last ? {} : { openTitle }) }` —— **`openTitle` 只在非最后一级（祖先）时出现**，是判定"当前 vs 祖先"的干净信号。
  - 判定 subagent：由 `useSessions(byId[lineageSessionId])` 的 `row.origin === 'subagent'` 得到（owner props 本身不带 subagent 字段）。
- `conversation.session.header.lineage` 是官方 **single 插槽、scope=session**，标准注入 props（含 `useSessions`、`sessionId`）自动可用；**当前无任何已装插件/核心注册它**，是空的，我们可独占。
- 当前会话的原生名 `span`（`crumbCurrent`，hash class）没有稳定 data 属性；**只在「末级非 subagent」这一种结构里**它才紧跟在 lineage 插槽锚点之前（`{title}{slot}`），这也是唯一需要隐藏的场景。
- 工作目录现成可读：会话行 `SessionSummary.cwd?: string`（官方 open-in-app 插件同款写法 `useSessions(s => s.byId[sessionId]?.cwd)`）。我们插件**已在用** cwd（CommonWords / QuickPrompts / fetchSkills）。**不要从 displayTitle 反推目录**——无标题会话的 displayTitle 本身就是目录 basename，反推会重复；但我们复用的是现成 `sessionLabel`，它读 `byId[..].cwd`，无显式标题时直接回退成 `dir` 单段，**不会**产生 "dir: dir"。
- 我们已有 `sessionLabel(row, id)` → `dir: title`（fallback dir → displayTitle → id）、`dirName(cwd)`，直接复用。
- 底部 chip 由我们自己的 `ComposerDock` 渲染（`data-enkeep-current-chip`），删除即为纯本地改动。
- 样式注入沿用现有 `data-plugin-css` + `<style>` 幂等模式（如 `installActivityStyle`）。

---

## 3. 技术方案总览

- **接管插槽**：注册 `conversation.session.header.lineage` 插槽渲染器，组件内用 `openTitle === undefined`（配合 `lineageSessionId === sessionId`）判定当前会话；当前会话渲染我们的橙色 chip，祖先 crumb 回退渲染原生 `displayTitle`（保住可点击/层级）。
- **隐藏原生名**：新增一条**结构化 `:has()` CSS**，匹配"后面紧跟 lineage 插槽锚点的原生 title span"，仅当 siblings 中含我们的当前标记时隐藏；不依赖 hash class。该标记**只在「末级非 subagent」时打**，subagent 结构下不打（那里没有原生名可隐藏，误隐藏会吃掉 `/` 分隔符）。
- **颜色**：用现成 token `--dsw-alias-state-warn-primary`（底部 chip 同款橙），带 `data-*` 钩子。
- **顶层 CSS 收口**：所有新选择器限定在标题栏容器内（经插槽自身的 `data-slot` + 结构锚点），不写裸全局选择器。
- **删除底部 chip**：`ComposerDock` 不再渲染 chip 元素，仅保留 `QuickPrompts`；若既无 chip 也无 quick，仍按原逻辑返回 null。
- **防御式**：DOM 判空、`useSessions` selector 判空，祖先/无 cwd/无 title 各种边界都有回退文案。

---

## 4. 实施步骤

### 步骤一：注册 lineage 插槽，渲染当前会话 chip（先不隐藏原生名）

**功能**
- 在标题栏当前会话位置渲染橙色 `dir: title`（带工作目录），数据来自 `cwd` + `title`。
- 祖先 crumb 保持原生显示与点击。

**技术**
- 新增 `HeaderTitle` 组件，签名含注入的 `useSessions`、`sessionId` 及插槽 owner props（`lineageSessionId`、`displayTitle`、`openTitle`）。
- 判定：`const isCurrent = openTitle === void 0 && lineageSessionId === sessionId`（双条件更稳；祖先有 `openTitle`）。
- 当前会话：`row = useSessions(s => s.byId[lineageSessionId])`，`label = sessionLabel(row, lineageSessionId)`；渲染 `<span data-enkeep-header-title title=...>{label}</span>`。
- **隐藏标记仅末级非 subagent 才打**：`const isSubagent = !!(row && row.origin === 'subagent')`；仅当 `isCurrent && !isSubagent` 时给上面的 span 再加 `data-enkeep-header-hide-native`（供步骤二的 CSS 命中）。subagent 末级**不打**此标记——它的原生名本就没渲染，打了会误伤 `/` 分隔符。
- 祖先（含 subagent 祖先）：渲染 `<span>{displayTitle}</span>`（不添加任何 current/hide 标记）；若 `openTitle` 存在则包成可点击按钮 `onClick=openTitle`，保持原交互。
- 注册：`ctx.slots.register({ name:'conversation.session.header.lineage', id:'enkeep-header-title', scope 由插槽决定, inject:()=>({}) }, props => h(HeaderTitle, {...props}))`，用 `ctx.slots.inject('conversation.session.header.lineage', ...)` 包裹，disposer 清理。

**完成定义**
- 顶部当前会话多出一个橙色 `dir: title`（此时原生名可能还在，属预期中间态）；祖先 crumb 外观/点击不变。

**验收标准**
- 静态检查：注册用 `inject` 包裹、有 disposer；组件判空（`row`、`useSessions`、owner props）。
- 静态检查：`isCurrent` 判定用 `openTitle === void 0`；cwd 取自 `byId[..].cwd`，未从 displayTitle 反推。
- mock：当前会话 chip 文案 = `sessionLabel` 结果；无 cwd 时回退 displayTitle/id；无显式标题时回退为 `dir` 单段（不会出现 "dir: dir"）。
- mock：祖先 crumb 渲染 displayTitle，且 `openTitle` 存在时按钮可点击。
- mock：`lineageSessionId !== sessionId` 时不渲染 current 标记。
- mock：`isCurrent && isSubagent`（末级 subagent）渲染 chip 但**不**打 `data-enkeep-header-hide-native`；`isCurrent && !isSubagent` 才打。
- 未影响 composer/activity-bar 的既有注入。

**成功标准**
组件能随会话切换正确更新（React 响应式），当前/祖先两类 crumb 渲染分支正确，无 console 报错。

---

### 步骤二：隐藏原生当前名 + 橙色样式

**功能**
- 让顶部只显示我们的橙色 `dir: title`，原生 `crumbCurrent` 名消失；祖先不受影响。

**技术**
- 在 `ACTIVITY_CSS`（或合适的既有样式表）追加：
  - `[data-enkeep-header-title]{ color:var(--dsw-alias-state-warn-primary,#f59e0b); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:...; }`
  - 隐藏原生名（结构化）：
    `[data-slot="conversation.session.header.lineage"]:has(> [data-enkeep-header-title] > ... )` 这类写法需以实际 DOM 为准；**关键约束**：只有当插槽锚点内含 `data-enkeep-header-hide-native` 标记（步骤一仅末级非 subagent 才打）时，才隐藏"紧跟该锚点之前的兄弟 span"。写法形如：
    `span:has(+ [data-slot="conversation.session.header.lineage"]:has([data-enkeep-header-hide-native])){display:none}`。
    因为 subagent 结构不打该标记，此规则不会命中 `/` 分隔符或 subagent 祖先名。
  - 实测两种结构都要覆盖：①末级非 subagent（原生名隐藏、chip 显示）；②末级 subagent（chip 显示、`/` 分隔符与祖先名完好、无原生名可隐藏）。
  - 兜底：若 `:has` 方案在实测中不稳定，退化为"原生名缩为透明 + 我们的 chip 覆盖同位置"，仍不依赖 hash class，且同样只对打了 hide 标记的结构生效。

**完成定义**
- 顶部当前会话只剩一个橙色 `dir: title`；祖先面包屑（含分隔符、可点击名）与改动前一致。

**验收标准**
- 实测：当前会话位置原生名不再可见，我们的橙色 chip 位置/对齐正常，未把 crumbs 撑破或换行异常。
- 实测：有祖先层级的会话，"/" 分隔符与祖先名仍在、可点击。
- 静态检查：隐藏规则带 current 标记条件，不是"见插槽就隐藏"。
- 静态检查：未写裸全局选择器、未写 `:root`/`body`、未碰宽度隔离变量（`--dsh-chat-content-width` / `--dsh-composer-card-max-width`）。
- mock：无 cwd / 超长标题时 chip 省略号正常、不溢出。

**成功标准**
顶部只有一份醒目名字、与底部原 chip 视觉一致；祖先导航零回归。

---

### 步骤三：删除底部重复 chip

**功能**
- 输入框下方的当前会话 chip 不再显示，快捷提示词保持原位。

**技术**
- `ComposerDock` 中删除 `chip` 的构造与渲染，仅保留 `QuickPrompts` 分支；`if (!quick) return null`。
- 同步清理仅服务于该 chip 的样式（`[data-enkeep-current-chip]`、`[data-enkeep-current-label]`、`[data-enkeep-composer-current]` 中不再需要的部分），保留快捷提示词相关样式与 `[data-composer-dock]` 布局规则（避免影响原生 stats 行）。
- 删除后 `sessionLabel` / `dirName` 仍被 `HeaderTitle` 使用，不得一并删除。

**完成定义**
- 底部输入行无当前会话 chip；快捷提示词、原生 stats/ContextMeter 行不受影响。

**验收标准**
- 实测：底部不再显示 `data-enkeep-current-chip`；快捷提示词仍在。
- 实测：composer 整行（我们内容 + 原生 stats）未拆分、未错位（延续 `order:-1` + 单行合并的既有修复）。
- 静态检查：`sessionLabel`/`dirName` 仍被引用；无遗留 `data-enkeep-current-chip` 渲染代码。
- 静态检查：未改动 `QuickPrompts`、词库、fetchSkills 逻辑。

**成功标准**
底部重复信息消失且布局无回归，顶部名字成为唯一权威显示。

---

### 步骤四：全面回归 + 发布

**功能**
- 回归既有功能，审核改动范围，同步安装副本并发布。

**技术**
- `node --check client.js`。
- 回归清单：活动区（多置顶 stale-closure 修复、拖拽、5 个头部按钮含侧栏隐藏）、composer（chip/圆角/快捷提示词/宽度隔离）、常用词 v2、技能快捷插入、awaiting 状态、settings、侧栏隐藏（纯声明式）、git-panel split grip。
- 范围审核：仅 `client.js` + 本文档；无新依赖、无构建、无 schema/config 变更、不碰 skill-picker、依赖 URL 无 SHA、词库数据未变、不改任何 DSH 核心源码。
- 同步安装副本，`Get-FileHash` 校验源与副本一致；`node --check` 安装副本。
- 提交推送，`HEAD == origin/main`，工作区干净。
- 从线上 preload 取 `rev`，拉取插件脚本核实新标记（`data-enkeep-header-title` / `data-enkeep-header-hide-native`）已上线、且底部 chip 渲染代码已移除（**不重启 dsh web**）。

**完成定义**
- 检查全通过、工作区干净、线上副本含新代码。

**验收标准**
- 全部静态/mock 检查通过。
- 哈希一致、HEAD 一致、线上脚本含新标记且无底部 chip 渲染。
- 服务 200、页面正常加载。

**成功标准**
发布完成、刷新即可见：顶部橙色 `dir: title` 唯一显示、底部重复消失、所有既有功能正常、可回滚。

---

## 5. 关键约束（钉死）

- 零新 npm 依赖、零构建；只改 `client.js`（+ 本规划文档），不改任何 DSH 核心源码。
- 只占用空插槽 `conversation.session.header.lineage`，不改插槽本身注册、不 fork 核心。
- cwd 只从 `byId[..].cwd` 读，绝不从 displayTitle 反推。
- 祖先 crumb 零回归：外观、分隔符、可点击均保持原生。
- 隐藏原生名不依赖 hash class；用 `:has` + 我们自己的 `data-enkeep-header-hide-native` 标记条件化（仅末级非 subagent）。
- 宽度隔离：不写 `--dsh-chat-content-width` / `--dsh-composer-card-max-width`；不写裸 `:root`/`body` 规则。
- 不破坏既有功能：侧栏隐藏（纯声明式）、活动区拖拽与 5 按钮、composer 单行合并与圆角、常用词 v2、技能快捷插入、awaiting、git-panel split grip。
- 不动词库 v2 schema、不碰 skill-picker、依赖保持 `git+https://github.com/80779898/dsh-enkeep.git`（无 SHA）。
- 不用 PowerShell 的 `ConvertFrom-Json`/`ConvertTo-Json`/`Set-Content` 处理任何数据。

---

## 6. 风险与兜底

| 风险 | 兜底 |
|---|---|
| `:has` 隐藏原生名在实测中不命中，或误伤 subagent 的 `/` 分隔符 | 隐藏标记只在末级非 subagent 打（已写入步骤一/二），subagent 结构天然不命中；先只做步骤一验证渲染，再上隐藏；仍不命中则退化为"原生名透明 + 我们 chip 覆盖"；再不行则保留原生名、仅追加目录小标（需回头与用户确认） |
| DSH 升级改了 crumb/插槽 DOM 结构 | 插槽锚点 `data-slot` 与 `openTitle` 语义稳定；隐藏规则仅失效不报错，enkeep 其它功能不受影响 |
| 另一插件将来也注册 lineage 插槽（single 独占） | 当前为空；若冲突则该插槽只能有一个胜出，届时评估让位或换用 header.actions 插槽追加 |
| cwd 偶发缺失 | `sessionLabel` 已有 fallback（displayTitle/id）；chip 至少显示名字 |
| 超长目录/标题撑破 crumbs | chip 加 `max-width` + `text-overflow:ellipsis`；crumbs 容器原生 `overflow:hidden` |
| 删除底部 chip 后 composer 行变化 | 保留 `[data-composer-dock]` 布局与快捷提示词样式；回归单行合并（order:-1）避免拆行 |
