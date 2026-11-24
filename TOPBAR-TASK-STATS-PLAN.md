# 标题栏派生任务统计 chip —— 最终定稿方案（可直接进入开发）

> 文档性质：**最终定稿 / 单一事实源**。开发按本文件执行，不再讨论备选方案。
> 定稿时间：2026-11-24（事实基线为同日复核值）。
> 本轮授权：只更新本方案文档；不改功能代码、不提交。
> 本轮修订：2026-11-24 针对独立审核发现逐条修订（会话约束方案 A、轮询口径、隐藏条件、过滤口径、文案对齐、A5/A6/A11/A14 验收质量）；修订清单与自复核见 §9。
> 修复轮（2026-11-24）：针对全面审核发现再修一轮——新增 §10「实施验收结论（口径更正：mock 与真机边界）」，**撤回任何「A1–A15 全项通过」口径**，真机/HMR 项一律标「未验证、待真机」；代码侧修复 `index.js` 的 register 失败回滚、加固 `client.js` 窄栏 CSS 与 fetch `no-store`。未提交。
> 证据约定：凡标「事实」者均带 `文件:行号` 或实测数据；凡标「决定」者为用户已拍板结论，不再 reopen。
> 上游材料：`topbar-task-stats-plan` 的 `TOPBAR-TASK-STATS-PLAN.md`（调查草稿）与 `stats-endpoint-options` 的 `ENDPOINT-OPTIONS-REPORT.md`（接口归属评估）。本文件取代二者，作为唯一事实源；两份上游材料仅为来源记录，不得与本文件并列引用。

---

## 0. 定稿摘要（一页纸）

**一句话方案**：在会话标题栏 `conversation.session.header.actions` 新增一个 additive 计数 chip（order 25，排在 `job-list` 之后），只显示当前会话派生任务的「活跃 / 待决 / 近 24h 终态」计数 + 状态点；数据由 dsh-assistant 以软依赖自挂的只读 `GET /dsh-assistant-tasks/stats` 提供，enkeep 客户端同源 fetch + 单飞 + seqRef + 可见即 5s 轮询。

### 0.1 已拍板决定（逐条，无待定项）

| # | 决定项 | 最终结论 |
|---|---|---|
| 1 | 位置 | `conversation.session.header.actions` 新增 additive 条目，`order: 25`，排在 `job-list`(20) 之后。**只显示计数 chip**，不做输入框任务面板、不做面板明细列表（用户明确不要）。 |
| 2 | 统计口径 | **只统计本会话派生任务**：先判 `task.sourceSessionId` 存在（truthy）再做 `task.sourceSessionId === sessionId` 严格相等；**显式排除无 `sourceSessionId` 的任务（不 fail-open）**（决定 4a / `engine.js:304`）。显示「活跃 / 待决 / 近 24h 终态」计数 + 状态点。 |
| 3 | 接口归属 | **采用方案 A**：dsh-assistant 以软依赖 `ctx.get('webServer')` 自挂只读 `GET /dsh-assistant-tasks/stats`。数据链路：`tasks.jsonl` → `engine.tasks` Map → `sourceSessionId` 归属 + 状态集 + 近 24h → 路由 → enkeep 客户端 chip（同源 fetch + 单飞 + seqRef + 可见即 5s 轮询、隐藏即停）。**B / C 方案不采用**。 |
| 4a | legacy 任务（约 20 个无 `sourceSessionId`） | **直接排除**：无该字段的任务不论 `sessionId` 为何值（含 `undefined`）都不计入、不归主会话、不 fail-open，严格守住「只统计本会话」，避免串会话。 |
| 4b | 会话约束 | **采用方案 A：接受现状**。路由公开接收 `?sessionId=`；webServer 本身无鉴权（`dsh-host-webserver/lib/index.js:377-394` 的 `handle()` 直接把请求交给 `route.handler`，无身份/会话校验）；仅由客户端约定 chip 只传当前会话 `props.sessionId`。这是**软约束、非安全边界**——路由可被任意 `sessionId` 查询；因数据仅为任务计数（不敏感），**不做服务端鉴权、不从服务端会话上下文绑定 sessionId**。 |
| 4c | 0 任务隐藏 | **仅当「活跃 + 待决 + 近 24h 终态」三项计数全为 0 才 chip 隐藏**（不占标题栏位置、不灰显）；任一项非 0 都显示。 |

### 0.2 明确不做（反面清单，防止范围回潮）

- 不做输入框任务面板、不做面板明细列表、不做点击展开详情（决定 1）。
- 不采用 B（cordis 服务 + enkeep 代挂路由）、C（共享文件 / 客户端读文件）方案（决定 3）。
- 不注册 `conversation.session.header.lineage`（`kind:"single"`，已被 subagent 占用，二次注册启动失败）。
- 不修改官方 `dsh-client-ui-jobs` / `dsh-client-ui-subagent`，不改 worker 会话模型，不改 DSH Web 核心。
- 不把 legacy 任务归入 `dsh-assistant-main`、不沿用 `ownedBy` 的 fail-open 语义做统计（决定 4a）。
- 不新增服务端鉴权、不从服务端会话上下文绑定 sessionId（决定 4b 方案 A：接受软约束现状，路由可被任意 sessionId 查询）；不加显示开关配置（本定稿收敛：无配置开关）。
- 三项计数全为 0 才隐藏、不显示灰色「0」（决定 4c）。

### 0.3 成功标准（总览）

1. 在当前会话派发任务后，标题栏 `job-list` 之后出现计数 chip，数字与 `tasks.jsonl` 按本文口径统计一致。
2. 三项计数（活跃 / 待决 / 近 24h 终态）全为 0 的会话，chip 完全不渲染（DOM 中无节点）；仅有近 24h 终态计数的会话 chip 仍渲染。
3. chip 只传当前会话 `sessionId`（客户端约定）；20 个 legacy 任务不计入任何会话。路由不鉴权、可被任意 `sessionId` 查询（软约束，非安全边界），返回数据仅为不敏感计数。
4. 页面可见即计数自动刷新（≈5s，含空闲会话），页面隐藏立即停止轮询。
5. 路由只接受带自定义头的 GET（轻量约定 / 误用防护，非鉴权），响应体只有计数，不含任何明细 / 内部字段；webServer 缺席时 assistant 核心功能不受影响。
6. 全部验收项见第 4 节验收矩阵，逐项可复现、可检测。

---

## 1. 已核实事实基线（保留证据，供开发对照）

### 1.1 标题栏插槽位置

| 事实 | 证据 |
|---|---|
| `conversation.session.header.actions` 是 `kind:"list"`, `scope:"session"` 的插槽；`div.headerActions` 内 `renderSlot(...)` 渲染标题栏右侧那一行 | `dsh-client-ui-conversation/lib/client.js:19847-19858`、`:18031-18034` |
| `conversation.session.header.lineage` 是 `kind:"single"` 且被 subagent 占用，二次注册启动失败 | `C:\dev\dsh-enkeep\client.js:2594-2598`、`docs\UPGRADE-ADAPTATION.md:102,181` |
| enkeep 自己的 `enkeep-header-title` 走 additive `header.actions`（order 5、空渲染），只为拿 `useSessions/sessionId` | `C:\dev\dsh-enkeep\client.js:2599-2610`（已复核） |

现有注册项（按 order，开发时据此确认新 chip 排位）：

| id | order | 来源 | 视觉 |
|---|---|---|---|
| `agent-team` | -20 | `dsh-experimental-client-ui-agent-team/lib/client.js:491-497` | 团队入口 |
| `agent-preset` | -10 | `dsh-client-ui-agent-preset/lib/client.js:2407-2413` | 预设标签 |
| `enkeep-header-title` | 5 | `C:\dev\dsh-enkeep\client.js:2599-2610` | 空渲染 |
| `subagent-catalog` | 10 | `dsh-client-ui-subagent/lib/client.js:983-989` | “N 个子智能体” |
| `job-list` | 20 | `dsh-client-ui-jobs/lib/client.js:627-638` | “N 个后台任务” |
| **`enkeep-assistant-task-stats`（本次新增）** | **25** | 本方案 §3 步骤 3 | 计数 chip |

