# dsh-enkeep 浮动活动区「上下分栏 + 当前对话外派面板」开发计划（最终定稿）

> 文档性质：**最终开发计划**。开发按本文件执行，不再讨论备选方案。
> 依据：用户拍板的最终方案；上次评估任务 `da-task-d8899bb8` 的结论（见 `C:\Users\mason\.dsh\dsh-assistant\tasks.jsonl` 中该任务的 `report.summary`，执行目录 `C:\Users\mason\.dsh\dsh-assistant\work\enkeep-activity-c721d2ed22e5`）。
> 边界：只规划 dsh-enkeep 活动区改造及配套只读数据桥；不改 worker 会话模型、不改 DSH 核心与官方插件。
> 说明：**本文件只写步骤与内容（功能 + 技术），不含时间、工期、排期。**

---

## 0. 一句话方案

把 `ActivityBar`（`client.js`，注册在 `shell.overlay` 的 `dsh-enkeep.activity-bar`）从现在顶部的「对话 / 外派任务」两 tab，改为**上下分栏**：上区直接呈现原 tab1 的对话列表（行为原样），下区只保留**一块**「当前对话的外派对话」面板；上区点击/选中对话驱动下区切换，跨对话切换时先清空再异步加载以防串数据；下区数据由 dsh-assistant 新增的**只读 sessions 接口（仅回 workerSessionId）**与 `useSessions` 交叉渲染得到。

## 1. 最终决定（逐条，无待定项）

| # | 决定项 | 落地口径 |
|---|---|---|
| 1 | 上区 | **现在的 tab1（对话列表）原样保留**：筛选、排序、截断、五态圆点、置顶、当前高亮、行操作、拖拽、隐藏侧栏、新建等全部不变；顶部「对话 / 外派任务」tab 外壳去掉（只剩一个列表，tab 无意义），上区即该列表本身。 |
| 2 | 下区 | **只保留「当前对话的外派对话」一块面板**。用户明确原话：「下面的 tab2（所有外派列表）就不要了，意义不大」。因此下区不再有双 tab 结构，**tab 外壳（role=tablist、两个 tab 按钮、activeTab 切换）整体去掉，直接做成下方面板**；文档与代码注释中都不再出现「下区 tab1/tab2」概念。 |
| 3 | 状态联动 | 点击上区某行 → `selectedId = 该会话 id`，下区切到该对话的外派；仅当该对话 `projectionValues.agentPreset === 'dsh-assistant-main'`（助手模式）才取数，否则下区纯空白。 |
| 4 | 防串数据 | 切换瞬间（点击处理函数内、同步）先把下区清空或置占位，再发异步请求；用请求序号（`seqRef`）+ `AbortController` 保证旧请求返回不得覆盖新选中对话的数据；`openSession` 异步滞后不影响下区已选。 |
| 5 | 呈现 | 上下两区**各自独立滚动**；助手模式但该对话无外派时显示空态「当前对话暂无外派」；下区有**独立收起/展开**（与上区 `collapsed` 互不干扰）。 |
| 6 | 数据来源 | 沿用评估结论：worker 归属只在外派任务的 `sourceSessionId`；新增只读 sessions 接口（**仅回 workerSessionId**），与 `useSessions` 交叉渲染按当前对话筛选；legacy（无 `sourceSessionId`）任务排除。 |

### 1.1 明确不做（反面清单，防止范围回潮）

- 不做下区双 tab、不做「所有外派列表」、不做任何 tab 外壳（上区顶部 tab 条也一并移除）。
- 不改 `selectActivity` 对 conversations 组的筛选/排序/截断语义（上区原样）。
- 不改 worker 会话创建/归属/回传链路，不改状态机，不新增服务端鉴权。
- 不改 DSH Web 核心与官方插件（`dsh-client-ui-*`、`dsh-client-ui-jobs`、`dsh-client-ui-subagent`）。
- 不写工期/排期；本文件只含步骤、功能、技术与验收。

### 1.2 两处「空白 / 空态」的口径（明确化，避免实现分歧）

