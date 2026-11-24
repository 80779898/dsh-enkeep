# 助手对话内可展开任务面板 — 方案与影响评估

> 状态：方案（未实施）
> 核查日期：2026-11-21
> 代码范围：DSH Web 0.2.1-rc.2 本地安装包、`C:\dev\dsh-enkeep`、`C:\dev\dsh-assistant`
> 方案落点：`dsh-assistant` 提供任务数据（Host），`dsh-enkeep` 提供面板与活动区过滤（Client）
> 本文只规划步骤与内容，不包含工期估算。

---

## 0. 结论摘要

**方案本身可行，推荐做；但“只加一个任务面板”不足以达到目标，必须同时做两件事：**

1. **修任务归属标记。** 现在 `assistant_dispatch` 实际没有把 `sourceSessionId` 写进任务记录：`index.js` 把 `toolHost` 传给 `mainTools`，而 `mainTools` 调的是 `host.sessionInfoFor(agent)`，`toolHost` 上没有这个方法，于是 `sessionInfo` 永远是 `{}`。核查时 `tasks.jsonl` 里的 7 个任务全部没有 `sourceSessionId`。不修这个，面板无法做到“只显示该助手会话创建的任务”。
2. **活动区过滤是独立改动。** 面板只是多了一个查看入口，不会自动让活动区里的 worker 会话消失。必须在 `selectActivity()` 里排除 `da-worker-*` / `dsh-assistant-worker` 会话。

**另外要如实说明一个边界：** 本方案能清掉 **活动区（Enkeep 悬浮条）** 里的任务会话，但**不能清掉原生侧边栏**里的任务工作区/会话。原生侧边栏是否显示由 `dsh-client-ui-workspace` 的 `sessionVisible()` 决定，只排除 `origin === 'subagent'` 和空白会话；worker 会话没有这个标记，所以仍会以“任务工作区”的形式出现在侧边栏（默认折叠）。要彻底达到“主界面只显示助手对话”，还需要改 DSH Web 原生代码或改 worker 会话模型，属于另一件事。

**推荐架构：**

- `dsh-assistant`：修归属字段；新增按 `sessionId` 过滤的只读查询；通过软依赖 `webServer` 暴露 `GET /dsh-assistant-tasks`。
- `dsh-enkeep`：新增 `conversation.input.dock` 任务面板；在 `selectActivity()` 里过滤 worker 会话；配置项和设置页都放在 Enkeep 现有体系里。
- 默认收起、最多 10 个、可在设置页改（1–30，热更新）；收起时不轮询、不订阅；展开时快照 + 轻量轮询；展开状态按会话记忆。

---

## 1. 现状核查（代码证据）

### 1.1 任务与 worker 会话是怎么产生的

`dsh-assistant` 的任务对象由 `src/engine.js` 的 `dispatch()` 创建，字段包括：

- `id`：`da-task-` + 8 位随机串
- `description` / `scope` / `source` / `sourceSessionId`
- `status`：`queued | running | waiting_human | done | failed | stopped | dropped`
- `mandate` / `report` / `attempts` / `createdAt` / `updatedAt`
- 可选 `execution`（隔离工作目录）、`worktreeName`

任务持久化在 `$DSH_HOME/dsh-assistant/tasks.jsonl`，每行一个 JSON，读取时按 `id` 后写覆盖前写。

worker 会话由 `index.js` 的 `pump()` 创建：

- 会话 id：`da-worker-` + task id
- 工作目录：任务的隔离执行目录
- 预设：`dsh-assistant-worker`
- 标题：`任务 <task id>`
- 通过 `ctx.sessionController.create({ sessionId, workspaceId, agentPreset })` 创建

因为每个任务的执行目录不同，`ensureAgent()` 会为每个目录 `ctx.workspaceRegistry.create(cwd)`，所以**每个任务会多出一个工作区**。这正是活动区和原生侧边栏被“任务”占满的直接原因。

### 1.2 活动区为什么会显示这些任务

活动区是 `dsh-enkeep` 的浮动 `ActivityBar`，注册在 `shell.overlay`，不是 DSH 原生视图。

`client.js` 的 `selectActivity()` 当前规则：

- 排除 `blank`
- 排除 `origin === 'subagent'`
- 排除归档会话
- 保留：N 小时内更新 / 运行中 / 完成未读 / 等待交互 / 置顶
- `MAX_ITEMS = 30`
- 按置顶 + SessionId 字典序排列

worker 会话：

- 不是 `blank`（有任务消息）
- 没有 `origin: 'subagent'`
- 通常是运行中或刚刚更新
- 标题是 `任务 da-task-...`

所以它们**必然进入活动区**。这就是用户看到“任务都显示在活动区”的原因。

### 1.3 原生侧边栏为什么也显示

`dsh-client-ui-workspace` 的 `sessionVisible()` 只排除：

- `origin === 'subagent'`
- 非当前会话的空白会话

worker 会话两者都不满足，且每个任务一个工作区，所以原生侧边栏会出现大量“任务工作区”。这部分不在 Enkeep 的可控范围内，除非改 DSH Web 或改 worker 的会话类型。

### 1.4 可用的插槽与配置能力

- `conversation.input.dock`：`kind: 'list'`、`scope: 'session'`，语义是“composer 卡片上方的全宽条目”。Enkeep 已经在这个插槽注册了“最后一条用户提示”条，说明该位置可用、不会被官方布局覆盖。
- `conversation.composer.dock`：composer 卡片下方的环境条目，也已被 Enkeep 使用。
- `conversation.session.header.actions`：会话标题旁的动作位，适合放“任务”入口按钮。
- `ctx.configForms.get('enkeep')`：已有设置页读写通道；`Config` 字段全部 `.volatile()`，客户端写入不会被 Host 拒绝，改完即时生效。
- `ctx.webServer.register({ kind: 'prefix', path, handler })`：Enkeep 已用这个模式提供 `/dsh-enkeep-words` 和 `/dsh-enkeep-skills`，并用自定义请求头挡住跨域页面。
- `uiWorkspace.openSession(sessionId)`：Enkeep 已用这个公开方法从活动区打开会话，可复用来打开任务 worker 会话。

### 1.5 关键缺陷：`sourceSessionId` 实际没有写入