### 1.2 任务数据形态与归属隔离

| 事实 | 证据 |
|---|---|
| 状态目录 `STATE_DIR = (process.env.DSH_HOME \|\| ~/.dsh)/dsh-assistant`，`tasks.jsonl` 为 append-only 快照流，读时按 id 后写覆盖前写（压缩阈值 `COMPACT_EVERY=2000`） | `C:\dev\dsh-assistant\index.js:37`、`src/engine.js:95-121,169-194,43-44` |
| 内存 Map `this.tasks`；`dispatch()` 写入的字段含 `sourceSessionId`、`status`、`createdAt`、`updatedAt`、`execution` 等 | `src/engine.js:270-321,319`（已复核 `:270-299`） |
| **`dispatch()` 仅在 `sourceSessionId` 为真时才写入该字段，legacy 任务因此没有 `sourceSessionId`** | `src/engine.js:304`，原文 `...(sourceSessionId ? { sourceSessionId } : {})`（已复核） |
| 状态枚举：`ACTIVE_STATUSES = {queued,running,waiting_human,waiting}`；`ENDED_STATUSES = {done,failed,stopped,dropped}` | `src/statuses.js:7-10`（已复核） |
| `ownedBy(task, sessionId)`：**无 sessionId 或无 `task.sourceSessionId` 时返回 true（fail-open）** | `src/engine.js:27-35`（已复核） |
| `sourceSessionId` 修复**已落地**：`toolHost` 补 `sessionInfoFor`，派发写 `sourceSessionId: sessionInfo && sessionInfo.sessionId` | `C:\dev\dsh-assistant\index.js:276-293`（已复核 `:278-292`） |
| 旧方案文档 `ASSISTANT-TASK-PANEL-PLAN.md:92-110` 称“7 个任务全部没有 sourceSessionId” —— **该结论已过时**，不得再引用 | 本文件复核 `index.js:276-293` |

**实测统计（2026-11-24 开发前复核 `C:\Users\mason\.dsh\dsh-assistant\tasks.jsonl`，以 Node 按 id 后写覆盖前写）**：473 行、102 个不同任务；状态分布 `done 82 / stopped 16 / running 2 / waiting_human 1 / failed 1`；`82/102` 带 `sourceSessionId`（`dsh-assistant-main 61 / session-424b24d2… 20 / session-5034a4fa… 1`），**20 个 legacy 无归属**。数值会随运行增长，验收时按同法重新统计，不要硬编码本组数字。

> **关键差异（必须写进实现）**：`ownedBy` 的 fail-open 是为「内部调用 / 旧工具」设计的（`engine.js:27-30` 注释），**不是**为会话级统计设计的。本方案按决定 4a **不使用 `ownedBy` 做统计归属过滤**，而是在聚合函数里**先判 `task.sourceSessionId` 存在（truthy），再做 `task.sourceSessionId === sessionId` 严格相等**；无该字段的任务一律不计入；否则 20 个 legacy 任务会出现在每一个会话 chip 里（串会话）。**特别注意**：派发只在 `sourceSessionId` 为真时写该字段（`engine.js:304`），legacy 任务因此没有该字段；若只写 `task.sourceSessionId === sessionId`，当 `sessionId === undefined` 时 `undefined === undefined` 会把 20 个 legacy 计为「本会话」（fail-open），必须显式排除。以上为**事实**（`engine.js:304`、`engine.js:31-35`、`index.js:292`），由此推出的过滤写法为**决定 4a 的落地要求**。

### 1.3 接口与取数现状

| 事实 | 证据 |
|---|---|
| dsh-assistant 顶层 inject 只有 11 个内置服务，**没有 webServer**；全仓无 HTTP 路由、无 fetch、无只读接口 | `C:\dev\dsh-assistant\index.js:31-35`（已复核）；全仓 grep `webServer\|registerHttp\|ctx.server\|\.route\(` 仅无关命中 |
| 顶层 inject 缺席服务会使 fiber 进入 `FIBER_PENDING` 并报 `missing` → **webServer 必须走软依赖** | DSH checkout `dsh-app-boot/lib/index.js:4383-4390` |
| 软依赖范式：`ctx.get('dshIm')` + undefined 检查 + `ctx.on('internal/status', ...)` 重探，**不进顶层 inject** | `C:\dev\dsh-assistant\src\qq.js:1-23`（已复核 `:1-23`） |
| webServer 服务 `register({kind,path,handler})`：`kind==='exact'` 进 exact 表、否则进 prefix 表；重复 `(kind,path)` 抛错；返回 disposer；**服务本身不做鉴权**（`handle()` 直接把请求交给 `route.handler`，无身份 / 会话校验） | DSH checkout `dsh-host-webserver/lib/index.js:320-333`、`:377-394`（已复核） |
| enkeep 已有可复用的 Host 路由范式：能力探测 + 自定义头 403 + 只读 + `ctx.effect` 清理 | `C:\dev\dsh-enkeep\index.js:27,65-66,288-305,459-477`（已复核 `:20-27,65-66,284-306`） |
| enkeep 客户端用同源相对路径 fetch + 自定义头取 Host 数据（词库/技能，生产在用） | `C:\dev\dsh-enkeep\client.js:1490-1492,1737,1843,1853`（已复核 `:1490-1492,1737`） |
| 客户端 bundle 只有 `require('react'/'react-dom')`，**没有 `node:fs`/`process`** → 客户端不能直接读文件 | `C:\dev\dsh-enkeep\client.js:23,28` |
| `assistant_status` 工具的 sessionId 由服务端工具上下文提供（`sessionIdOf()`），与 HTTP 路由的客户端传参不同；HTTP 路由无服务端会话上下文绑定 | `C:\dev\dsh-assistant\src\tools.js:74-81` |

---

## 2. 最终方案（已拍板，不再讨论）

### 2.1 完整数据链路（决定 3 落地）

```
① 数据源  $DSH_HOME/dsh-assistant/tasks.jsonl（append-only，index.js:37）
               ↓ 载入内存 Map this.tasks（engine.js:95-121,319）
② 聚合    新纯函数 src/task-stats.js（不改状态机）：
               · 归属过滤：先判 task.sourceSessionId 存在（truthy），再
                 task.sourceSessionId === sessionId 严格相等；无该字段一律不计入
                 （不 fail-open、不用 ownedBy；engine.js:304、engine.js:31-35）
               · 活跃 active = status ∈ ACTIVE_STATUSES
               · 待决 waiting = status === 'waiting_human'（单列，最需用户注意）
               · 近24h终态 ended24h = status ∈ ENDED_STATUSES && updatedAt ≥ now - 24h
               · hasStats = active>0 || waiting>0 || ended24h>0
                 （供决定 4c：三项全为 0 才隐藏）
            → 只返回 3 个数字（active/waiting/ended24h）+ 1 个布尔（hasStats）
               ↓
③ Host 路由  dsh-assistant index.js：ctx.get('webServer') 软探测
               （不进顶层 inject；ctx.on('internal/status') 重探，仿 qq.js）
            → ctx.effect 内 register({
                kind:'exact', path:'/dsh-assistant-tasks/stats',
                handler: GET + 自定义头校验 + 读 ?sessionId= → JSON(计数)
              })；路由公开收 sessionId、无鉴权、无服务端会话绑定（方案 A 软约束）
            → webServer 缺席：不注册 + 一条日志；disposer 随 effect 清理
               ↓ 同源 HTTP（无 CORS）
④ 客户端   C:\dev\dsh-enkeep\client.js，header.actions 条目
            id='enkeep-assistant-task-stats', order=25
            fetch('/dsh-assistant-tasks/stats?sessionId=<当前会话>', {headers:{'x-dsh-assistant-stats':'1'}})
            AbortController + inFlightRef 单飞 + seqRef 防旧响应覆盖
            首次挂载取一次；页面可见即 5s 轮询（不要求有活跃任务，空闲会话新任务也能刷新）；visibilitychange 隐藏即停
               ↓
⑤ 渲染     文案「派生任务 活跃N · 待决K · 近24h终态M」+ 状态点
            （N←active / K←waiting / M←ended24h，见 §2.3 对照表）
            hasStats === false（三项全为 0）才 return null（决定 4c：隐藏，不灰显）；
            任一项非 0 都渲染
```