- **非助手模式**（选中会话 `agentPreset !== 'dsh-assistant-main'`）：下区**纯空白**——不渲染条目、也不显示空态文案，不发起取数。
- **助手模式但该对话无外派**：保留下区面板骨架，列表区显示空态文案 **「当前对话暂无外派」**。
- 接口失败 / 接口缺席（dsh-assistant 未安装）：按「无外派」降级，同样显示上述空态，不影响上区。

---

## 2. 事实基线（代码锚点，开发对照用）

| 事实 | 证据 |
|---|---|
| 活动区是浮动条 `ActivityBar`，注册在 `shell.overlay`，新 id 不与官方 11 项冲突；槽位自动注入 `useSessions/useSessionStatus/useWorkspaces`，无需自行订阅 | `C:\dev\dsh-enkeep\client.js:1243`、`client.js:2732-2752`（`id:'dsh-enkeep.activity-bar'`, `order:100`）；`UPGRADE-ADAPTATION.md:60,84-86` |
| 当前顶层为两 tab：`activeTab` state + 两个 `role=tab` 按钮（对话/外派任务），计数取当前 tab 条数 | `client.js:1246`、`client.js:1532-1543` |
| `selectActivity` 从 `useSessions` 出 conversations/dispatch 两组；`current` 靠 `retainedBy.mainView` 引用数 > 0 内部算出但未返回；外派靠 `da-worker-` 前缀 / `agentPreset==='dsh-assistant-worker'` 识别 | `client.js:729-787`（`:735-740` current、`:723-728` 识别、`:783-787` 返回） |
| `ActivityBar` 的 `inject` 没有传 `sessionId` prop，只有 `useSessions` 等标准 hooks；助手模式判定须从 `useSessions` 行的 `projectionValues.agentPreset` 取 | `client.js:2736-2752`；`ASSISTANT-TASK-PANEL-PLAN.md:572,610` |
| `openSession` 为异步调用（点击行 → `uiWorkspace.openSession`），会滞后；评估已指出「openSession 异步致滞后」是串数据风险 | `client.js:2667-2673`；`da-task-d8899bb8` 报告 summary「边界」段 |
| worker 会话无父链接，归属只在任务的 `sourceSessionId`；现有 stats 接口只回计数、无会话映射 | `da-task-d8899bb8` 报告 summary「现状/评估」段；`TOPBAR-TASK-STATS-PLAN.md:70-84` |
| dsh-assistant 已有软挂载只读路由范式（stats）：`ctx.get('webServer')` 软依赖 + 自定义头 + 能力探测 + disposer；**不在顶层 inject**（顶层 inject 缺席服务会 PENDING） | `TOPBAR-TASK-STATS-PLAN.md:86-97,103-120`；`qq.js` 软依赖范式 `:92` |
| enkeep 自身 Host 路由范式：`ctx.webServer.register({kind:'prefix',...})` + 自定义头 + `ctx.effect` 清理 | `C:\dev\dsh-enkeep\index.js:288-305,459-476` |
| 客户端 fetch 范式：同源相对路径 + 自定义头 + `cache:'no-store'` + 单飞（`inFlight`）+ 序号守卫（`seqRef`）+ `AbortController`，页面隐藏停轮询 | `client.js:970-1037`（`AssistantTaskStats`）、`:939-941` 常量 |
| CSS 用幂等 `<style data-plugin-css="enkeep-activity">` 注入，disposer 移除；浮层根 `pointer-events:auto` | `client.js:85-86` `ACTIVITY_CSS`、`client.js:236-239` `installActivityStyle`、`client.js:96` |
| 活动区现有可回归行为：五态圆点、置顶/归档/重命名对话框、拖拽与位置记忆、隐藏侧栏、整条隐藏条件（两组皆空才 `return null`） | `client.js:1244-1295,1317-1358,1519,1584-1634`；`ACTIVITY-BAR-PLAN.md` |

---

## 3. 技术点落点总览（用户指定四点的归属）