这是本次核查最重要的发现。

调用链：

1. `index.js` 的 `host.mainTools(agent)` 返回 `mainTools(toolHost, agent)`。
2. `src/tools.js` 的 `assistant_dispatch` 执行：
   ```js
   const sessionInfo = typeof host.sessionInfoFor === 'function' ? host.sessionInfoFor(agent) : {}
   const created = host.dispatch({ ..., sessionInfo })
   ```
3. 这里的 `host` 是 `toolHost`，而 `toolHost` 只有 `dispatch / status / cancel / report / answerHuman`，**没有 `sessionInfoFor`**。
4. 所以 `sessionInfo` 永远是 `{}`。
5. `toolHost.dispatch()` 里 `sourceSessionId: sessionInfo && sessionInfo.sessionId` 得到 `undefined`，`engine.dispatch()` 用 `...(sourceSessionId ? { sourceSessionId } : {})`，字段直接不写。

核查结果：`C:\Users\mason\.dsh\dsh-assistant\tasks.jsonl` 中 7 个任务、17 条状态记录，**没有一条包含 `sourceSessionId`**。

**连带影响：** `makeAuthorize()` 从 `sessionInfo.cwd` 取工作区路径。`sessionInfo` 为空时，`allowedWorkspaces` 非空也会走 `no-workspace-context` 分支并放行。也就是说，这个 bug 同时让“派活白名单”处于**失效/放行**状态。修归属字段时，白名单会开始真正生效，这是需要回归验证的行为变化。

### 1.6 结论

- 面板数据不能直接读 `tasks.jsonl`（Client 没有文件系统权限），必须有 Host 只读接口。
- “只显示本会话任务”依赖 `sourceSessionId`，必须先修 1.5 的接线。
- 活动区去重依赖 `selectActivity()` 过滤，和面板是两件独立的事。
- 原生侧边栏的问题不在本方案范围内，不能承诺“主界面完全只剩助手对话”。

---

## 2. 目标与非目标

### 2.1 目标

1. 在助手会话的输入框上方提供一个默认收起的任务面板。
2. 展开后最多显示 N 个“最近任务”（N 默认 10，可在设置页改）。
3. 只显示**当前助手会话派发**的任务，不串其他会话。
4. 超过 N 个时提供“查看全部/历史”入口。
5. 活动区不再显示助手自动创建的 worker 会话，避免两处重复。
6. 收起时不轮询、不订阅；展开时能看到接近实时的状态。
7. 配置热更新，不重启插件；展开状态按会话记忆。

### 2.2 非目标

- 不修改 DSH Web 原生侧边栏的会话可见性规则。
- 不修改任务状态机、不改变 worker 的执行/隔离/授权模型。
- 不在面板里做派活、取消、回答待决问题等写操作；这些仍走助手对话和现有工具。
- 不把 worker 会话改成 subagent 会话（这是另一条可能路线，见 4.3）。
- 不为 `dsh-assistant` 新建一套 Client bundle / 设置页体系（推荐复用 Enkeep）。

---

## 3. 方案设计

### 3.1 总体架构

```
┌──────────────────────────────┐
│ dsh-enkeep (Client)          │
│  conversation.input.dock     │
│    └─ TaskPanel              │
│         │ fetch (只读)        │
│         ▼                    │
│  GET /dsh-assistant-tasks    │
└──────────────┬───────────────┘
               │ 同源 + 自定义头
┌──────────────▼───────────────┐
│ dsh-assistant (Host)         │
│  webServer 软注入            │
│    └─ 只读路由               │
│         │                    │
│  Engine.listForSession()     │
│         │                    │
│  tasks.jsonl（内存 Map）      │
└──────────────────────────────┘
```

职责划分：

- `dsh-assistant`：任务数据的唯一权威，负责归属过滤、状态标签、响应裁剪。
- `dsh-enkeep`：只负责展示、配置、活动区过滤；不复制任务状态机，不读任务文件。
- 两边通过一个很小的 JSON 契约耦合；路由不存在时面板自动隐藏，不影响 Enkeep 其他功能。

**为什么不在 `dsh-assistant` 里做 Client 面板：**

- 它目前没有 `dsh.client` 配置、没有 Client bundle、没有设置页基础。
- 新建一套会重复 Enkeep 已经验证过的 slot/configForms/CSS/设置页模式，风险更大。
- 面板是“展示层”，放 Enkeep 合理；数据接口留在 assistant，职责更清楚。

**为什么不改 DSH Web 原生代码：**

- 本地只有安装后的 `lib` 产物，没有可维护的 Web 源码 checkout；直接改 `node_modules` 不可持续。
- 用官方 slot + 插件路由是受支持的扩展方式，升级风险最低。

### 3.2 数据契约

新增只读路由：

```
GET /dsh-assistant-tasks?sessionId=<sessionId>&limit=10&offset=0
Header: x-dsh-assistant-tasks: 1
```

成功响应：

```json
{
  "ok": true,
  "sessionId": "dsh-assistant-main",
  "total": 12,
  "limit": 10,
  "offset": 0,
  "tasks": [
    {
      "task_id": "da-task-xxxxxxxx",
      "description": "用户原始任务描述",
      "status": "running",
      "status_label": "执行中",
      "createdAt": "2026-11-21T09:16:50.078Z",
      "updatedAt": "2026-11-21T09:16:51.127Z",
      "worker_session_id": "da-worker-da-task-xxxxxxxx",
      "report_summary": "最近一次上报摘要（截断）",
      "human_action": "需要用户决定的问题（截断，仅 waiting_human）"
    }
  ]
}
```

约束：

- `limit`：1–50，默认 10。
- `offset`：>= 0，上限 10000，防止异常客户端扫全表。
- 只接受 `GET`；其他方法 405。
- 缺少 `x-dsh-assistant-tasks: 1` 返回 403。
- 缺少/非法 `sessionId` 返回 400。
- 未知路径 404；路由处理器只认 `/dsh-assistant-tasks` 本身。
- `description` 保持原文；`report_summary` 和 `human_action` 由 Host 截断到 200 字符，避免列表响应过大。完整内容在 worker 会话里看。
- `status_label` 由 Host 用 `src/labels.js` 生成，Client 不复制中文枚举，避免两边不一致。
- 这个接口只读，不修改任务、不投递消息、不触发 worker。