### 2.2 决定 1：位置与渲染边界

- 在 `conversation.session.header.actions` 以 additive list 方式注册，`id: 'enkeep-assistant-task-stats'`, `order: 25`，位于 `job-list`(20) 之后；与 `agent-team / agent-preset / enkeep-header-title / subagent-catalog / job-list` 共存，绝不注册 lineage。
- **chip 只有计数 + 状态点**，无点击展开、无明细列表、无输入框面板；不做 `conversation.input.dock` 面板（用户明确不要）。
- 复用 `HeaderTitle` 同样的 `props.sessionId` / `props.useSessions` 取当前会话 id（`client.js:2608-2609`），不自造会话状态。
- 样式前缀 `data-enkeep-taskstats-*`，独立 `<style>`，幂等安装/卸载清理；不写 `--dsh-*` 只读变量；窄窗口下按 A14 的可测判据验证不换行、不挤压 crumbs。

### 2.3 决定 2：统计口径

| 指标（接口字段） | 精确定义 | 依据 |
|---|---|---|
| 活跃 `active` | `status ∈ {queued, running, waiting_human, waiting}` | `src/statuses.js:8` |
| 待决 `waiting` | `status === 'waiting_human'`（单列，与活跃内该状态同时出现，属预期） | `src/statuses.js:8-10` |
| 近24h终态 `ended24h` | `status ∈ {done, failed, stopped, dropped}` 且 `updatedAt ≥ Date.now() - 24*3600*1000` | `src/statuses.js:10` |
| 归属 | **先判 `task.sourceSessionId` 存在（truthy），再** `task.sourceSessionId === sessionId` 严格相等；无该字段（legacy，`engine.js:304`）一律不计入，**不 fail-open** | 决定 2 + 决定 4a；`engine.js:304`、`engine.js:31-35` |
| 是否显示 `hasStats` | `active>0 \|\| waiting>0 \|\| ended24h>0`（三项全为 0 才隐藏） | 决定 4c |
| 状态点 | `active > 0` 时显示（仿 `job-list` 有运行中显示绿色 StateDot 的语言，`dsh-client-ui-jobs/lib/client.js:469-472`）；**chip 整体隐藏只看三项全为 0**（见 `hasStats`），无活跃但有待决或近 24h 终态时 chip 仍显示、只是无状态点 | 决定 2 + 4c |

**字段 ↔ 文案对照（唯一口径，消除歧义）**：

| 展示文案片段 | 取自接口字段 | 含义 |
|---|---|---|
| `活跃N` | `active` | 活跃（排队 / 运行 / 等待）任务数 |
| `待决K` | `waiting` | `waiting_human` 待人决定任务数 |
| `近24h终态M` | `ended24h` | 近 24h 终态（完成 / 失败 / 停止 / 放弃）任务数 |

展示文案固定为 `派生任务 活跃N · 待决K · 近24h终态M`（「派生任务」为静态前缀标签，不对应数字）。旧文案「派生任务 N · 运行 M · 待决 K」作废，不得再引用。

### 2.4 决定 3：接口归属（方案 A 定稿）

- **采用**：dsh-assistant 自挂只读 `GET /dsh-assistant-tasks/stats`，以 `ctx.get('webServer')` 软依赖方式接入（仿 `qq.js`），`ctx.effect` 内注册 exact 路由并返回 disposer。
- **不采用**：B（cordis 服务 + enkeep 代挂路由，跨插件服务名契约 + 双仓库改动）、C（共享文件 / 客户端读文件，客户端无 fs 且格式耦合）。二者不再作为备选保留。
- **数据链路**：严格按 §2.1 五段执行，不增不减。
- **客户端取数**：同源相对路径 `fetch` + 自定义头 `x-dsh-assistant-stats: 1`；`AbortController` 取消 + `inFlightRef` 单飞 + `seqRef` 防旧响应覆盖；首次挂载取一次；**页面可见即 5s 轮询（不要求有活跃任务，空闲会话新任务到来也能刷新）**，`visibilitychange` 隐藏即停；不做 SSE/WebSocket（引擎 2s pump，轮询不会更滞后，SSE 需 Host 推流与连接管理，收益不足）。
- **会话约束与安全边界（方案 A）**：**接受现状**——路由公开接收 `?sessionId=`，webServer 服务本身不做鉴权（`dsh-host-webserver/lib/index.js:377-394` 的 `handle()` 直接调用 `route.handler`，无身份 / 会话校验），**仅由客户端约定 chip 只传当前会话 `props.sessionId`**。这是**软约束、非安全边界**：路由可被任意 `sessionId` 查询。因数据仅为任务计数（不敏感），**不做服务端鉴权、不从服务端会话上下文绑定 sessionId**。自定义头 `x-dsh-assistant-stats: 1` + 仅 GET 只是轻量约定 / 误用防护，**不构成鉴权**。响应体**只含 `{active, waiting, ended24h, hasStats}`**，绝不调用 / 返回 `engine.status()` 的 `_view()`（含 `description`、`directory`、`report`、`model`，`engine.js:342-356`），也不返回 `mandate` / 凭据。

### 2.5 决定 4 的三项细节（定稿）

1. **legacy 直接排除**：聚合函数必须先判 `task.sourceSessionId` 存在（truthy）再做 `task.sourceSessionId === sessionId` 严格相等；无该字段的 legacy 任务（`engine.js:304`）不论 `sessionId` 为何值（含 `sessionId === undefined`）都不计入（不 fail-open），也不归 `dsh-assistant-main`。若需要全局总量，另行单列「未归属 N」并标注历史遗留 —— 本 chip 不做。
2. **客户端只传当前会话（方案 A 软约束）**：chip 的 `sessionId` 只来自插槽 `props.sessionId`（当前会话），不得由配置 / 命令 / UI 指定目标会话——这是**客户端约定，不是服务端强制**。路由公开接收 `?sessionId=`，**不鉴权、不绑定服务端会话上下文，可被任意 sessionId 查询**（见 §2.4 / 决定 4b）。因返回体只有不敏感计数，接受该软约束现状；不再声称「不提供 / 不暴露任意会话查询口子」。
3. **三项全 0 才隐藏**：`hasStats === false`（即 `active===0 && waiting===0 && ended24h===0`）时组件 `return null`，不占标题栏位置；任一项非 0 都显示；不做灰显 0。近 24h 终态计数单独满足显示条件，不再因「无活跃任务」而隐藏。

### 2.6 为什么不再保留备选（定稿取舍记录）

| 曾被提出 | 定稿处理 | 原因 |
|---|---|---|
| 输入框上方任务面板 / 面板明细 | 不采用 | 用户明确不要；chip 只做计数摘要 |
| B / C 方案 | 不采用 | 决定 3 已拍板 A |
| legacy 归 canonical / fail-open | 不采用 | 决定 4a：严格「只统计本会话」 |
| 服务端鉴权 / 会话上下文绑定 | 不做 | 决定 4b 方案 A：接受软约束现状（路由可被任意 sessionId 查询），数据仅计数不敏感 |
| 0 灰显 | 不采用 | 决定 4c：三项全 0 直接隐藏，不灰显 |
| 配置开关 `showTaskStats` | 不新增 | 决定收敛：用三项计数自适应即可；`C:\dev\dsh-enkeep\client.js` 不改配置表单 |
| SSE/版本号轮询优化 | 不采用 | 实时性上限不变、收益不足；维持**可见即 5s 轮询**（不要求有活跃任务）定稿 |
| 改官方 jobs/subagent 插件 | 不采用 | 只有 npm 安装产物，改上游升级即丢，且状态机不同 |