| 技术点 | 落点步骤 | 具体位置 |
|---|---|---|
| **数据桥**（只读 sessions 接口 + `useSessions` 交叉渲染） | **步骤 1**（Host 接口契约）→ **步骤 3**（客户端交叉渲染） | 步骤 1 定义 `GET /dsh-assistant-tasks/sessions`（仅回 workerSessionId）；步骤 3 用 `useSessions((s)=>s)` 把 id 映射为列表行 |
| **状态联动**（`selectedId` / 助手模式判定 / derived current 校正） | **步骤 2** | `ActivityBar` 增 `selectedId` + ref；上区行 `onClick` 同步更新；`selectActivity` 多返回 `current` 用于校正 |
| **防串数据**（切换即清空/占位 + `seqRef` 守卫 + 二次校验 + abort） | **步骤 2**（同事件内清空）+ **步骤 4**（请求序号/中止/校验） | 步骤 2 保证「先清空」；步骤 4 保证「迟到旧响应不覆盖」 |
| **空态 / 收起 / 独立滚动** | **步骤 5** | 下区 head 独立收起按钮；上/下列表各自 `max-height + overflow-y:auto`；空态文案与 CSS |
| **去 tab 外壳 / 上区原样** | **步骤 6** | 删除 `activeTab` 与 tab 按钮；上区渲染 `groups.conversations`；下区渲染单面板 |

---

## 4. 开发步骤（每步写清：完成什么 / 验收什么 / 成功标准）

### 步骤 1 — 数据桥：dsh-assistant 侧「只读 sessions 接口」

**(a) 完成什么（功能 + 技术）**

- 在 dsh-assistant 新增一个**只读** HTTP 接口：`GET /dsh-assistant-tasks/sessions?sessionId=<当前会话 id>`，自定义头 `x-dsh-assistant-sessions: 1`（轻量约定/误用防护，非鉴权，与现有 stats 路由同口径）。
- 挂载方式沿用既有范式：**软依赖** `ctx.get('webServer')` + 能力探测 + `ctx.on('internal/status')` 重探 + `ctx.effect` 返回 disposer；**不进顶层 `inject`**（顶层 inject 缺席服务会 PENDING）。与现有 `/dsh-assistant-tasks/stats` 同插件、同前缀族，重复注册按 webServer 的 `(kind,path)` 唯一性约束规避。
- 取数：直接读内存 `engine.tasks`（由 `tasks.jsonl` 载入的 Map），**先判 `task.sourceSessionId` 为 truthy，再做 `task.sourceSessionId === sessionId` 严格相等**；无 `sourceSessionId` 的 legacy 任务一律排除；**不用 `ownedBy` 的 fail-open 语义**（`engine.js:27-35` 是为内部调用设计的，会把 legacy 漏进每个会话）。
- 返回体最小化：`{ ok: true, sessionId, workerSessionIds: ["da-worker-<taskId>", ...] }`。**只回 workerSessionId 字符串数组**（+ 必要元信息），不含任务明细、`sourceSessionId`、`mandate`、worker 提示或任何内部字段。同一 `sourceSessionId` 的多任务全部收集；去重、保持顺序。
- `workerSessionId` 以引擎落地 worker 会话时实际写入的会话 id 为准（现行约定 `da-worker-<taskId>`）；若需按约定拼装，须在实现处注明并与 `useSessions` 中实际 worker 会话 id 对齐（步骤 3 交叉渲染依赖此一致性）。
- 降级：webServer 缺席 / 路由错误 / 读文件失败 → 返回空数组与 `ok:false` 或 HTTP 错误；**不写任何文件、不改任务状态机、不影响 assistant 核心功能**。

**(b) 验收什么**

- 接口按自定义头可达；不带头按既有 403 口径拒绝；路径不存在返回 404。
- 过滤口径：`sourceSessionId` 严格相等、truthy 前置判断、legacy 排除；多任务会话返回全部 id；无任务会话返回空数组。
- 响应字段最小化：只有 workerSessionIds（及 ok/sessionId），无内部字段。
- 软依赖降级：webServer 不可用/插件缺席时 assistant 启动无 PENDING、无错误日志泛滥，客户端按空态处理。

**(c) 成功标准（可核对）**