### 3.3 任务归属规则

**新任务：**

- 修 `toolHost`，让 `sessionInfoFor(agent)` 可用。
- `dispatch()` 写入 `sourceSessionId = agent.id`，以及 `sessionInfo.cwd` 供授权使用。
- 面板只查 `task.sourceSessionId === 当前 sessionId`。

**历史任务（本次修复前创建的，没有 `sourceSessionId`）：**

- 不做破坏性回填，不修改 `tasks.jsonl`。
- 路由读取时做兼容：`!task.sourceSessionId && sessionId === 'dsh-assistant-main'` 时视为属于 canonical 助理会话。
- 只有 canonical 主会话能看到这些“无归属”旧任务；其他 main-preset 会话不显示，避免同一个旧任务在多处重复出现。
- 这个兼容规则要写进路由注释和测试，未来清理旧数据后可删除。

**worker 会话标记：**

- 主标记：会话 id 前缀 `da-worker-`（`dsh-assistant` 已经把它作为 worker 的公开约定，`workerTaskId()` / `cancelWorker()` 都依赖它）。
- 辅助标记：`projectionValues.agentPreset === 'dsh-assistant-worker'`。
- 活动区过滤用“前缀命中 或 预设命中”；前缀是同步、稳定、冷启动也可用的，预设用于防御未来 id 规则变化。
- 这两个常量在 Enkeep 侧要加注释：必须与 `dsh-assistant` 的 `WORKER_PREFIX` / `WORKER_PRESET` 保持一致。

### 3.4 面板位置与交互

**位置：** `conversation.input.dock`，`order: 150`，位于 git chip（100）之后、“最后一条用户提示”条（200）之前。这样展开时向上占用对话区，收起时只占一条 34px 左右的横条，输入框位置不被推得太远。

**显示条件：**

- 当前会话是助理主会话：`sessionId === 'dsh-assistant-main'` 或 `row.projectionValues.agentPreset === 'dsh-assistant-main'`。
- 非空白会话（`blank !== true`）。
- 配置 `showTaskPanel !== false`。
- 不满足时组件返回 `null`，并且不发起任何请求。

**收起态：**

```
[图标] 任务  12   ● 2 个执行中                    [展开 ⌄]
```

- 左侧图标 + “任务”。
- 任务总数（来自最近一次快照）。
- 有运行中/等待决定时显示一个小圆点或计数。
- 右侧展开箭头。
- 整行是一个 `<button>`，支持键盘 Enter/Space，带 `aria-expanded`。

**展开态：**

- 头部下方列出最多 N 条，按 `updatedAt` 倒序。
- 每行：
  - 状态圆点（运行中 / 等待决定 / 完成 / 失败 / 已停止 / 排队中）
  - 任务描述（单行省略，`title` 显示全文）
  - 状态标签 + 相对时间（如“3 分钟前”）
  - `waiting_human` 时额外显示一行“需要你决定：……”（截断）
  - 右侧“打开”按钮：`uiWorkspace.openSession(worker_session_id)`
- 行本身可点击打开会话；“打开”按钮是显式入口，避免误触。
- `queued` 任务还没有 worker 会话，禁用“打开”，显示“排队中”。
- 打开失败时在该行显示一条内联错误，不弹全局对话框。
- 最大高度 `min(46vh, 420px)`，内部滚动，避免把输入框挤出屏幕。
- 底部：
  - 左侧“共 N 个”
  - 中间“刷新”
  - 右侧 `total > N` 时显示“查看全部 N 个”

**空态/错误态：**

- 展开且 `total === 0`：显示“还没有任务。派活后结果和状态会出现在这里。”
- 路由 404：面板整体隐藏，`console.warn` 一次，不显示死 UI。
- 网络错误/500：保留面板，展开区显示“任务服务暂不可用”+“重试”。
- 加载中：保留旧数据，头部显示轻微 loading 状态，不清空列表（避免闪烁）。

**不显示面板的会话：**

- worker 会话（`da-worker-*` / worker 预设）：用户已经在任务会话里，不需要再套一层任务面板。
- 普通会话、空白会话。
- 非 web profile（没有 `conversation.input.dock`）自然不渲染。

### 3.5 “查看全部/历史”

- 最近视图只显示 N 条；`total > N` 时底部出现“查看全部 N 个”。
- 点击后在同一面板内切换到历史视图，不新开页面、不跳路由：
  - 标题“全部任务 / 返回最近”
  - 第一页 `limit=50&offset=0`
  - 行内容与最近视图一致，但可以显示终态任务
  - 顶部筛选：全部 / 进行中 / 等待决定 / 已完成 / 失败或停止
  - `total > 50` 时底部“加载更多”，按 `offset` 追加
- 历史视图不自动轮询；提供“刷新”按钮。原因：历史以终态任务为主，轮询收益低；运行中任务在最近视图已经能看到。
- 收起面板或切换会话时，历史视图重置为最近视图，避免下次展开直接落在历史模式。
- N 只约束最近视图；历史视图是用户显式请求，允许超过 N。

### 3.6 实时性策略

| 状态 | 行为 |
|---|---|
| 首次挂载 | 请求一次最近快照（用于总数/是否显示），不建立订阅 |
| 收起 | 不轮询、不订阅；在鼠标移入头部、窗口重新获得焦点、页面从隐藏变可见时各刷新一次（hover 刷新做 1 秒节流） |
| 展开（最近视图） | 立即请求一次，然后每 2.5 秒轮询；页面隐藏时暂停；恢复可见时立即刷新 |
| 展开（历史视图） | 进入时请求 50 条；不自动轮询；手动“刷新” |
| 收起/卸载/切换会话 | 清除定时器、`AbortController.abort()`，丢弃在途响应 |

技术要点：

