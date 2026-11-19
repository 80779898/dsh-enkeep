# dsh-enkeep 活动区会话行操作（重命名 / 归档 / 置顶）开发计划

> 范围：在活动区浮动窗口（`shell.overlay` 的 `dsh-enkeep.activity-bar`）的每个会话条目 hover 时，
> 增加三个图标按钮：**重命名 / 归档 / 置顶**，参考官方工作区会话行的样式与交互。
> 本计划**不含时间安排**，只列步骤、功能、技术与验收标准。

---

## 0. 需求确认（用户已拍板）

### 0.1 三个按钮

活动区每条会话 hover 显示三个按钮，样式与官方工作区行图标按钮一致（统一 22×22 SVG 图标、hover 背景、title 提示）：

1. **重命名**：改会话本身标题。
2. **归档**：结果同官方归档，但**我们的归档点击后先弹确认框**——点「确定」才归档，点「取消」什么也不做（防误点）。
   - 注：官方其实也只在"会话运行中"才弹确认（活动区拒绝场景），普通非运行会话是直接归档的；我们这里**无条件都先弹确认**。
3. **置顶**：点一次同时做**两件事**（动作永远成对）：
   - (a) 调官方 `uiWorkspace.pinSession(id)`（官方那边的置顶我们不管它怎么排序，只负责调用）；
   - (b) 把该会话加入**我们活动区自己的置顶集合**（enkeep 私有，驱动活动区常显 + 置顶区排序）。
   - 再次点击（取消置顶）同样成对：`uiWorkspace.unpinSession(id)` + 从我们置顶集合移除。

### 0.2 置顶的语义（与官方不同，是本功能重点）

- **锁定常显**：被我们置顶的会话，无论是否超时（超出活动区时间窗）、无论运行中/未读状态如何，都**始终显示在活动区**，不因时间窗过滤被剔除。
- **置顶区排序**：置顶会话排在活动区列表**最前面**，形成一个"置顶区"；**多个置顶之间仍按原来的排序**（当前规则是 SessionId 字典序）。
- **归档优先**：若会话被归档，即使它在我们置顶集合里，也**不显示**（归档 > 置顶锁定）。这是用户确认的取舍。
- 官方置顶对我们的排序**无影响**——活动区排序只认我们自己的置顶集合。

### 0.3 关键事实（已核查源码，非猜测）

- `uiWorkspace`（`client-ui-workspace` 的 Client service face，`ctx.get('uiWorkspace')`）公开可用方法：
  `openSession` / `startSession` / `pickDirectory` / **`pinSession(id)`** / **`unpinSession(id)`** / **`archiveSession(id)`** / `unarchiveSession(id)` / `forkSession(...)`。
  活动区已用 `ctx.get('uiWorkspace')` 拿 `openSession`/`startSession`，再加三个调用即可。
- 官方**重命名对话框**的触发器 `requestSessionRename` 是 workspace 内部 slot 注入（`shortcutControls.rename`），**不对外暴露**；但会话重命名的底层调用是公开的：
  `sessions.using(sessionId, { source: 'workspaceOperation' }, (ref) => ref.binding.session.rename(title))`（workspace 源码 5077 行的原样做法）。
  `sessions` 是 `dsh-client-sessions` 的 Client service（`ctx.get('sessions')`，见 runner 的 ISessions 接口 1922 行含 `using`）。
  → **重命名我们自己实现一个轻量对话框**（调用上面的底层 rename），不依赖官方对话框触发器。
- 官方归档确认框 `SessionArchiveConfirmDialog` 也是内部 slot，不可复用；**我们自己实现确认弹窗**。
- 活动区会话筛选逻辑在 `selectActivity(sessions, statuses, archivedIds, hours, now)`（client.js ~304 行），
  当前按 SessionId 字典序排序、按时间窗/运行/未读过滤、剔除归档/subagent/blank，并 `slice(0, MAX_ITEMS)`。
- 活动区已有 localStorage 辅助（拖动位置 `ACTIVITY_POS_KEY`），可复用同样的读写模式新增一个置顶 key。
- 所有改动都在 `client.js`（factory 内），不涉及 host `index.js`，**无需重启 web**，刷新页面即可。

---

## 1. 分步开发计划