1. 在同一会话派发 2 个任务后请求 `?sessionId=<该会话>`，返回 `workerSessionIds` 恰好 2 个、值与引擎实际创建的 worker 会话 id 逐字一致；与 `tasks.jsonl` 中 `sourceSessionId === 该会话` 的记录数一致。
2. 用 `?sessionId=` 传一个从无派发的会话，返回 `workerSessionIds: []`。
3. 取现行 legacy（无 `sourceSessionId`）任务所在会话查询，这些任务**全部不出现**；再以 `sessionId` 缺省/`undefined` 请求，也不得把 legacy 当作「本会话」返回（防 `undefined === undefined` 误命中）。
4. 抓取响应体全文，确认无 `description/scope/source/status/mandate/report/sourceSessionId` 等字段。
5. 停用 webServer / 卸载 assistant 后客户端请求失败，页面无未捕获异常，下区按空态渲染（步骤 5 验收）。

---

### 步骤 2 — 状态联动：选中态、助手模式判定与 derived current 校正

**(a) 完成什么（功能 + 技术）**

- `selectActivity` **多返回一个 `current`**（其内部已按 `retainedBy.mainView` 算出，见 `client.js:735-740`，当前未返回），与 `{ conversations, dispatch }` 同层返回；不改两组现有筛选/排序/截断。
- `ActivityBar` 新增：
  - `const [selectedId, setSelectedId] = useState(null)` 与 `selectedIdRef`（与 `pinnedRef` 同样的同步镜像手法，`client.js:1258-1263`），保证同一帧内多次点击读到最新值；
  - `const [lowerCleared, setLowerCleared] = useState(false)` 或等价占位标记（配合步骤 4 的清空函数）；
  - 下区取数前置守卫：`const selectedRow = useSessions((s)=> s && s.byId && s.byId[selectedId])`；`isAssistant = selectedRow?.projectionValues?.agentPreset === 'dsh-assistant-main'`（可选链，字段缺失安全降级为非助手模式）。
- 上区行 `onClick` 改为：`selectedIdRef.current = id; setSelectedId(id); clearLower(); openSession(id)`。**`clearLower()` 必须在同一事件处理函数内同步执行**（先清空/置占位，再调用步骤 4 的异步取数），这是防串数据的第一道闸。
- `openSession` 调用与行为保持不变；其异步完成**不写回任何下区状态**。
- derived current 校正：`selectActivity` 返回的 `current` 与 `selectedId` 不一致时（例如外部切换会话、`retainedBy` 变化），走与点击相同的「先清空 → 重设 selectedId → 重新取数」路径，**绝不沿用旧 selectedId 的下区数据**；初始化时 `selectedId` 为空则以 `current` 为准。

**(b) 验收什么**

- 点击上区任意行后 `selectedId` 立即更新，下区同帧清空（无旧条目残留）。
- 助手模式会话点击 → 触发取数；非助手模式会话点击 → 下区纯空白、不发起请求。
- 快速连点两行 → 只认最后一次；外部 current 变化 → 校正后数据对应新会话。
- 上区既有行为（当前高亮、圆点、行操作、拖拽）不受影响。

**(c) 成功标准（可核对）**

1. 点击 A 行的同一个事件内，下区 DOM 中来自上一个会话的条目数为 0（用 MutationObserver 或同步断言检测「点击 → 下一次渲染前」无旧条目）。
2. 点击一个 `agentPreset !== 'dsh-assistant-main'` 的会话（含普通会话/冷会话无 preset 字段），下区列表区 DOM 无条目、无空态文案、网络面板无 sessions 请求。
3. 连续快速点击 A→B→A，最终下区数据只对应最后点击的会话，未出现任何中间会话条目。
4. 通过切换官方当前会话使 `retainedBy.mainView` 变化后，下区数据与新 current 对应；上区「当前对话」高亮仍正确。
5. 点击行仍正常 `openSession`（目标会话被打开），且打开动作的异步完成不改写下区内容。

---

### 步骤 3 — 下区面板：workerSessionId 与 `useSessions` 交叉渲染

**(a) 完成什么（功能 + 技术）**