- 用 `AbortController` + 请求序号（`seqRef`）防止旧响应覆盖新状态。
- 用 `inFlightRef` 防止轮询重叠：上一请求未结束就跳过本次 tick。
- 用 `document.visibilityState` 暂停隐藏页轮询，避免后台标签页耗电。
- 不做 SSE/WebSocket：任务引擎本身每 2 秒 pump 一次，2.5 秒轮询不会比引擎更滞后；SSE 需要 Host 推流和连接管理，收益不足以抵消复杂度。未来如果任务量或并发面板显著上升，再考虑 SSE。
- 不在收起态使用 `useSessions` 订阅会话状态；只在组件内用两个窄选择器读 `preset` / `blank`，这两个值变化频率低，不构成轮询。
- 如果未来并排显示两个助理会话且都展开，各自轮询；2.5 秒 + 单飞 + 可见性暂停足以控制，必要时再加“同一页面共享一个轮询器”的优化。

### 3.7 活动区过滤（与面板去重）

在 `selectActivity()` 中新增一个纯过滤条件：

```js
function isAssistantWorkerSession(id, row) {
  if (!id) return false
  if (id.startsWith('da-worker-')) return true
  const preset = row && row.projectionValues && row.projectionValues.agentPreset
  return preset === 'dsh-assistant-worker'
}
```

过滤位置：在归档判断之后，在时间窗/运行中判断之前。

规则：

- `hideAssistantTaskSessions !== false` 时，排除 assistant worker 会话。
- 例外 1：`pinned` 的 worker 会话保留——用户显式置顶，说明想常显。
- 例外 2：当前正在查看的 worker 会话保留——否则用户从面板打开任务后，活动区里找不到它，无法确认自己在哪个任务会话；离开后自然消失。
- 当前会话的判断沿用现有 `retainedBy.mainView > 0` 的数据源，不新增全局状态。
- 归档优先级不变：归档会话即使置顶也不显示。
- 主助理会话本身**不**过滤：它是真实对话，必须留在活动区，用户才能回到助手。
- 配置 `hideAssistantTaskSessions` 默认 `true`；设为 `false` 可回退到旧行为，便于排查。

效果：

- 活动区只剩：主助理会话 + 用户自己的正常会话（+ 置顶/当前例外）。
- 任务状态统一在助手对话内的面板查看、打开，不再和活动区重复。
- 这不改变原生侧边栏；侧边栏仍是“所有会话”的管理面。

### 3.8 配置项、设置页与热更新

放在 **dsh-enkeep** 的 `Config`，而不是 dsh-assistant：

- 这是 UI 行为配置，Enkeep 已有设置页和 `configForms` 通道。
- dsh-assistant 不需要知道 N；路由按请求的 `limit` 返回即可。

新增字段（全部 `.volatile()`）：

```js
showTaskPanel: Schema.boolean().default(true).volatile(),
taskPanelLimit: Schema.number().step(1).min(1).max(30).default(10).volatile(),
hideAssistantTaskSessions: Schema.boolean().default(true).volatile(),
```

设置页新增一个 tab：`{ id: 'tasks', label: '任务面板' }`，内容：

- 复选框“在助手会话输入框上方显示任务面板”
- 数字输入“最近任务数量 N（1–30）”
- 复选框“活动区隐藏后台任务会话”
- 说明文字：
  - “面板只显示当前助手会话派发的任务。”
  - “收起时不轮询；展开后每 2.5 秒刷新。”
  - “活动区过滤不影响原生侧边栏。”

热更新：

- `volatile()` 字段由 Client `configForms` 写入，Host 接受并触发 `loader/volatile-update`，不需要重启。
- 面板订阅 `form.subscribe`，N 改变时立即按新 N 重新请求/裁剪。
- `showTaskPanel` 改变时动态注册/注销 slot（参照现有 `showCommonWords` 的 `sync` 模式），不留下空组件。
- `hideAssistantTaskSessions` 改变时活动区立即重算。
- 默认值写在 `Config` 和 `cordis.patch.yml`；本机 profile 的 patch 没有这些键也没关系，Schemastery 会用默认值填充。若运维希望显式固化，可在 profile patch 的 `enkeep.config` 补三行。

### 3.9 折叠状态记忆

- 默认：**收起**。
- 记忆粒度：**按会话**，不是全局。
- localStorage key：`dsh.enkeep.taskpanel.open.v1`，值为 `{ "<sessionId>": true }`。
- 展开时写入；收起时删除该会话的键。
- 会话切换时从 localStorage 读取该会话的状态；切回时恢复上次的展开/收起。
- 不记忆“历史视图”“筛选条件”“滚动位置”；每次展开都回到最近视图顶部。
- 写入时限制最多 100 个会话键，超出按插入顺序删除最旧的，避免 localStorage 无限增长。
- 读取/写入都用 try/catch；localStorage 不可用时静默退回“默认收起”。

---

## 4. 影响评估

### 4.1 正面影响

- **活动区回归“会话导航”本职**：不再被几十个 `任务 da-task-...` 行淹没。
- **任务状态有固定归宿**：助手对话内一处查看，和对话上下文绑定，不需要在活动区/侧边栏之间找。
- **改动是增量的**：新 slot、新只读路由、新配置字段；不修改官方 Web 源码，不改任务状态机。
- **权限边界清晰**：面板只读，不能派活/取消/回答，危险操作仍走现有工具与人工确认。
- **可回退**：`showTaskPanel=false` 隐藏面板；`hideAssistantTaskSessions=false` 恢复旧活动区；路由存在但不被调用时无副作用。
- **顺带修复一个真实缺陷**：归属字段修好后，结果能回到派发会话，`allowedWorkspaces` 也开始真正生效。

### 4.2 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `sourceSessionId` 仍为空 | 面板无任务或串任务 | 先修 `toolHost` 接线；路由对旧任务做 canonical 兼容；加端到端验收 |
| 修复归属字段让 `allowedWorkspaces` 真正生效 | 原先能派活的工作区可能被拒 | 这是预期的安全修复；上线前用空/非空白名单各回归一次；在变更说明里写清楚 |
| Enkeep 依赖 assistant 路由/常量 | 版本不匹配时面板失效 | 路由 404 → 隐藏面板并 warn；前缀/预设双条件；配置开关可关 |
| 冷会话缺少 `projectionValues.agentPreset` | 活动区过滤漏掉某些 worker | 以 `da-worker-` 前缀为主标记；预设为辅；测试重启后的冷会话 |
| 过滤掉用户想看的 worker 会话 | 用户找不到任务会话 | 当前会话/置顶例外；面板“打开”入口；关闭开关可回退 |
| 轮询增加负载 | 多面板/后台标签页耗电 | 仅展开时轮询；2.5s；单飞；页面隐藏暂停；历史视图不自动轮询 |
| 面板过高挤占对话 | 输入框被推远 | `max-height: min(46vh, 420px)` + 内部滚动；收起态仅一行 |
| 旧任务无归属规则误判 | 旧任务出现在错误会话 | 只在 `dsh-assistant-main` 显示无归属任务；其他会话不显示；注释标明临时兼容 |
| 路由泄露任务描述 | 同源页面可读 | 自定义头挡跨域；GET 只读；不返回 worker 内部提示/凭据；限制 limit/offset |
| 任务描述/报告过长 | 响应体过大 | 列表最多 50 条；报告/待决问题截断 200 字；完整内容在会话里 |
| 原生侧边栏仍有任务工作区 | 用户预期“主界面只剩助手”未完全满足 | 明确列为非目标；另立方案（改 DSH Web 或改 worker 会话模型） |