---

## 3. 开发步骤（可直接进入开发）

> 每步统一写清：**完成什么 / 用什么技术 / 验收什么 / 什么标准算成功**；验收项编号对应第 4 节矩阵。

### 步骤 1 — assistant 侧聚合纯函数

- **完成什么**：新增 `C:\dev\dsh-assistant\src\task-stats.js`，导出纯函数 `computeTaskStats(tasksIterable, sessionId, nowMs = Date.now())`，返回 `{ active, waiting, ended24h, hasStats }`。归属判定：`!!sessionId && !!task.sourceSessionId && task.sourceSessionId === sessionId`（无 `sourceSessionId` 或 `sessionId` 为空一律不计入，不 fail-open；`engine.js:304`）。`hasStats = active>0 || waiting>0 || ended24h>0`。
- **用什么技术**：复用 `src/statuses.js` 的 `ACTIVE_STATUSES` / `ENDED_STATUSES`（`statuses.js:8-10`）；`now - 24h` 用 `updatedAt` 的 `Date.parse` 比较；**不 import `ownedBy` 做过滤**（决定 4a）；不改 `engine.js` 状态机。
- **验什么**：矩阵 A3 / A4 / A5 / A5a / A5b / A5c / A6 / A7。
- **成功标准**：给定构造的任务集合，输出数字与 §2.3 定义逐项相等；20 个 legacy 任务在任何 `sessionId`（含 `undefined`）下都不改变输出；`sessionId=undefined` 与空任务集合均返回三项全 0；函数对同一输入稳定、无副作用。

### 步骤 2 — assistant 侧软依赖 + 只读路由

- **完成什么**：在 `C:\dev\dsh-assistant\index.js` 的 `apply` 内，仿 `qq.js` 用 `ctx.get('webServer')` 软探测并 `ctx.on('internal/status', ...)` 重探；探测到则在 `ctx.effect` 内 `register({kind:'exact', path:'/dsh-assistant-tasks/stats', handler})` 并返回 disposer；**不把 webServer 加进顶层 `inject: [...]`**（`index.js:31-35`）。
- **用什么技术**：handler 校验 `req.method === 'GET'` 且 `req.headers['x-dsh-assistant-stats'] === '1'`，否则 403/405（轻量约定，非鉴权）；从 `url.searchParams.get('sessionId')` 取参，`new URL(req.url, 'http://dsh')`；读 `engine.tasks`（`engine.js:319`）调用步骤 1 的函数；只回计数 JSON + `content-type: application/json; charset=utf-8`。仿 `C:\dev\dsh-enkeep\index.js:288-305` 的能力探测与降级日志。
- **验什么**：矩阵 A10 / A11 / A13。
- **成功标准**：带正确头与 GET 返回 200 且响应体**仅含** `{active, waiting, ended24h, hasStats}`；无头 / 错方法非 200；路由公开收 `?sessionId=`、无鉴权、无服务端会话绑定（方案 A）；webServer 缺席时 assistant 不进入 `FIBER_PENDING`/`missing`、无路由注册、只留一条日志；重复注册按 webServer 语义抛错（开发中应避免），卸载时 disposer 生效。

### 步骤 3 — enkeep 客户端 chip 注册与渲染

- **完成什么**：在 `C:\dev\dsh-enkeep\client.js` 新增 header.actions 条目 `id: 'enkeep-assistant-task-stats'`, `order: 25`，组件渲染固定文案 `派生任务 活跃N · 待决K · 近24h终态M`（N←`active`、K←`waiting`、M←`ended24h`，见 §2.3 对照表；文案仿 `job-list` 的 `{count} 个后台任务`，`dsh-client-ui-jobs/lib/client.js:526-529`）+ 状态点；`hasStats === false`（三项全 0）时 `return null`。
- **用什么技术**：复用 `ctx.slots.inject('conversation.session.header.actions', ...)` + `ctx.slots.register(...)` 范式（`client.js:2602-2610`）；`h()` 渲染；样式前缀 `data-enkeep-taskstats-*`，`installTaskStatsStyle()` 在 `ctx.effect` 内幂等安装并返回清理函数。
- **验什么**：矩阵 A1 / A2 / A8 / A9 / A14。
- **成功标准**：标题栏 `div.headerActions` 内、`job-list` 之后出现 chip；无明细 / 展开 / 输入框；三项全 0 的会话 DOM 无该节点（仅近 24h 终态的会话仍显示）；`active>0` 时状态点存在；中文窄窗口按 A14 的可测判据验证；热更新无重复注册。

### 步骤 4 — 客户端取数、单飞、seqRef、轮询

- **完成什么**：实现同源 fetch store：挂载取一次；`visibilitychange` **可见即每 5s 取一次（不要求 `active>0`，空闲会话新任务也能刷新）**，隐藏即 `clearInterval` 并 `abort()`；请求携带 `x-dsh-assistant-stats: 1`；隐藏即停、单飞、seqRef 三项保持不变。
- **用什么技术**：模块级 `inFlightRef`（单飞）、`seqRef`（序列号，旧响应丢弃）、`AbortController`（卸载 / 隐藏取消）；`sessionId` 只取插槽 `props.sessionId`（决定 4b 客户端约定）。
- **验什么**：矩阵 A7 / A12 / A15。
- **成功标准**：网络面板可见时（含 `active=0` 的空闲会话）≈5s 一次请求；隐藏后请求停止、恢复可见立即刷新；人为慢响应不产生并发请求；旧响应晚到不覆盖新值；fetch 失败 / 404 时 chip 优雅隐藏且不刷错误日志。

### 步骤 5 — 端到端联调与全量验收

- **完成什么**：按第 4 节矩阵逐项执行并记录结果；复核 `tasks.jsonl` 当前统计值（方法见 §1.2），用真实会话派发 / 取消任务观察 chip 变化。
- **用什么技术**：浏览器 DevTools（Elements / Network / Console）、`tasks.jsonl` 复核脚本（§1.2 的 Node 统计法）、对照会话隔离测试。
- **验什么**：A1–A15（含新增边界项 A5a / A5b / A5c）全项。
- **成功标准**：所有验收项通过；本文件第 0.3 节 6 条成功标准全部满足；未改动任何功能代码之外的文件、未提交。

---

## 4. 验收矩阵（可复现、可检测）