- 新增 module-scope 稳定的 `DispatchPanel` 组件（放 `client.js` 内，与 `ActivityBar` 同层），props 至少含：`selectedId`、`isAssistant`、`clearLower`（清空注册/通知）、`openSession`、`useSessions`。
- 用步骤 1 的接口取 `workerSessionIds`：同源相对路径 fetch + 自定义头 `x-dsh-assistant-sessions: 1` + `cache:'no-store'`；**沿用 `AssistantTaskStats` 的单飞 / seqRef / AbortController 三件套**（`client.js:970-1037`），封装成与选中态绑定的取数函数（守卫细节见步骤 4）。
- **交叉渲染**：`const sessions = useSessions((s)=>s)`；`workerSessionIds.map(id => byId[id])` 过滤掉未命中/归档/`blank`/`origin==='subagent'` 的行（与 `selectActivity` 的剔除口径一致）；按 `sessionLabel(row,id)` 取标题、按现有 `state` 判定逻辑取圆点；渲染为下区列表条目，使用**独立** `data-enkeep-dispatch-item` / `data-enkeep-dispatch-dot` 等属性（不与上区 `data-enkeep-activity-*` 混用，便于验收与样式隔离）。
- 下区条目点击仍走 `openSession(workerId)`；条目上不渲染置顶/归档/重命名等行操作（外派条目只读展示 + 打开）。
- 未命中 `useSessions` 的 workerSessionId（会话未加载/已归档）跳过，不显示占位；最终命中数为 0 时进入空态（步骤 5）。
- 面板标题固定为「当前对话的外派对话」，头部显示命中条数（如「2 条」）。

**(b) 验收什么**

- 有派发的助手会话：下区条目数、标题、圆点、顺序与 `workerSessionIds` + `useSessions` 交叉结果一致。
- 无派发的助手会话：0 条 + 空态；非助手模式：不取数、纯空白。
- 切换会话后条目不串；归档/未加载 worker 会话被跳过；点击条目可打开对应会话。
- 渲染属性独立，上区 DOM 结构不被污染。

**(c) 成功标准（可核对）**

1. 在会话 A 派发 2 个任务、会话 B 派发 1 个任务：点 A 下区恰好 2 条，点 B 恰好 1 条，标题与 `sessionLabel` 一致、圆点状态与 `useSessionStatus` 一致。
2. 点一个从无派发的助手会话：下区 0 条并显示「当前对话暂无外派」；接口返回空数组时同样为空态（不报错、不闪旧数据）。
3. 将某个 worker 会话归档后刷新：该条目不出现在下区（交叉渲染按 `useSessions` 可见集合）。
4. 点击下区条目，`openSession` 收到的是该 workerSessionId，并在网络/日志中可核对。
5. DOM 查询 `data-enkeep-dispatch-item` 只存在于下区容器内；上区 `data-enkeep-activity-item` 数量与改造前 tab1 一致。

---

### 步骤 4 — 防串数据：清空 + 序号守卫 + 中止 + 二次校验

**(a) 完成什么（功能 + 技术）**

- 封装 `useDispatchSessions(selectedId, isAssistant, seqRef)` 之类的取数 hook / 函数，集中实现四道闸：
  1. **同步清空**：`selectedId` 变化的处理函数内立即把下区数据置空并设占位（步骤 2 的 `clearLower()`），旧条目在同一帧消失；
  2. **单飞 + 序号**：模块级 `seqRef`（`{n:0}`）与 `inFlight.ctrl`，与 `taskStatsSeq/taskStatsInFlight`（`client.js:973-974`）同款；每次取数 `const seq = ++seqRef.n`，新请求发起前 abort 上一个；
  3. **二次校验**：响应回来时同时满足 `!disposed && seq === seqRef.n && expectedSelectedId === selectedIdRef.current && isAssistant` 才 `setWorkerIds(data)`，否则整包丢弃（`client.js:1014` 的 seq 守卫扩展）；
  4. **生命周期**：组件卸载 / 下区收起 / 页面隐藏（可选）时 `disposed=true` 并 abort，杜绝卸载后 setState。
- 非助手模式分支：直接跳过取数并保持下区空白；从助手模式切到非助手模式时也必须先清空再跳过。
- `openSession` 的 Promise 不参与下区状态更新（步骤 2 已保证）。

**(b) 验收什么**

- 人为给接口加延迟（mock 或 DevTools 限速），先点 A 再点 B：A 的迟到响应不得写入 B 的下区；只有最后一次请求的结果被渲染。
- 切换瞬间下区无旧条目；快速连点不发重叠请求（单飞）；abort 后无控制台错误/警告。
- 非助手模式不发包；收起/卸载后迟到响应不写状态。