### 4.3 未解决/不在本方案

1. **原生侧边栏的任务工作区**：仍会显示。可选路线：
   - 改 `dsh-client-ui-workspace` 的可见性规则（需要 DSH Web 源码/上游改动，当前只有安装产物）。
   - 把 worker 改成 `origin: 'subagent'` 的子会话（原生侧边栏和 Enkeep 都会自动隐藏）。但 `dsh-assistant` 现在用 `sessionController.create` 创建独立会话，不是 subagent spawn；迁移会改变生命周期、工具隔离、结果投递和目录模型，属于大改，暂不推荐。
   - 自动归档终态 worker 会话（能减少侧边栏条目，但会让用户难以回看任务过程，且需要处理运行中拒绝归档；不推荐默认开启）。
2. **任务面板里的写操作**（取消/回答）：本方案不做，仍由助手对话调用 `assistant_cancel` / `assistant_answer`。
3. **QQ 来源任务**：QQ 端到端派活尚未接通，本方案只按 `sourceSessionId` 归属；将来接通后同样适用。

---

## 5. 实施步骤

> 每一步都给出“完成什么 / 用什么技术 / 验收什么 / 什么标准算成功”。
> 步骤 1–3 是数据侧，4–7 是 UI/配置侧；可以并行开发，但**最终验收必须两边都通过**。

### 步骤 1：修复任务归属与执行上下文

**完成什么**

- 在 `dsh-assistant` 的 `toolHost` 上补 `sessionInfoFor(agent)`，转发到 `host.sessionInfoFor(agent)`。
- 确认 `assistant_dispatch` 拿到的 `sessionInfo` 包含 `sessionId` 和 `cwd`。
- 确认 `engine.dispatch()` 持久化 `sourceSessionId`。
- 不改变工具参数、不改变任务状态机。

**用什么技术**

- Cordis 插件 Host 侧普通对象接线；现有 `Engine.dispatch()` / `makeAuthorize()`。
- 不需要新依赖。

**验收什么**

- 在助理主会话派发一个任务，检查 `tasks.jsonl` 最新记录包含 `sourceSessionId`，值等于当前会话 id。
- 在另一个 main-preset 会话派发任务，`sourceSessionId` 等于该会话 id，不是固定的 `dsh-assistant-main`。
- 任务结果仍然回到派发会话；worker 会话仍正常创建/执行/上报。
- `allowedWorkspaces` 为空时行为不变；非空时，允许目录可派活、不允许目录被拒并返回中文原因。

**什么标准算成功**

- 连续 3 次派发、跨 2 个不同 main-preset 会话，`sourceSessionId` 全部正确。
- 重启后旧任务仍可读，新任务归属不丢。
- 白名单场景的允许/拒绝结果符合配置，且没有误伤原有允许目录。

**注意**

- 这一步会同时让 `allowedWorkspaces` 从“事实上的放行”变成“真正生效”。这是修复，不是回归；但必须在变更说明里写明。

---

### 步骤 2：Engine 增加按会话查询

**完成什么**

- 新增 `Engine.listForSession(sessionId, { limit, offset, legacySessionId })`：
  - 过滤 `sourceSessionId === sessionId`
  - 旧任务兼容：`!sourceSessionId && sessionId === legacySessionId`
  - 按 `updatedAt` 倒序，`createdAt` 兜底，`id` 保证稳定
  - 返回 `{ total, limit, offset, tasks }`
  - 不修改任务、不持久化、不触发事件
- 把现有 `_view()` 暴露成公开 `view(task)`（或新增同名方法），供路由复用；`status()` 输出保持不变。

**用什么技术**

- 纯 JS，内存 `Map` 遍历；`node:test` 单元测试。
- 不新增依赖。

**验收什么**

- 单元测试覆盖：
  1. 会话 A 的任务只出现在 A，B 查不到。
  2. 分页：`limit/offset` 正确，`total` 是过滤后的总数。
  3. 排序：`updatedAt` 新的在前；相同时间稳定。
  4. 旧任务兼容：无 `sourceSessionId` 只在 canonical 会话出现。
  5. 空结果返回 `total: 0, tasks: []`，不报错。
  6. `status()` 的原有字段/顺序不变。
- `node --test tests/*.test.cjs` 全部通过。

**什么标准算成功**

- 新增测试全绿，旧测试不回归。
- 查询 0 次副作用：调用前后 `tasks.jsonl` 字节数不变。

---

### 步骤 3：dsh-assistant 只读 HTTP 路由

**完成什么**

- 通过 `ctx.inject(['webServer'], ...)` 软注册 `GET /dsh-assistant-tasks`。
- 校验方法、请求头、`sessionId`、`limit`、`offset`。
- 调用 `engine.listForSession()`，补 `worker_session_id`、`status_label`、`report_summary`、`human_action`。
- 统一 JSON 错误：400/403/404/405/500。
- 插件卸载时注销路由；没有 `webServer` 的 profile 不 PENDING、不报错。

**用什么技术**

- `ctx.inject(['webServer'])` + `ctx.effect` + `webServer.register({ kind: 'prefix', path: '/dsh-assistant-tasks', handler })`。
- `node:http` 的 `IncomingMessage` / `ServerResponse`；`URL` 解析查询参数。
- 与 Enkeep 现有 `/dsh-enkeep-words` 相同的自定义请求头模型。