| 编号 | 场景 | 操作 | 期望 | 检测手段 | 通过标准 |
|---|---|---|---|---|---|
| A1 | 位置与排位 | 启动 Web，查看标题栏右侧 | chip 在 `div.headerActions` 内、`job-list` 之后 | DevTools Elements 查 `[data-enkeep-taskstats]`；grep `client.js` 的 `order: 25` 与 `ctx.slots.inject('conversation.session.header.actions'` | 节点存在且排位正确；lineage 注册 0 处 |
| A2 | 无面板/明细 | 点击/查看 chip 的 DOM | 无展开容器、无列表项、无输入框 | DevTools Elements 结构检查 | chip 只含文本 + 状态点，0 处明细/面板节点 |
| A3 | 活跃口径 | 构造 `queued/running/waiting_human/waiting` 各 1 的任务 | `active = 4` | 直接调 `computeTaskStats` 或 curl 路由比对 | 数值严格相等 |
| A4 | 待决单列 | 上述集合中 `waiting_human = 1` | `waiting = 1` | 同上 | 数值严格相等 |
| A5 | 近24h终态 | 造 `done` 两条：`updatedAt = now-1h` 与 `now-48h` | `ended24h = 1` | 同上 | 仅近 24h 计入，边界值 ≥ now-24h |
| A5a | 边界：sessionId=undefined | `computeTaskStats(tasks, undefined)`，tasks 含 A3 的 4 条带归属任务 + 20 条 legacy | `active=0, waiting=0, ended24h=0, hasStats=false` | 直接调函数比对 | 三项严格为 0；若任一非 0，说明 `undefined === undefined` 把 legacy 计为本会话（fail-open），不通过 |
| A5b | 边界：legacy-only | tasks 仅 20 条无 `sourceSessionId` 任务，`sessionId='dsh-assistant-main'` | 三项全 0，`hasStats=false` | 同上 | 20 个 legacy 不计入任何会话 |
| A5c | 边界：0 任务 | `computeTaskStats([], '任意会话')` | 三项全 0，`hasStats=false` | 同上 | 空集合返回全 0、无异常 |
| A6 | legacy 排除（含预期差值） | 构造任务集 = 4 条 `sourceSessionId='dsh-assistant-main'` 的活跃任务（同 A3，含 1 条 `waiting_human`）+ 20 条 `status='running'` 且**无** `sourceSessionId` 的 legacy；以 `sessionId='dsh-assistant-main'` 分别跑严格过滤与 `ownedBy` 对照聚合 | 严格：`active=4, waiting=1, ended24h=0`；`ownedBy` fail-open 对照：`active=24, waiting=1, ended24h=0`；**active 差值恰为 20（= legacy 数）** | 直接调函数 + 对照 `ownedBy` 聚合；断言 `strict.active===4 && owned.active===24 && owned.active-strict.active===20` | 严格计数与 A3–A5 一致；差值恰为 20；差值≠20 或严格计数含 legacy 即不通过 |
| A7 | 当前会话隔离 / 客户端约定 | 两个会话各派 1 任务，分别查看 chip | 各会话只见自己 1 条；客户端 fetch 的 `sessionId` 仅来自插槽 prop；路由不鉴权、可被任意 `sessionId` 查询（方案 A） | 两会话并列比对 + grep client 中 fetch 参数 + curl 任意 sessionId 验证路由可查 | 互不串数据；客户端无配置 / 命令指定目标会话；路由按方案 A 不鉴权即为符合预期 |
| A8 | 三项全 0 隐藏 | 在三项计数（活跃 / 待决 / 近 24h 终态）全为 0 的会话查看 | chip 不渲染、不占位；仅有近 24h 终态计数的会话 chip 仍渲染 | DevTools Elements 查 `[data-enkeep-taskstats]` | 三项全 0 时节点 0 个；近 24h 终态 >0 时节点存在；非灰色 0 |
| A9 | 状态点 / 隐藏口径 | 分别查看：仅 `active>0`；`active=0` 但 `ended24h>0` | 前者状态点存在；后者 chip 显示但无状态点；chip 隐藏只看三项全为 0 | DevTools Elements / 截图 | 状态点当且仅当 `active>0`；「无活跃即隐藏」不再成立（由 A8 反例验证） |
| A10 | 安全（非鉴权） | 无自定义头请求、POST 请求、检查响应体 | 头 / 方法不符 → 403/405（轻量约定）；200 响应仅含 `{active, waiting, ended24h, hasStats}` | curl / DevTools Network | 响应体无 `description`/`directory`/`report`/`mandate`/凭据；路由不鉴权、可被任意 sessionId 查询（方案 A，非缺陷） |
| A11 | webServer 软依赖降级与 `internal/status` 重探 | **按 §4.1 的完整可执行流程**：在已含 assistant 的 `web` profile 上用用户 patch 禁用 `webserver` 行（`dsh-web-app/cordis.patch.yml:179`，name `@deepseek-ai/dsh-host-webserver`）并以独立端口启动（无 Web 服务）；查 boot marker / 日志；再用 HMR 在**同一进程**切换 `webserver` 启用状态触发 `internal/status` 重探，curl 探测路由 | 不被 park、无 `missing`、无路由、一条降级日志；HMR 启用 webServer 后经 `internal/status` 重新注册路由，curl 200 | 启动日志 grep `FIBER_PENDING\|missing\|\[dsh-assistant\]`；curl 探测；HMR 前后对比路由注册日志 | 无 `FIBER_PENDING`/`missing`；每次缺席降级日志恰一条；全程同进程、无整进程重启；路由随 webServer 启用/禁用正确注册/注销（详见 §4.1） |
| A12 | 轮询 / 单飞 / seqRef | 页面可见但 `active=0`（空闲会话）观察请求；再造一个任务观察刷新；再隐藏；注入慢响应 | **可见即 ≈5s 轮询（含空闲会话，新任务到来能刷新）**；隐藏即停；恢复即刷；无并发；旧响应不覆盖新值 | DevTools Network 时序 + 人为延迟 | 请求间隔 ≈5s（空闲会话亦有）、隐藏后 0 请求、单飞与 seqRef 行为成立 |
| A13 | 幂等与清理 | 热更新 / 卸载相关条目与路由 | 无重复注册、无 duplicate 报错、disposer 被调用 | Console 报错检查 + 注册计数 | 0 报错；重复注册 / 卸载可复原 |
| A14 | 窄窗口布局（可证伪） | 中文 locale，把视口宽设为 360px（DevTools 设备工具栏），打开含派生任务的会话 | chip 文本单行不换行；crumbs 完整可见且不被 chip 覆盖；`div.headerActions` 不横向溢出 | DevTools 执行 `const el=document.querySelector('[data-enkeep-taskstats]'); const r=el.getBoundingClientRect();` 取 chip 高度；在 Elements 选中实际 crumbs 节点后用 `$0.getBoundingClientRect()` 取宽度与矩形；截图存档 | chip 高度 ≤ 同行相邻项单行高度（如 ≤24px，证明未换行）；crumbs 宽 >0 且与 chip 矩形不相交（未被挤压 / 覆盖）；`div.headerActions.scrollWidth <= clientWidth`；任一不满足即不通过（不再用自证式「视觉检查通过」） |
| A15 | assistant 不可用降级 | 禁用 / 卸载 assistant 后查看 chip | fetch 失败 / 404 → chip 隐藏、不刷错误 | Console + Elements | 无未处理异常；节点隐藏 |

### 4.1 A11 完整可执行流程（软依赖降级 + `internal/status` 同进程重探）

> 补强说明：README「开发与验证」只给「独立端口启动并载入 bundle patch」，**没有排除 webServer 的方法**；且整进程重启无法覆盖 `ctx.on('internal/status')` 重探分支。下面给出一条可真正验证重探路径的流程，全程**不重启进程**。

**前置**：备份当前 `$DSH_HOME/cordis.patch.yml`（home 级用户 patch，优先级高于 profile 级；按 id 整体替换条目配置，不做深合并）。用 `dsh --dump-config` 可确认目标条目的启用/禁用状态。

**阶段 1 — 无 webServer 启动、降级**
1. 在 `$DSH_HOME/cordis.patch.yml` 写入一条禁用项（webServer 的 carrier 行 id 为 `webserver`，来自 `@deepseek-ai/dsh-web-app/cordis.patch.yml:179`，name `@deepseek-ai/dsh-host-webserver`，它提供 `webServer` 服务，`dsh-host-webserver/lib/index.js:286`）：
   ```yaml
   - id: webserver
     disabled: true
   ```
   注意：必须在**已含 `dsh-assistant` 的 `web` profile**（`web/package.json:37`）上禁用 webserver；`headless` profile 只含 `dsh-base` + `dsh-headless`（`headless/package.json:7-10`），没有 assistant，直接用它测不到 assistant 的软依赖。
2. 独立端口启动并载入完整 bundle patch（README「开发与验证」方式）：`dsh --profile web --port <独立端口> --no-open`。命令行开关见 `dsh-web-app/lib/startup.js:25-33`（`--port` / `--no-open`）。
3. 观察 `$DSH_HOME/dsh-assistant/boot.json` 生成、`boot-error.json` 无错误；启动日志 grep：无 `FIBER_PENDING`、无 `missing`，恰一条 `[dsh-assistant] task stats route unavailable (webServer absent)`。
4. 探测：该进程无 Web 服务，`curl http://127.0.0.1:<独立端口>/dsh-assistant-tasks/stats?sessionId=dsh-assistant-main` 连接失败（无路由）。