**(c) 成功标准（可核对）**

1. A（2 条）→ 立即点 B（1 条），mock 让 A 的响应晚 2s 返回：B 的下区始终只有 1 条，A 的 2 条从未出现；切换瞬间旧 2 条立即清空。
2. 网络面板确认同一时刻最多 1 个 sessions 请求在飞（单飞生效），新请求发起时旧请求状态为 canceled/aborted。
3. 连续点击 5 次不同会话，最终下区只显示最后一次会话的数据；控制台无 `Can't perform a React state update on an unmounted component` 之类警告。
4. 切到非助手会话时下区空白且无新增 sessions 请求；切回收起态后无迟到渲染。

---

### 步骤 5 — 空态 / 收起 / 上下独立滚动

**(a) 完成什么（功能 + 技术）**

- 在 `ACTIVITY_CSS`（`client.js:86` 的样式表）新增 `data-enkeep-dispatch-*` 规则，仍走幂等 `<style data-plugin-css="enkeep-activity">` + disposer，HMR 无残留。
- DOM 结构：`ActivityBar` 根下分「公共拖拽头 + 上区列表容器 + 下区面板」；上区列表容器与下区列表容器各自 `max-height` + `overflow-y:auto`（下区容器高度小于上区，避免等高），公共拖拽头/按钮区不随滚动移动；`shell.overlay` 根仍 `pointer-events:auto`。
- 下区 head 加**独立收起按钮**（`const [lowerCollapsed, setLowerCollapsed] = useState(false)`），与上区 `collapsed` 完全独立；收起时只隐藏下区列表容器，标题/收起按钮保留，上区与拖拽/其他头部按钮不受影响；按钮含 `aria-expanded` 与 title。
- 空态：助手模式且命中数为 0（含接口失败/缺席降级）→ 下区列表区渲染 `data-enkeep-dispatch-empty`，文案 **「当前对话暂无外派」**；非助手模式 → 不渲染空态（纯空白，见 §1.2）。
- 下区标题固定「当前对话的外派对话」；条目间样式沿用活动区视觉变量，但不复用上区的 `data-enkeep-activity-*` 选择器。

**(b) 验收什么**

- 上区滚动不影响下区 `scrollTop`，反之亦然；内容不足时不出现多余滚动条。
- 收起下区后上区、拖拽、侧栏隐藏/新建/设置等按钮全部仍可用；再次展开恢复原数据与滚动位置（或按既定口径重置，需在同一实现中保持一致）。
- 空态文案精确、只在助手模式无外派时出现；非助手模式为纯空白；接口失败时同样空态。
- HMR/刷新后无重复 `<style>`、无样式残留。

**(c) 成功标准（可核对）**

1. 上区造 20+ 条、下区造 5+ 条：分别滚动两个容器，另一个容器 `scrollTop` 保持 0/不变（用脚本读取两个 DOM 节点的 `scrollTop` 验证）。
2. 点下区收起：下区 `data-enkeep-dispatch-list` 节点消失或 `display:none`，上区列表节点与所有头部按钮仍在且可操作；再点恢复。
3. 助手模式无外派会话：下区出现文本节点「当前对话暂无外派」且仅出现一次；非助手模式会话：下区 DOM 中既无条目也无该文案。
4. 页面中 `style[data-plugin-css="enkeep-activity"]` 始终只有 1 个；热更新后仍为 1 个。

---

### 步骤 6 — 去 tab 外壳与整体组装（上下分栏成型）

**(a) 完成什么（功能 + 技术）**