**验收什么**

- 带 `x-dsh-assistant-tasks: 1` 的 GET 返回 200 和过滤后的 JSON。
- 不带请求头返回 403；POST 返回 405；缺 `sessionId` 返回 400；非法 `limit/offset` 返回 400；未知子路径返回 404。
- `limit` 超过 50 返回 400（明确拒绝，不做静默收敛）。
- 插件停止后路由 404；重启后恢复。
- 非 web profile 启动无 PENDING、无未处理异常。
- 响应中不包含 `mandate`、worker 内部提示、凭据、`sourceSessionId` 等内部字段。

**什么标准算成功**

- 路由契约测试（可用 `curl`/Node `fetch`）全部通过。
- 响应大小有界：50 条任务、报告截断后不超过约 100KB。
- 路由只读：多次调用后 `tasks.jsonl` 不变。

---

### 步骤 4：活动区过滤 + 配置/设置页

**完成什么**

- `selectActivity()` 增加 assistant worker 过滤，带当前/置顶例外。
- `ActivityBar` 订阅 `hideAssistantTaskSessions`，即时重算。
- `Config` 增加三个字段并全部 `.volatile()`。
- 设置页新增“任务面板”tab，包含显示开关、N、活动区过滤开关。
- 更新 `cordis.patch.yml` 默认值；更新 Host 的 volatile 诊断日志。

**用什么技术**

- `useSessions` 的 `projectionValues.agentPreset` + 会话 id 前缀双条件。
- 现有 `form.subscribe` / `set` 模式；现有 `ekeep-set-*` 设置页样式。
- Schemastery `Schema.number().step(1).min(1).max(30)` / `Schema.boolean()`。

**验收什么**

- 活动区不再出现 `任务 da-task-...` 的 worker 会话。
- 主助理会话、用户正常会话、运行中/未读会话仍正常显示。
- 置顶一个 worker 会话 → 它重新出现；取消置顶 → 消失。
- 从面板打开一个 worker 会话 → 它在当前会话期间可见；离开后消失。
- 关闭“活动区隐藏后台任务会话” → 恢复旧行为。
- 设置页改动即时生效，刷新页面后保持；不需要重启插件。
- 冷启动（重启 DSH Web）后过滤仍生效。

**什么标准算成功**

- 活动区截图对比：过滤前有 N 个任务行，过滤后只剩助手/正常会话。
- 置顶、当前、归档、切换开关四个边界都符合预期。
- 没有新增定时器；活动区原有 60 秒重算逻辑不变。

---

### 步骤 5：任务面板组件

**完成什么**

- 在 `conversation.input.dock` 注册 `TaskPanel`，`order: 150`。
- 收起态：图标 + “任务” + 总数 + 运行中指示 + 展开按钮。
- 展开态：最多 N 行；状态点、描述、状态标签、相对时间、待决问题、打开按钮。
- 只读；不做取消/回答。
- 空态/加载/错误/路由缺失处理。
- 仅助理主会话、非空白会话显示；worker/普通会话不渲染。
- 样式用独立 `<style>` 标签 + `data-enkeep-task-*` 属性，幂等安装、卸载清理。

**用什么技术**

- React 函数组件 + hooks（`useState/useEffect/useRef/useCallback`）。
- `ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(...))`。
- `useSessions` 窄选择器读 `agentPreset` / `blank`。
- `uiWorkspace.openSession()` 打开 worker 会话。
- CSS 对齐 `--dsh-composer-card-max-width`，最大高度 + 内部滚动。

**验收什么**

- 助理会话出现收起条；默认收起；点击展开显示最近 N 条。
- 任务按最近更新排序；运行中/等待决定的状态明显。
- “打开”能进入对应 worker 会话；排队任务禁用；打开失败有内联提示。
- 普通会话、worker 会话、空白会话不出现面板。
- 面板不与“最后一条用户提示”条/git chip 重叠；展开后输入框仍可见、可操作。
- 键盘可展开/收起；`aria-expanded` 正确。
- 关闭 `showTaskPanel` → 面板完全移除，无残留 DOM/样式。
- 刷新页面/HMR 后不重复注册、不重复注入样式。

**什么标准算成功**

- 用户不打开活动区也能在助手对话里看到任务并打开任务会话。
- 不存在两个入口同时显示同一任务状态的情况（活动区已过滤）。
- 面板不遮挡输入框，长列表内部滚动。

---

### 步骤 6：历史视图、实时刷新与性能

**完成什么**

- `total > N` 时显示“查看全部 N 个”，切换到历史视图。
- 历史视图分页 50 条、筛选、加载更多、刷新。
- 最近视图展开时 2.5 秒轮询；收起/隐藏/卸载时停止并 abort。
- 收起态在 hover/窗口 focus/页面 visible 时刷新一次。
- 请求序号 + 单飞，避免旧响应覆盖和并发请求。
- 历史视图不自动轮询，只手动刷新。

**用什么技术**

- `fetch` + `AbortController` + `setInterval` + `visibilitychange`。
- `URLSearchParams` 生成查询；`res.ok` / `res.status` 分支。
- React 状态合并：加载时保留旧数据，错误时保留旧数据 + 错误条。

**验收什么**

- DevTools Network：
  - 收起后 10 秒内没有新的 `/dsh-assistant-tasks` 请求（hover/focus 除外）。
  - 展开后约每 2.5 秒一次；切到后台标签页后暂停；切回立即刷新。
  - 收起后不再有请求；快速展开/收起不产生重叠请求。
- 运行中任务状态在 3 秒内反映到面板。
- 历史视图显示超过 N 条；加载更多不重复、不丢行；筛选正确。
- 任务从运行中变为完成/失败时，最近视图自动更新；历史视图手动刷新后更新。

**什么标准算成功**

- 收起态零轮询（初始快照/焦点/hover 除外）。
- 展开态状态延迟不超过一个轮询周期。
- 无控制台未捕获异常、无内存泄漏（卸载后定时器/监听器清理）。

---

### 步骤 7：配置热更新、折叠记忆、文档与回归

**完成什么**