**阶段 2 — 触发（关键：同进程 `internal/status`，非重启）**
5. 保持进程运行，编辑同一 patch，把该条改为 `disabled: false`（或删除该条目）。`dsh-hmr` 监视用户 patch 文件并调用 `recomposeProfile` 重新组合（app-boot README「用户 patch HMR」/「启动与重载失败」节），webServer fiber 在**同一进程**内挂载。若当前 profile 未启用 HMR，用 Config Editor 的 `reconcileProfilePatches()` 触发同样的程序化重载。
6. webServer fiber 状态变化触发 cordis 的 `internal/status`（`cordis/lib/index.js:1298`）；assistant 的软依赖监听 `ctx.on('internal/status', () => probe())`（仿 `src/qq.js:22`）重新 `ctx.get('webServer')`，注册 stats 路由。这正是整进程重启无法验证的重探路径。

**阶段 3 — 探测恢复正常模式**
7. HMR 完成后 curl 探测：
   ```
   curl -i -H 'x-dsh-assistant-stats: 1' "http://127.0.0.1:<独立端口>/dsh-assistant-tasks/stats?sessionId=dsh-assistant-main"
   ```
   期望 200，响应体仅 `{active, waiting, ended24h, hasStats}`；日志出现 `[dsh-assistant] task stats route registered at /dsh-assistant-tasks/stats` 一条，降级日志不再新增。
8. 反向可证伪：再次把 `webserver` 设为 `disabled: true` → HMR → webServer fiber 卸载 → `internal/status` 再次触发 → `ctx.effect` 的 disposer 注销路由 → curl 再次无路由；再恢复 `disabled: false` → 路由重新注册。全程进程 id 不变。

**阶段 4 — 恢复与清理**
9. 删除/清空临时写入的 patch 条目（恢复备份文件），确认正常 Web 模式（本 GUI：`pnpm run dev:web`，含 webServer）路由仍在；关闭独立端口进程。

**通过判据**：assistant 全程无 `FIBER_PENDING`/`missing`；每次 webServer 缺席恰一条降级日志；至少「无→有」「有→无→有」两次切换均经 `internal/status` 在同进程内完成，无任何整进程重启；路由随 webServer 启停正确注册/注销。

---

## 5. 文件清单（最终方案涉及的全部预期改动点）

| 文件 | 改动点 | 性质 |
|---|---|---|
| `C:\dev\dsh-enkeep\TOPBAR-TASK-STATS-PLAN.md`（本文件） | 定稿：并入全部拍板决定、删除备选/待定残留、补齐开发步骤与验收矩阵；本轮再按审核逐条修订（见 §9） | **本次唯一实际改动**（文档） |
| `C:\dev\dsh-assistant\src\task-stats.js` | **新增**：`computeTaskStats()` 纯函数（先判 sourceSessionId 存在再严格相等 + 显式排除 legacy + 活跃/待决/近24h终态 + hasStats 布尔），~20–30 行 | 新增代码 |
| `C:\dev\dsh-assistant\index.js` | `apply` 内加 `ctx.get('webServer')` 软探测 + `internal/status` 重探 + `ctx.effect` 注册 exact 路由 + disposer + 头/方法校验（非鉴权）+ 公开收 `?sessionId=`（方案 A，无服务端会话绑定）；**顶层 `inject` 不变**；~30–50 行 | 改动代码 |
| `C:\dev\dsh-enkeep\client.js` | 新增 header.actions 条目 `enkeep-assistant-task-stats`(order 25) + 组件（文案对齐 active/waiting/ended24h）+ 样式 + fetch store（单飞 / seqRef / 可见即 5s 轮询），~80–150 行 | 改动代码 |
| `C:\dev\dsh-enkeep\index.js` | **不改**（无新路由、无配置开关；enkeep 只做客户端 chip） | 无改动 |
| `C:\dev\dsh-enkeep\docs\ASSISTANT-TASK-PANEL-PLAN.md` 等其它文档 | **不改**（本文件为单一事实源；面板方案不在本次范围） | 无改动 |
| DSH Web 核心 / 官方 jobs、subagent 插件 / worker 会话模型 | **不改** | 无改动 |

> 说明：`C:\dev\dsh-assistant\src\engine.js` **不改**（聚合放新文件，状态机保持原样）；`ownedBy` 仅保留其原有内部 / 工具用途，不用于本统计。

---

## 6. 风险与约束（已定应对，非待拍板）

| 风险 | 已定应对 |
|---|---|
| 标题栏已有 5 项 + 新 chip 拥挤 | order 25 + 紧凑文案；中文窄窗口按 A14 可测判据实测；必要时只调 enkeep 自有变量（`--enkeep-*`），不碰 `--dsh-*` |
| 常驻轮询耗电 | 仅以「页面可见」为条件 5s 轮询（**不要求 `active>0`**），隐藏即停（A12）；空闲会话新任务靠轮询刷新；统计接口单响应 <1KB |
| 20 个 legacy 任务 | 决定 4a：显式排除（含 `sessionId=undefined`），不 fail-open、不归 main（A5a / A5b / A6） |
| 串会话 | 决定 2 + 4b：先判 sourceSessionId 存在再严格相等，只传当前会话（A7）；客户端为软约束，路由本身不鉴权（方案 A） |
| 近 24h 终态被「无活跃即隐藏」吞掉 | 决定 4c：三项全为 0 才隐藏，任一项非 0 都显示（A8 / A9） |
| 安全暴露 | 自定义头 + 仅 GET + 只返回计数（A10）为轻量约定 / 误用防护、**非鉴权**；方案 A 接受路由可被任意 sessionId 查询（数据仅计数不敏感）；绝不返回 `_view()` 明细 |
| webServer 缺席 / assistant 被禁用 | 软依赖降级 + chip 优雅隐藏（A11 / A15） |
| chip 无详情入口 | 用户明确不要面板 / 明细，作为已知取舍记录；不在本次范围回潮 |

---

## 7. 本次定稿改动清单（章节 + 改了什么）

| 章节 | 改动内容 |
|---|---|
| 文首元信息 | 由「调查 + 规划 + 评估草稿」改为「最终定稿 / 单一事实源」；声明取代两份上游材料、无待定项、本轮不改代码不提交；补记本轮审核修订说明 |
| §0 结论先行 → **定稿摘要** | 把原「仍待拍板」4 项改为「已拍板决定表（6 条）」；新增「明确不做反面清单」与「成功标准 6 条」 |
| §1 事实基线 | 保留 file:行号证据并逐条复核；`tasks.jsonl` 实测值按 2026-11-24 开发前复核刷新（473 行 / 102 任务 / 82 带归属 / 20 legacy / 状态分布）；新增「dispatch 仅在真值时写 sourceSessionId（engine.js:304）」事实与「关键差异：不用 ownedBy fail-open、undefined 必须显式排除」说明；webServer `register` 行号校正为 `dsh-host-webserver/lib/index.js:320-333`，并补 `:377-394` 无鉴权证据；标注旧文档 `ASSISTANT-TASK-PANEL-PLAN.md:92-110` 结论已过时 |
| §2 可行方案 → **最终方案** | 删除原 §2.2 备选方案 B–F 表、§2.1 中「0 灰显/隐藏待定」「可选增强（版本号）」等待定表述；只保留方案 A 定稿；新增 §2.1 五段数据链路、§2.2 位置与渲染边界、§2.3 统计口径表 + 字段↔文案对照、§2.4 接口归属（B/C 明确不采用）、§2.5 三项细节定稿、§2.6 取舍记录（含「不加配置开关」） |
| §3 影响面 → **开发步骤** | 由评估性文字改为 5 个可执行步骤，每步按「完成什么 / 用什么技术 / 验收什么 / 成功标准」写；明确聚合放新文件 `src/task-stats.js`、`engine.js` 不改、`enkeep/index.js` 不改、无配置开关 |
| §4 更简单的替代方案 | **删除**（已拍板不做面板/明细，不留备选残留） |
| §5 事实/推断分界 → **事实基线** | 表述改为「已核实事实基线」，推断内容全部升级为定稿决定或移入取舍记录 |
| §6 需要用户拍板的点 | **删除**，改为本文件 §0.1「已拍板决定（无待定项）」与 §2.6「取舍记录」 |
| 新增 §4 验收矩阵 | A1–A15 共 15 项 + 新增边界项 A5a/A5b/A5c，逐项写清操作/期望/检测手段/通过标准 |
| 新增 §5 文件清单 | 列明全部预期改动点，区分实际改动 / 改动代码 / 无改动 |
| 新增 §6 风险与约束 | 风险全部写明已定应对，不留「待评估」 |
| 新增 §9 本轮审核修订清单与自复核 | 逐条登记审核发现的处理方向与证据，给出自复核结论 |