- 删除 `activeTab` state（`client.js:1246`）与顶部两个 `role=tab` 按钮及其容器（`client.js:1532-1542`），删除配套 `data-enkeep-activity-tabs/tab` 的 CSS（`client.js:126-144` 相关规则）。
- 上区**直接渲染 `groups.conversations`**（原 tab1 内容，不做任何筛选/改动）；头部「N 个」改为上区条数；下区由 `DispatchPanel` 呈现。
- 删除下区/第二 tab 的旧渲染分支：`groups.dispatch` 在 `ActivityBar` 的消费（`:1515`）、计数 `hasItems` 与整条隐藏判断（`:1516,1519`）改为**只看上区 conversations**——上区无条目且无对话框时才 `return null`（助手模式无外派但上区有对话时活动区仍显示）。
- 删除旧第二 tab 的空态「暂无外派任务」（`:1624`）——下区空态统一由步骤 5 的「当前对话暂无外派」承担。
- 保留并回归全部既有能力：拖拽与位置记忆、双击复位、收起、五态圆点、置顶/归档/重命名对话框、侧栏隐藏、新建对话/工作区、设置、定时刷新与 focus 刷新。
- `shell.overlay` 注册（`client.js:2732-2752`）保持 additive、id/order 不变；`inject` 无需新增服务（仅用自动注入的 hooks + 现有 `openSession`）。

**(b) 验收什么**

- DOM 中不存在 `role="tablist"` / `data-enkeep-activity-tab` 节点；上区列表与改造前 tab1 逐项一致。
- 整条隐藏条件正确；既有能力全部回归通过；HMR 无残留。

**(c) 成功标准（可核对）**

1. `document.querySelectorAll('[data-enkeep-activity-tab], [role=tablist]')` 在活动区内结果为 0。
2. 改造前后对比：同一时刻上区会话集合、顺序、圆点颜色、置顶条、当前高亮行**逐项一致**（用截图或 DOM 快照对比）。
3. 上区为空但下区有内容：活动区仍渲染（上区空态「暂无活动会话」），不会整条消失；上区有对话、下区无外派：活动区渲染且下区给出空态。
4. 既有回归项逐条通过：置顶/取消置顶、归档（含运行中拒绝提示）、重命名、拖拽移动与双击复位、收起/展开、隐藏/显示侧栏、新建对话/工作区、设置入口、每分钟与 focus 刷新；无控制台报错。

---

### 步骤 7 — 端到端验收与回归

**(a) 完成什么（功能 + 技术）**

- 按 §5 验收矩阵逐项执行；核对三方一致：`tasks.jsonl` 的 `sourceSessionId` 归属 ↔ 步骤 1 接口返回的 `workerSessionIds` ↔ 步骤 3 下区渲染（基于 `useSessions`）。
- 浏览器刷新与 HMR 各跑一遍；确认无 tab 残留、无样式重复、无未捕获异常。

**(b) 验收什么**

- 验收矩阵全部满足；数据桥、联动、防串、空态/收起、独立滚动、去 tab 六个方面均可复现、可检测。

**(c) 成功标准（可核对）**

1. §5 矩阵中每一项「判定方式」均可执行且结果符合期望。
2. 刷新后：`selectedId` 复位到 derived `current`，下区显示其外派；无残留请求、无旧数据闪现。
3. 控制台无 error / 未捕获 Promise / React 状态警告；接口缺席时活动区上区与既有功能完全不受影响。

---

## 5. 验收矩阵（逐项可复现、可检测）