- `taskPanelLimit` 1–30 默认 10；`showTaskPanel` 默认 true；`hideAssistantTaskSessions` 默认 true。
- 设置页读写三个字段；非法值 clamp 到默认/边界。
- 折叠状态按会话写入 `dsh.enkeep.taskpanel.open.v1`，默认收起，最多 100 个键。
- 更新 `docs/ASSISTANT-TASK-PANEL-PLAN.md`（本文）、`README`/`cordis.patch.yml` 的必要说明。
- 回归清单：活动区、面板、路由、配置、冷启动、旧任务、白名单。

**用什么技术**

- 现有 `configForms` + `.volatile()` + `form.subscribe`。
- `localStorage` JSON map + try/catch + 上限裁剪。
- `node --check` 静态检查；`node --test` 数据侧测试；浏览器手工验收。

**验收什么**

- 设置页把 N 从 10 改为 5：面板立即只显示 5 条（展开态），刷新页面后仍为 5；不重启插件。
- 把 N 改为 30：最多显示 30 条；超过 30 时“查看全部”仍可用。
- 关闭“显示任务面板”：面板消失；重新打开：恢复。
- 会话 A 展开、切到 B（收起）、切回 A：A 仍展开；B 保持收起；新会话默认收起。
- 刷新浏览器：配置值保留（Host 配置），展开状态保留（localStorage）。
- 清空 localStorage：全部回到默认收起，不报错。
- 旧任务（无 `sourceSessionId`）只在 canonical 主会话显示；新任务按会话正确隔离。
- 冷启动后：活动区过滤、面板、路由均正常；旧任务仍可见（canonical）。

**什么标准算成功**

- 所有配置改动无需重启；状态行为与 3.9 一致。
- 回归清单全部通过；没有任务数据被迁移/删除。
- 回退开关有效：`showTaskPanel=false` + `hideAssistantTaskSessions=false` 即回到旧行为（面板不显示、活动区恢复）。

---

## 6. 需求覆盖对照

| 用户关注点 | 方案位置 | 验收步骤 |
|---|---|---|
| 1) 任务归属/来源标记，只显示该助手会话自动创建的任务 | 3.3；修 `toolHost`；`sourceSessionId`；旧任务 canonical 兼容 | 步骤 1、2、3、7 |
| 2) 超过 N 个有“查看全部/历史”入口 | 3.5；历史视图分页/筛选 | 步骤 6 |
| 3) 与活动区的关系，避免两处重复显示 | 3.7；`selectActivity` 过滤 worker；面板唯一任务入口 | 步骤 4、5 |
| 4) 实时性：展开快照/刷新，收起不订阅省性能 | 3.6；展开 2.5s 轮询，收起零轮询，可见性暂停 | 步骤 6 |
| 5) 配置下发：N 放哪、热更新还是重启 | 3.8；Enkeep `Config.taskPanelLimit`（volatile）+ 设置页 | 步骤 4、7 |
| 6) 折叠状态是否记忆 | 3.9；按会话 localStorage，默认收起 | 步骤 7 |

---

## 7. 验证清单

### 7.1 静态检查

- `node --check C:\dev\dsh-enkeep\client.js`
- `node --check C:\dev\dsh-enkeep\index.js`
- `node --check C:\dev\dsh-assistant\index.js`
- `node --check C:\dev\dsh-assistant\src\engine.js`
- 数据侧测试：在 profile 的 node_modules 副本里跑 `node --test tests/*.test.cjs`（README 说明需要该副本解析 `@deepseek-ai/schemastery`）。

### 7.2 运行时验证

1. 用独立端口启动完整 bundle patch，确认 `dsh-enkeep` / `dsh-assistant` 均为 ACTIVE，无 PENDING。
2. 打开 `dsh-assistant-main` 会话，确认面板默认收起。
3. 派发 3 个任务，确认 `tasks.jsonl` 新记录包含 `sourceSessionId`。
4. 展开面板：看到最近任务；运行中状态在 3 秒内变化。
5. 点击“打开”：进入对应 `da-worker-*` 会话；返回主会话后面板仍在。
6. 检查活动区：无 worker 会话；主会话仍可见；置顶/当前例外符合预期。
7. 在另一个 main-preset 会话派发任务：该会话面板只显示自己的任务；主会话不显示它。
8. 刷新页面、重启 Web：配置、折叠状态、过滤、旧任务兼容均正常。
9. 关闭两个开关：面板消失、活动区恢复旧行为；重新打开恢复。
10. 白名单场景：空名单允许；非空名单只允许指定 cwd，拒绝有中文原因。

### 7.3 浏览器验收点

- 面板不遮挡输入框；展开后输入框仍可聚焦、可发送。
- 收起/展开无布局跳动异常；长任务描述正确省略，hover 有全文。
- 待决任务显示“需要你决定”提示。
- 历史视图可滚动、可加载更多、可返回最近。
- 键盘 Tab/Enter 可操作；焦点可见。
- 控制台无未捕获异常、无重复注册警告。

---

## 8. 回滚与运维

- **只关面板**：设置页关闭“显示任务面板”，或配置 `showTaskPanel: false`。路由保留但不再被调用。
- **恢复活动区旧行为**：设置页关闭“活动区隐藏后台任务会话”，或配置 `hideAssistantTaskSessions: false`。
- **完全回滚**：撤销 Enkeep 的 slot 注册/过滤/配置字段，撤销 dsh-assistant 路由；任务数据不需要迁移。
- **归属字段修复不回滚**：`sourceSessionId` 是结果投递正确性的基础修复，建议保留；若必须回滚，需同时接受结果回到主会话的旧行为。
- **旧任务兼容**：路由的 canonical 兼容规则是只读的，不写文件；将来确认无旧任务后可删除该分支。

---

## 9. 待确认的产品决策

1. **原生侧边栏是否也要隐藏任务工作区？**
   - 若“是”，需要另立方案：改 DSH Web 的会话可见性，或把 worker 改成 subagent。本文不覆盖。
   - 若“否”，本文方案即可解决活动区重复显示。
2. **当前/置顶 worker 会话是否保留在活动区？**
   - 推荐保留（否则用户从面板打开任务后无法在活动区识别当前会话）。
3. **历史视图是否需要自动刷新？**
   - 推荐不自动刷新，手动“刷新”；最近视图自动轮询。