### 步骤 1：我们的置顶集合（数据结构 + 持久化）

**功能**：新增 enkeep 私有的活动区置顶集合，支持增删查 + 持久化 + 变更触发活动区重渲染。

**技术**：
- 新 localStorage key：`dsh.enkeep.activity.pinned.v1`，存 `string[]`（SessionId 数组）。
- 模块级 helper（仿 `ACTIVITY_POS_KEY` 的 `read/write`）：`readPinned()` / `writePinned(ids)`，读取时校验数组 + 元素为字符串，损坏则返回空数组。
- 在 `ActivityBar` 内用 `React.useState(readPinned)` 持有 `pinned`；提供 `setPinned` 包装：更新 state + 写 localStorage。
- 置顶顺序：新置顶的放数组**前面**（unshift），取消时过滤移除；仅用于去重与判定，实际展示排序在步骤 2 统一按 id 字典序。

**完成标准**：`node --check` 通过；读写幂等，损坏数据不抛错。

**验收**：
- 初始无 key → 置顶集合为空；
- `readPinned` 对非法 JSON / 非数组 / 非字符串元素均回退为空数组；
- 写入后再读一致。

**成功判定**：置顶集合可可靠读写、持久化、容错——视为步骤 1 成功。

---

### 步骤 2：`selectActivity` 改造——置顶区 + 常显锁定 + 归档优先

**功能**：置顶会话进入活动区顶部的"置顶区"，且不受时间窗过滤；归档仍剔除。

**技术**：
- `selectActivity` 增加入参 `pinnedSet`（我们的置顶集合 Set）。
- 会话遍历时：
  - 归档 / subagent / blank 的剔除规则**保持不变**（归档优先，即使置顶也剔除）；
  - 过滤条件改为：`running || unread || recent || pinnedSet.has(id)`——即置顶的即使不运行、未读、超时也保留。
- 排序分两段：先按 `pinnedSet.has(id)` 分到置顶区，再各自按 SessionId 字典序排序，最后拼接 `[...置顶区, ...普通区]`，再 `slice(0, MAX_ITEMS)`。
- `ActivityBar` 调用处传入 `new Set(pinned)`；`pinned` 变化会触发组件重渲染并重算 `items`。

**完成标准**：`node --check` 通过；纯函数测试覆盖置顶/超时/归档/多置顶排序。

**验收**：
- 一个超时、非运行、非未读的会话，置顶后仍出现在活动区；
- 置顶项排在最前，多个置顶之间按 id 字典序；
- 被归档的置顶会话不显示；
- 取消置顶后，若已超时则按原规则自然消失；
- 总数仍受 `MAX_ITEMS` 限制。

**成功判定**：置顶区 + 常显锁定 + 归档优先 + 排序正确——视为步骤 2 成功。

---

### 步骤 3：三个 hover 按钮（渲染 + 图标 + 布局）

**功能**：每条会话行 hover 显示重命名/归档/置顶三个图标按钮，不挤占标签、不影响点击会话打开。

**技术**：
- 会话行当前是 `button[data-enkeep-activity-item]`，内部是 `点 + 标签 + 当前徽标`。按钮**不能嵌在 button 里**（非法嵌套），故**把行容器改为 `div[data-enkeep-activity-item]`**，会话打开改由一个占满的 `button[data-enkeep-activity-label]`（标签）或行内主区域触发 `openSession`。
  - 更稳妥结构：行容器 `div`；一个 `button.item-main`（flex:1，含点+标签+徽标，onClick=openSession）+ 三个操作按钮（各自 `button`，hover 显隐）。
- 三个按钮统一用 `HeaderIcon` 风格的 SVG（复用现有 `HeaderIcon` 新增 `kind: 'rename' | 'archive' | 'pin' | 'unpin'`，或新增独立 `RowIcon`），22×22、无边框、hover 背景。
- CSS：新增 `[data-enkeep-activity-item-actions]`（`display:flex; margin-left:auto; opacity:0`），
  `[data-enkeep-activity-item]:hover [data-enkeep-activity-item-actions]` 与 `:focus-within` 时 `opacity:1`。
- 每个按钮 `title` / `aria-label` 中文；`onClick` 调步骤 4/5/6 的处理函数，并 `e.stopPropagation()` 避免触发打开会话。
- 归档按钮：已归档的会话从活动区消失，故活动区内只会显示"归档"态。