| ID | 场景 | 操作 | 期望 | 判定方式 |
|---|---|---|---|---|
| A1 | 数据桥正确性 | A 会话派 2 任务，请求 sessions 接口 | 返回 2 个 workerSessionId，与引擎实际会话 id 一致 | 对比 `tasks.jsonl` 与 `useSessions` 行 |
| A2 | legacy 排除 | 用无 `sourceSessionId` 的任务所在会话查询 | 不返回这些任务；缺省 sessionId 也不误命中 | 接口响应断言 |
| A3 | 字段最小化 | 抓取完整响应体 | 仅 workerSessionIds（+ok/sessionId），无内部字段 | 响应 JSON keys 检查 |
| A4 | 联动-助手模式 | 点有派发的助手会话 A | 下区切到 A 的外派，条数正确 | DOM `data-enkeep-dispatch-item` 计数 |
| A5 | 联动-非助手模式 | 点普通会话（preset 非 main） | 下区纯空白、无空态、无请求 | DOM + 网络面板 |
| A6 | 联动-无外派 | 点助手会话 B（无派发） | 下区空态「当前对话暂无外派」 | DOM 文本断言 |
| A7 | 防串-慢响应 | mock A 延迟 2s，A→B 快速切换 | B 下区始终只显示 B 的数据，A 迟到包被丢弃 | DOM + 网络时序 |
| A8 | 防串-清空时机 | 点击含旧数据的行 | 同一帧内旧条目消失 | MutationObserver / 渲染快照 |
| A9 | 防串-单飞 | 连续快速点击 5 次 | 同时最多 1 个 sessions 请求 | 网络面板 |
| A10 | 交叉渲染 | 归档某 worker 会话后刷新 | 该条目不出现在下区 | `useSessions` 可见集合对比 |
| A11 | 独立滚动 | 分别滚动上下容器 | 另一容器 scrollTop 不变 | DOM scrollTop 读取 |
| A12 | 下区收起 | 点下区收起/展开 | 仅下区列表隐藏/恢复，上区与按钮不受影响 | DOM + 交互断言 |
| A13 | 去 tab | 打开活动区 | 无 tablist / tab 按钮 | `querySelectorAll` 结果为 0 |
| A14 | 上区原样 | 改造前后对比 | 列表/顺序/圆点/高亮逐项一致 | DOM 快照或截图对比 |
| A15 | 整条隐藏 | 上区空、下区有内容 | 活动区仍显示 | DOM 根节点存在性 |
| A16 | 降级 | 卸载/停用 dsh-assistant 后点击助手会话 | 下区空态、上区与既有功能不受影响、无未捕获异常 | 控制台 + DOM |
| A17 | HMR/刷新 | 热更新与整页刷新 | 无重复 style、无 tab 残留、无旧数据闪现 | DOM + 控制台 |

---

## 6. 风险与边界（实现时必须处理）

- **legacy 任务**：无 `sourceSessionId` 的任务必须显式排除（truthy 前置判断 + 严格相等），不可用 `ownedBy` 的 fail-open；否则会串进每个会话。
- **置顶/当前 worker 例外**：`selectActivity` 中 pinned/current 的 worker 会话仍留在上区 conversations 组；下区按 `sourceSessionId` 独立取数，不受该例外影响。同一 worker 会话可能同时出现在上区（置顶/当前例外）与下区，这是**已知行为，不是 bug**，需在验收说明中写明。
- **workerSessionId 一致性**：接口返回值必须与 `useSessions` 中实际 worker 会话 id 完全一致（现行 `da-worker-<taskId>` 约定）；不一致会导致下区交叉渲染为空，步骤 1/A1 必须对齐验证。
- **归档/未加载会话**：`useSessions` 中不可见的 worker 会话被跳过，下区条数可能少于任务数；验收口径以「`useSessions` 可见集合」为准。
- **openSession 异步滞后**：点击行打开会话是异步的，下区切换不得依赖其完成；`selectedId` 是下区的唯一驱动源。
- **路由软约束**：接口公开、无鉴权（与 stats 路由同口径），客户端只传当前 `selectedId`，数据仅 workerSessionId 字符串数组（不敏感）；不做服务端会话绑定。
- **去 tab 的解释边界**：按第 1 节决定 1/2，顶层 tab 外壳与下区 tab 外壳均移除；上区列表内容/行为原样。若上线后用户明确要求保留顶层 tab 条，属新需求，另起任务。

---

## 7. 文件改动清单（不含时间信息）

| 文件 | 改动 | 关联步骤 |
|---|---|---|
| `C:\dev\dsh-assistant\index.js`（或同插件 `src/` 新增小模块） | 新增软挂载只读 `GET /dsh-assistant-tasks/sessions`（仅回 workerSessionId），从 `engine.tasks` 按 `sourceSessionId` 严格过滤；软依赖 webServer + disposer | 步骤 1 |
| `C:\dev\dsh-enkeep\client.js` | `selectActivity` 返回 `current`；`ActivityBar` 增 `selectedId`/ref、清空逻辑、去 tab、上下分栏 DOM；新增 `DispatchPanel` 与取数封装（单飞/seqRef/abort）；`ACTIVITY_CSS` 增 `data-enkeep-dispatch-*` 规则；`shell.overlay` 注册保持 additive 不变 | 步骤 2–6 |
| `C:\dev\dsh-enkeep\docs\ACTIVITY-SPLIT-PANEL-DEV-PLAN.md` | 本文件（唯一事实源） | 全部 |