4. **面板是否只在 canonical `dsh-assistant-main` 显示，还是所有 main-preset 会话都显示？**
   - 推荐所有 main-preset 会话，但按 `sourceSessionId` 精确隔离；这样用户自建助理会话也能用。
5. **旧任务（无归属）是否只在 canonical 主会话显示？**
   - 推荐是；避免同一旧任务在多个会话重复出现。

---

## 附录 A：关键代码位置

### dsh-assistant

- `C:\dev\dsh-assistant\index.js`
  - `mainTools(toolHost, agent)`：约 108 行
  - `host.sessionInfoFor()`：约 114–117 行
  - `toolHost`：约 120–143 行（缺 `sessionInfoFor`）
  - `dispatch` 写入 `sourceSessionId`：约 126 行
  - worker 会话创建：约 214–218 行
- `C:\dev\dsh-assistant\src\tools.js`
  - `assistant_dispatch` 读取 `host.sessionInfoFor`：约 26–27 行
- `C:\dev\dsh-assistant\src\engine.js`
  - `dispatch()`：约 57 行
  - `sourceSessionId` 持久化：约 66 行
  - `status()`：约 82 行
  - `_view()`：约 91 行
- `C:\dev\dsh-assistant\src\authorize.js`
  - `allowedWorkspaces` 从 `sessionInfo.cwd` 取值：约 28–44 行
- `C:\dev\dsh-assistant\src\sessions.js`
  - `ensureAgent()` 每个 cwd 建 workspace：约 104–108 行
  - worker id / preset 常量：约 45–56 行
- `C:\dev\dsh-assistant\src\labels.js`
  - `STATUS_LABELS` / `statusLabel()`：约 3–20 行

### dsh-enkeep

- `C:\dev\dsh-enkeep\client.js`
  - `MAX_ITEMS`：约 679 行
  - `selectActivity()`：约 692–736 行
  - 活动区 slot 注册：约 2531–2549 行
  - `conversation.input.dock` 现有 last-prompt 注册：约 2553–2557 行
  - 设置 tab 定义：约 2265–2270 行
  - 活动区设置页：约 2307–2319 行
  - 设置页 `set()` / `choice()` 模式：约 2285–2294 行
- `C:\dev\dsh-enkeep\index.js`
  - `Config`：约 29–39 行
  - `/dsh-enkeep-words` 路由模式：约 284–302 行
- `C:\dev\dsh-enkeep\cordis.patch.yml`
  - 当前配置默认值：1–9 行
- `C:\dev\dsh-enkeep\docs\ACTIVITY-BAR-PLAN.md`
  - 活动区现有设计说明

### DSH Web（只读核查，不修改）

- `...\@deepseek-ai\dsh-client-ui-conversation\lib\types\client\contract\slots.d.ts`
  - `conversation.input.dock`：约 294–299 行，`scope: 'session'`
  - `conversation.composer.dock`：约 305–309 行
  - `conversation.session.header.actions`：约 310 行附近
- `...\@deepseek-ai\dsh-api-session-controller\lib\types\list.js`
  - Host 列表包含 projections：约 93–105、147–160 行
- `...\@deepseek-ai\dsh-api-session-controller\lib\types\client\sessions\manager.js`
  - `buildListSnapshot()` 合并 `projectionValues`：约 695–711 行
- `...\@deepseek-ai\dsh-client-ui-workspace\lib\client.js`
  - `sessionVisible()` 只排除 subagent/空白：约 964 行附近

### 运行数据

- `C:\Users\mason\.dsh\dsh-assistant\tasks.jsonl`
  - 核查时 7 个任务、17 条记录，全部无 `sourceSessionId`
- `C:\Users\mason\.dsh\dsh-assistant\work\`
  - 每个任务一个隔离执行目录
- `C:\Users\mason\.dsh\sessions\`
  - worker 会话按任务 cwd 分目录持久化

---

## 附录 B：设计取舍摘要

| 方案 | 结论 | 原因 |
|---|---|---|
| 面板放 Enkeep，数据走 assistant 路由 | **采用** | 复用现有 slot/configForms/设置页；数据权威留在 assistant；升级风险低 |
| 面板放 dsh-assistant（新建 Client half） | 不采用 | 需要新建 client bundle、设置页、CSS、slot 体系；重复且风险高 |
| 只用 `assistant_status` 工具，不做 UI | 不采用 | 不满足“一眼看到最近任务”的交互目标 |
| 改 DSH Web 原生侧边栏 | 本方案不做 | 只有安装产物；需要源码/上游改动；另立方案 |
| 把 worker 改成 subagent | 暂不采用 | 会改变会话生命周期、工具隔离、结果投递和目录模型，属于大改 |
| 自动归档终态 worker | 不采用 | 用户难以回看任务过程；运行中归档被拒；语义副作用大 |
| SSE/WebSocket 实时推送 | 暂不采用 | 2.5s 轮询已匹配引擎节奏；SSE 需 Host 推流/连接管理，收益不足 |
| 收起态轮询保持计数 | 不采用 | 违背“收起不订阅省性能”；改为展开/焦点/hover 时刷新 |

---

## 附录 C：给实施者的检查清单

- [ ] `toolHost` 已补 `sessionInfoFor`，新任务行含 `sourceSessionId`。
- [ ] 旧任务兼容只读，未改写 `tasks.jsonl`。
- [ ] 路由有自定义头、方法/参数校验、limit 上限、卸载清理。
- [ ] 路由在无 `webServer` 的 profile 不导致 PENDING。
- [ ] `Engine.listForSession` 有单测；`status()` 输出未变。
- [ ] `selectActivity` 过滤有当前/置顶例外；归档优先级未变。
- [ ] 主助理会话不被误过滤。
- [ ] 面板只在 main-preset 会话显示；worker/普通/空白不显示。
- [ ] 收起零轮询；展开 2.5s；隐藏暂停；卸载清理。
- [ ] 历史视图分页/筛选/刷新可用；N 只约束最近视图。
- [ ] 三个配置字段 volatile；设置页即时生效；补丁默认值已更新。
- [ ] 折叠状态按会话记忆；默认收起；localStorage 异常不崩。
- [ ] 旧任务、冷启动、白名单、置顶/当前、开关回退全部回归。
- [ ] 文档和变更说明写明：原生侧边栏不在本方案范围；归属修复会让白名单真正生效。