**完成标准**：`node --check` 通过；mock 渲染验证每行出现 3 个按钮、结构合法（无 button 嵌套）、点击不触发 openSession。

**验收**：
- hover（或键盘 focus）才显示三个按钮；
- 三个按钮点击都不触发会话打开；
- 图标视觉与头部按钮一致（尺寸/颜色/hover）。
- 置顶的会话其置顶按钮显示为"取消置顶"态（pin/unpin 两种图标）。

**成功判定**：三按钮渲染正确、交互隔离、图标统一——视为步骤 3 成功。

---

### 步骤 4：置顶动作（成对调用 + 取消）

**功能**：置顶按钮一次点击同时驱动官方置顶与我们置顶集合；取消亦然。

**技术**：
- `togglePin(id)`：
  - 若未置顶：`uiWorkspace.pinSession(id)`（忽略失败只 warn）+ `setPinned([id, ...pinned.filter(x=>x!==id)])`；
  - 若已置顶：`uiWorkspace.unpinSession(id)` + `setPinned(pinned.filter(x=>x!==id))`。
- 官方文档 `pinSession` 会调整官方工作区顺序，我们不管；只保证调用发生。
- 用 `busy` 防抖（复用现有 busyRef）避免连点。

**完成标准**：`node --check` 通过；mock 验证置顶/取消各调用一次对应官方方法且我们集合同步增删。

**验收**：
- 点击置顶：`pinSession` 被调用一次，会话进入活动区顶部置顶区；
- 再点取消：`unpinSession` 被调用一次，会话离开置顶区（若超时则消失）；
- 连续快速点击不产生重复调用。

**成功判定**：成对调用、集合同步、防抖——视为步骤 4 成功。

---

### 步骤 5：归档确认弹窗（防误点）

**功能**：点归档先弹确认框，确定才归档，取消不动作。

**技术**：
- 在 `ActivityBar` 内新增 state `confirmArchive`（`{id, title} | null`）。
- 归档按钮点击 → `setConfirmArchive({ id, title: it.label })`。
- 确认弹窗渲染在活动区组件内（`position:fixed` 覆盖层 + 卡片），两个按钮「确定」「取消」：
  - 确定：调 `uiWorkspace.archiveSession(id)`（失败 warn），清空 confirmArchive；
  - 取消：仅清空 confirmArchive。
- 弹窗需要 `pointer-events:auto`（overlay 根是 click-through），置于活动区 DOM 内或 `shell.overlay` 另一 entry 均可；优先放组件内以减少注册面。
- 文案：标题「归档会话」，正文「确定归档会话「{title}」？归档后可在工作区取消归档。」，按钮「取消」「确定归档」。
- ESC / 点击遮罩关闭 = 取消（体验增强，非必须）。

**完成标准**：`node --check` 通过；mock 验证确定调用 archiveSession、取消不调用。

**验收**：
- 点归档 → 出确认框，此时会话仍在活动区；
- 点取消 → 框消失、会话仍在、archiveSession 未被调用；
- 点确定 → 框消失、archiveSession 调用一次、该会话从活动区消失（归档从活动区移除即时生效：靠 `useWorkspaces` 的 archivedSessionIds 更新触发重渲染，或在成功回调里本地过滤）。

**成功判定**：确认流程正确、防误点、确定/取消分支清晰——视为步骤 5 成功。

---

### 步骤 6：重命名对话框（自实现，调公开底层 API）

**功能**：点重命名弹出输入框，确定后改会话标题。

**技术**：
- 官方重命名对话框触发器不对外暴露，故**自实现**：ActivityBar 内 state `renameTarget`（`{id, title} | null`）+ 输入框对话框。
- 底层调用（官方同款）：
  `const sessions = ctx.get('sessions'); sessions.using(id, { source: 'workspaceOperation' }, (ref) => ref.binding.session.rename(newTitle))`。
  - 由 `ctx.effect` 内的 `renameSession(id, title)` 闭包封装（仿 `openSession` 的 `get('sessions')` 惰性取值）。
  - 通过 `inject` 传给 ActivityBar：`renameSession`。