---

## 8. 事实 / 决定 分界（定稿）

- **事实**：第 1 节全部条目（文件:行号 + 2026-11-24 复核数据）；`ownedBy` fail-open 语义（`engine.js:31-35`）；`dispatch()` 仅在 sourceSessionId 为真时写字段、legacy 无该字段（`engine.js:304`）；`sourceSessionId` 修复已落地（`index.js:276-293`）；无 HTTP 路由 / 无 webServer 注入 / 客户端无 fs；webServer `register` API 与 `handle()` 无鉴权（`dsh-host-webserver/lib/index.js:326-333,377-394`）；enkeep 现有路由与 fetch 范式。
- **已拍板决定**：§0.1 全部 6 条 + §2 各节 + §2.6 取舍；不再标注「建议/可选/待定」。
- **已过时、禁止再引用**：`ASSISTANT-TASK-PANEL-PLAN.md:92-110` 的「7 个任务全部没有 sourceSessionId」；任何「legacy 归 canonical / fail-open」「0 灰显」「B/C 方案」「面板明细」表述；**「无活跃任务即隐藏」「可见 && active>0 才轮询」「不提供 / 不暴露任意会话查询口子」「派生任务 N·运行 M·待决 K」旧文案**；上游两份材料中的「需拍板/建议/可选」措辞。本文件为唯一事实源。

---

## 9. 本轮审核修订清单与自复核（2026-11-24）

> 针对独立审核发现逐条修订；证据来自两仓真实源码核对（`C:\dev\dsh-enkeep`、`C:\dev\dsh-assistant`）与 DSH checkout 中 webServer 实现。每条区分「事实（源码 / 实测）」与「决定（用户拍板）」。

| # | 审核项 | 处理方向 | 修订章节 | 证据 / 依据 |
|---|---|---|---|---|
| 1 | 会话约束 | 采用方案 A：接受路由公开收 sessionId、webServer 无鉴权、仅客户端约定传当前会话；软约束、非安全边界、路由可被任意 sessionId 查询；数据仅计数不敏感，不做服务端鉴权 / 会话绑定 | §0.1(4b)、§0.2、§0.3(3,5)、§1.3、§2.1③、§2.4、§2.5(2)、§2.6、§4(A7,A10)、§6、§8 | 事实：`dsh-host-webserver/lib/index.js:326-333,377-394` 的 register/handle 无鉴权；`dsh-assistant/index.js:31-35` 无 webServer 注入。决定：用户拍板方案 A。已删除「不提供 / 不暴露任意会话查询口子」等表述 |
| 2 | 轮询口径 | 回到「可见即 5s 轮询」，去掉「可见 && active>0」收窄；隐藏即停、单飞、seqRef 保持 | §0.3(4)、§2.1④、§2.4、§3 步骤4、§4(A12)、§5、§6 | 决定：用户拍板；空闲会话新任务需靠轮询刷新 |
| 3 | 隐藏条件矛盾 | 统一为「活跃 + 待决 + 近 24h 终态三项全为 0 才隐藏」，任一项非 0 显示 | §0.1(4c)、§0.2、§0.3(2)、§2.1②⑤、§2.3、§2.5(3)、§3 步骤1/3、§4(A8,A9)、§6、§8 | 决定 4c；原 §2.3/A9「无活跃即隐藏」与 §2.1/§2.5/A8 相反，已统一 |
| 4 | 过滤口径 | 显式排除无 sourceSessionId 任务，不 fail-open；sessionId=undefined 也不计入；补边界测试 | §0.1(2,4a)、§1.2、§2.1②、§2.3、§2.5(1)、§3 步骤1、§4(A5a/A5b/A5c,A6)、§6 | 事实：`engine.js:304` 仅在真值时写字段；`engine.js:31-35` ownedBy fail-open；`index.js:292` 写 sourceSessionId。推断：`undefined === undefined` 会把 legacy 计为本会话 → 必须显式排除 |
| 5 | 文案对齐 | 文案固定为「派生任务 活跃N · 待决K · 近24h终态M」，N←active、K←waiting、M←ended24h；加对照表 | §2.1⑤、§2.3、§3 步骤3、§5、§8 | 接口字段来自步骤 1；旧「派生任务 N·运行 M·待决 K」作废 |
| 6 | A14 自证式 | 改为可证伪的可测判据（chip 高度 ≤ 单行高度、crumbs 宽>0 且无矩形相交、scrollWidth<=clientWidth） | §4(A14)、§3 步骤3、§6 | 验收质量：去「视觉检查通过」 |
| 7 | A5 未测边界 | 补 A5a(sessionId=undefined) / A5b(legacy-only) / A5c(0 任务) | §3 步骤1、§4(A5a/A5b/A5c) | 同第 4 条事实 |
| 8 | A6 无预期差值 | 给出具体数值与差值：严格 active=4 vs ownedBy=24，差值恰 20 | §4(A6) | 基于 A3 构造集 + 20 条 legacy running |
| 9 | A11 无启动方式（本次开发前补强） | 新增 §4.1 完整可执行流程：web profile 上用用户 patch 禁用 `webserver` 行起无 Web 服务进程、boot marker/日志、HMR 同进程切换触发 `internal/status` 重探、curl 探测、恢复清理；不再以整进程重启代替重探 | §4(A11)、§4.1 | `README.md:132-136`（独立端口启动载入 bundle patch）、`:125`（boot marker）；`dsh-web-app/cordis.patch.yml:179`（webserver 行 id）、`dsh-web-app/lib/startup.js:25-33`（`--port`/`--no-open`）；app-boot README「用户 patch HMR」/ `recomposeProfile`（patch 热重载）；`cordis/lib/index.js:1298`（`internal/status` 发射）；`src/qq.js:22`（软依赖重探范式） |
| 10 | 事实刷新 | tasks.jsonl 复核值按 2026-11-24 开发前实测刷新为 473 行 / 102 任务 / 82 带归属 / 20 legacy | §1.2、§7 | 实测（Node 按 id 后写覆盖前写，2026-11-24 开发前） |

**自复核结论**：

- 阻塞项 1–5 与验收质量项 6–9 已逐条处理；六项拍板（1 / 2 / 3 / 4a / 4b / 4c）仍准确且与全文一致。
- 方案口径与验收正文已无「无活跃即隐藏」「可见 && active>0」「不提供 / 不暴露任意会话查询口子」「派生任务 N·运行 M·待决 K」「hasOwnTasks」「视觉检查通过」等旧表述**作为现行规则**；这些字样仍能在本文件中检索到，但仅出现在 §2.6 取舍记录、§8 禁用清单、§9 修订说明，以及 §4 A9/A14 的反例/否定判据里（作用恰是声明其作废或禁止），不是遗留口径——「全文已无字面」的说法不精确，此处按「已无现行表述」表述；「7 条」已更正为「6 条」。
- 所有「事实」均带源码行号或实测数据；「决定」均为用户拍板，未自行新增待定项。
- 本轮只修改本文档；未改功能代码、未 `git add` / `commit` / `push`；工作区其它未提交改动未触碰。
- 注：上面这条记录的是 §9 所在的「定稿修订轮」。其后的实施轮与本次修复轮的真实状态（含 mock 与真机边界、代码改动）以 §10 为准；§4 验收矩阵始终只是**标准**，不是"已通过"的声明。