- 对话框：输入框预填当前标题，确定（trim 非空且与原值不同）→ 调 `renameSession`，取消 → 关闭。
- 标题更新后活动区标签靠 `useSessions` 的会话列表刷新自动更新（无需本地改状态）。

**完成标准**：`node --check` 通过；mock 验证确定调用 renameSession(id,newTitle)、空标题/取消不调用。

**验收**：
- 点重命名 → 出输入框，预填当前标题；
- 输入新标题确定 → 调用底层 rename，活动区标签随之更新；
- 空标题/取消 → 不调用、框关闭。

**成功判定**：重命名走公开底层 API、对话框可用、标签同步——视为步骤 6 成功。

---

### 步骤 7：全量自审 + 同步安装副本 + 提交推送

**功能**：审核、落地、交付。

**技术/动作**：
- git diff 全审：无死代码/TODO/临时文件；新增状态与既有 busy/drag 状态无命名冲突；三按钮事件不互相串扰。
- `node --check client.js` 全过；纯函数测试（`selectActivity` 置顶/超时/归档/多置顶排序、置顶集合读写、三按钮分支、两个对话框分支）。
- 同步到 `~/.dsh/profiles/web/node_modules/dsh-enkeep`，逐文件哈希一致。
- git commit + push（依赖行不带 SHA）。

**完成标准**：工作区干净、哈希一致、测试全绿、已推送。

**验收**：`git status` 干净；本地 HEAD == origin/main；安装副本逐文件哈希一致；无临时文件。

**成功判定**：全部满足视为步骤 7 成功。

---

### 步骤 8：真实浏览器验收（纯客户端，刷新即可）

**功能**：在 GUI 验证端到端（本功能不改 host，**无需重启 web，刷新页面即可**）。

**验收清单**：
- 每条会话 hover 出现三个按钮，图标统一、不触发打开会话；
- 置顶：会话升到活动区顶部、超时也常显、多个置顶按 id 序；官方侧也被置顶（调用发生）；
- 取消置顶：离开置顶区，超时则消失；官方侧也取消；
- 归档：弹确认框，取消不动、确定归档并从活动区消失；
- 重命名：弹输入框，确定后标签更新；
- 拖动/双击复位、Tab 设置表格撑满、快捷栏等既有功能无回退；
- 刷新页面后置顶集合仍保留（持久化）。

**成功判定**：真实 GUI 全链路通过——视为步骤 8 成功。

---

## 2. 全局验收标准（最终交付）

1. 三个 hover 按钮（重命名/归档/置顶）渲染正确、交互隔离、图标统一。
2. 置顶动作成对：官方 `pin/unpin` + 我们置顶集合同步增删；置顶会话常显、置顶区排序、归档优先。
3. 归档无条件先弹确认框，确定才归档、取消不动作；归档会话从活动区消失。
4. 重命名自实现对话框，调公开底层 `sessions.using(...).rename`，标签同步更新。
5. 置顶集合 localStorage 持久化、容错、幂等。
6. 既有功能不回退：拖动、双击复位、设置 Tab、快捷栏、宽度隔离、词库 v2 全部正常。
7. 代码质量：`node --check` 全绿、git 干净已推送、安装副本哈希一致、无临时文件。

## 3. 风险与取舍（如实记录）

- **官方重命名/归档对话框不可复用**：两者触发器都是 workspace 内部 slot 注入，故我们自实现对话框，调公开底层 API（`sessions.using().rename` / `uiWorkspace.archiveSession`）。好处是自包含，代价是弹窗样式需自己写、与官方略有差异（可接受）。
- **会话行结构改造**：把行从 `button` 改成 `div` + 内部主按钮，是为避免 button 嵌套非法；需回归"点击会话打开"与键盘可达性。
- **归档即时从活动区消失**：依赖 `useWorkspaces` 的 archivedSessionIds 更新；若刷新不及时，在确定回调里本地过滤兜底。
- **置顶与官方脱钩**：我们的置顶排序不读官方 pinnedSessionIds，官方那套只负责调用；两边可能出现"官方置顶了但我们没置顶"的不一致，按需求这是允许的（用户明确"官方那个不用管"）。
- **localStorage 容量/损坏**：置顶集合很小；损坏 JSON 回退空数组，不影响活动区其他功能。