---

## 10. 实施验收结论（口径更正：mock 与真机边界）

> 本节为修复轮新增，**取代此前任何「A1–A15 全项通过」的口头/结论口径**。自本轮起不再宣称全项通过：mock / 静态检查只证明"函数行为与代码形态"，凡需真机 / HMR 才能观察到的项一律标为「未验证、待真机」。§4 的矩阵与 §4.1 的流程仍是验收**标准**（未改），本节只登记"当前实际证明到哪一步"。

### 10.1 mock / 静态检查能证明什么、不能证明什么

**能证明（已验证）**：

- **函数行为**：`src/task-stats.js` 的 `computeTaskStats` 可由单测直接驱动；A3 / A4 / A5 / A5a / A5b / A5c / A6 的 **8 个边界用例全 PASS**（严格归属、legacy 排除、`sessionId=undefined` 不 fail-open、只回 4 字段、严格 vs `ownedBy` 差值恰 20）。这是纯函数级证明，不是运行时证明。
- **代码形态**：`client.js` 的 `order: 25` / 插槽名 / 文案拼接 / 三项全 0 隐藏 / 单飞 / seqRef / 可见即 5s 轮询，与 `index.js` 的软依赖探测 / disposer / 头与方法校验 / 只回四字段，均可由 `grep` + 行号对照核实。这是"源码长这样"的证明。
- **静态与回归**：三文件 `node --check` 通过；现有 234 项测试全绿。这是语法与既有回归的证明。

**不能证明（不得据此标"通过"）**：

- mock 不启动真实 DSH 宿主、不产生真实 `webServer` fiber、不发真实 `internal/status`，**无法**证实 A11 的「同进程 HMR 重探、无 `FIBER_PENDING`/`missing`、路由随 fiber 启停注册/注销」——这正是 §4.1 要求的可证伪流程，整进程重启也不算。
- mock 没有真实 DOM / CSS 布局 / 浏览器网络栈 / 可见性切换，**无法**证实 A1 / A2 / A7 / A8 / A9 / A10 / A12 / A13 / A14 / A15 的运行时现象（节点位置与数量、矩形相交、`scrollWidth<=clientWidth`、请求时序、隐藏即停、卸载清理、404 降级）。
- mock 的 `fetch` / `register` 桩只说明"调用形状符合约定"，不等于真实 HTTP / 真实服务可用；不能据此推断真机会成功。

### 10.2 逐项当前状态

| 项 | 当前状态 | 依据 / 还差什么 |
|---|---|---|
| A3 / A4 / A5 / A5a / A5b / A5c / A6 | **已验证（纯函数）** | 8 个边界用例全 PASS；直接调 `computeTaskStats` 比对 |
| A1 / A2 / A7 / A8 / A9 / A10 / A12 / A13 / A15 | **未验证、待真机** | 源码形态已核对；DOM / Network / Console 现象须在浏览器刷新后按 §4「检测手段」实测 |
| A11 | **未验证、待真机（重点）** | 必须按 §4.1 在**同一进程**用 patch + HMR 触发 `internal/status`；mock 不能替代，整进程重启不算 |
| A14 | **未验证、待真机（重点）** | 代码侧已做窄栏收缩 / 省略加固（见 10.4），但 360px 下的高度 / 矩形相交 / `scrollWidth` 必须用**用户浏览器 DevTools** 实测 |

### 10.3 register 失败回滚修复（审核项 2）

- **修复前**：`index.js` 的 `probe()` 先 `have = can` 再 `ws.register(...)`；若 `register` 抛错，`have` 仍为 `true` 而 `current` 为 `null`。后续每次 `internal/status` 都命中 `can === have` 提前返回，**一次注册失败导致本进程永久不再重试**。
- **修复后**：`catch` 中 `have = null; current = null`（`null` = 未知）。下一次状态事件 probe 时 `true !== null`，重新进入注册分支。**行为差异**：从"路由永久缺失"变为"下一次状态事件即重试并自愈"（并伴随一条新的失败/成功日志）。
- **验证方式**：用 `vm` 从 `index.js` 抽取真实 `probe` 文本，注入 mock `ctx`（`webServer.register` 第 1 次抛错、第 2 次成功）与可手动触发的 `internal/status` 监听器；断言首次 probe 后 `warn` 一次、`have === null`；触发一次状态事件后 `register` 被调用 2 次、`current` 非空、`have === true`。反例对照：把新增的 `have = null` 去掉复跑，第 2 次 `register` 不再发生。脚本在隔离目录执行，不写入两仓。
  - 口径声明：这是**逻辑级 mock 验证**，只证明重试分支可达且不再被 `have` 卡死；真实 HMR 路径仍以 A11「未验证、待真机」为准。

### 10.4 其余加固与说明（审核项「应修」）

- **A14 窄栏（已修，仍待真机）**：chip 由 `flex:none;max-width:none` 改为 `flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden`；文本包进 `[data-enkeep-taskstats-label]` 并 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`。单行 24px 高度不变、超宽省略号 + `title` 全文兜底，降低 360px 下挤掉 crumbs / 横向溢出的风险。**仍需用户浏览器 DevTools 在 360px 实测**（交付待验证项）。
- **no-store（已修）**：`fetch` 增加 `cache: 'no-store'`（完全不读/写 HTTP 缓存，比 `no-cache` 更严格——后者仍会先向服务端校验再决定是否复用缓存），避免浏览器 HTTP 缓存冻结 5s 轮询计数。
- **webServer 引用刷新（说明，未修）**：`probe()` 每次都重新 `ctx.get('webServer')`；请求处理函数只读 `engine.tasks`，从不读 `current.webServer`，该字段仅与其 `dispose` 配对持有，故请求路径无陈旧引用风险。§4.1 的禁用→启用流程使 `can` 走 `false→true`，必然重注册并调用 disposer。仅"实例在同可用性下被热替换（未经历缺席）"这一窄场景布尔探测不会重挂路由，登记为已知边界；为不改动已确认正确的重探逻辑，本轮不改。
- **跨会话共享 store（说明，未修）**：`taskStatsSeq` / `taskStatsInFlight` 只是协调原语；每个 chip 的响应只写回自身闭包捕获的 `setStats` 与 `sessionId`，不会把 A 会话数据写进 B 会话 DOM，**不串数据**。两个 chip 同时挂载时共享 single-flight 会让后者当轮取不到数（短暂 HMR 重叠期内存在），但 header.actions 是会话级插槽、同一时刻只渲染一个 chip，卸载即 `abort`，判定可接受。
- 代码与文档改动均**未提交**；其它任务的既有未提交改动未触碰。

### 10.5 交付给用户的待验证项（真机）

1. **A11（§4.1 全流程，最高优先）**：在含 assistant 的 `web` profile 上按 §4.1 步骤 1–9，用用户 patch 禁用/启用 `webserver` 并**同进程 HMR**触发 `internal/status`，核对：`FIBER_PENDING`/`missing` 为 0、降级日志恰一条、curl 路由随启停注册/注销、进程 id 不变。
2. **A14（360px DevTools）**：中文 locale、视口 360px，打开含派生任务的会话，按 §4 的 `getBoundingClientRect` 判据测 chip 高度 ≤ 单行高度、crumbs 宽 > 0 且矩形不相交、`div.headerActions.scrollWidth <= clientWidth`，并截图存档。
3. **其余运行时项**：A1 / A2 / A7 / A8 / A9 / A10 / A12 / A13 / A15 按 §4 的「检测手段」在浏览器刷新后逐项确认（位置/无明细/会话隔离/隐藏/状态点/响应体/轮询时序/热更新清理/assistant 降级）。
4. register 失败重试：真机侧若能在 HMR 中注入一次 `register` 抛错，观察是否出现"失败日志→下一次状态事件→注册成功日志"的自愈序列（与 10.3 的 mock 结论交叉验证）。
