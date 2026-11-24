# dsh-enkeep 浮动活动区改造 —— 代码审核报告

审核对象（工作树未提交改动）：`C:\dev\dsh-assistant\index.js`（+95/-0）、`C:\dev\dsh-enkeep\client.js`（+254/-75）
基准：`docs/ACTIVITY-SPLIT-PANEL-DEV-PLAN.md`（298 行，7 步 + 落点表 + A1–A17）
方法：git diff 逐段审 + 对照实际代码上下文 + node --check。仅审查，未修改任何文件。

## 一、发现的问题（按严重程度排序）

### 1. 【高 / 范围外】index.js:233–240 — `verify: () => ({ pass: true })` 是并发外部改动，不是本任务代码
- 定性：它是另一条并行工作「P0 证据门槛」的宿主激活点。证据：同一工作树里 `src/engine.js` 新增 `checkEvidence` / `_checkReadyEvidence` / `report()` 门禁、`tests/evidence.test.cjs`（未跟踪）、`acceptance/probe.mjs`、`prompts/worker.md` 等一批改动同属该特性；其注释自称 "P0 shipped dormant"、"Phase 2 ... OUT OF SCOPE"。与外派面板/只读数据桥毫无关系。
- 实际作用（并非无害占位）：Engine 构造收到 `verify` 后，`report(ready)` 会对**每一个** worker 的 ready 强制做 evidence 格式校验；缺 evidence 或格式不合格 → 任务置 `waiting_human` + 主线通知、**不投递**，且 `t.report.verification = {pass:false}`。这是助手插件的全局行为变更。
- 风险：若把当前 index.js 工作树整份提交，会静默上线该特性，可能使不带 evidence 的 worker 汇报被拒、任务无法交付；且该特性自身 Phase 2 未完成。
- 建议：本任务提交范围只含 `workerSessionIdsFor`(:71) 与 sessions 路由(:919–984)；verify 钩子交回其所属任务单独评审/提交，或经用户明确确认后再保留。

### 2. 【中】client.js:1671–1676 / 1117–1139 — 重复点击同一行会清空下区却不再取数
- `onSelectRow(id)` 同步调用 `clearLower()` → `clearNow`(:1104) 使 `seqRef.n += 1`、abort 在飞请求、`setWorkerIds([])`。
- 但 DispatchPanel 的取数 effect 依赖仅 `[selectedId, isAssistant, selectedIdRef]`(:1139)。当再次点击**当前已选中的同一行**时，`setSelectedId(同值)` 不触发 effect 重跑，而 `workerIds` 已被清空、旧请求已被 abort；结果下区永久停留在空态，直到改选别的行。
- 建议：`clearNow` 内 bump 一个 `reloadNonce` 并加入 effect 依赖；或在 `onSelectRow` 中当 `id === selectedIdRef.current` 时跳过 `clearLower()`（no-op 重选）。

### 3. 【低】client.js:1117–1139 / 1734–1744 — 下区收起不 abort，与方案步骤 4 口径不符
- `lowerCollapsed` 不在取数 effect 依赖里；收起只隐藏 list（`!lowerCollapsed && ...`），effect 不清理、不 abort。迟到响应仍 `setWorkerIds` 写入隐藏状态，严格说不满足步骤 4(a)「下区收起时 disposed=true 并 abort」与 4(c)#4「切回收起态后无迟到渲染」。
- 建议：将 `lowerCollapsed` 纳入 effect 依赖（收起即 abort），或在实现说明中明确「收起仅隐藏、数据照常刷新」的一致口径。

### 4. 【低 / 性能提示】client.js:1655、1666、1096 — 同一会话 store 被多次全量订阅
- ActivityBar `useSessions((s)=>s)`、`useSessions((s)=>...byId[selectedId])` 各一次，DispatchPanel 又 `useSessions((s)=>s)` + `useSessionStatus((s)=>s)`。任一 session 更新会让这些组件整体重渲染。此为方案步骤 3 指定写法，非功能缺陷，但可合并 selector 优化。

## 二、确认无问题的点

- **过滤 helper（index.js:71–84）**：`!sessionId` 守卫 + `sourceSessionId` truthy 前置 + 严格相等 + `task.id` 必需，legacy 一律排除，未用 `ownedBy` 的 fail-open；`sessionId` 缺省/`undefined` 不会误命中。id 形式 `WORKER_PREFIX + task.id`（`da-worker-<taskId>`）与引擎实际创建（index.js:108、709）及 `useSessions` 识别（src/sessions.js:122）一致；去重保序。
- **只读接口（index.js:919–984）**：软依赖 `ctx.get('webServer')` + 能力探测 + `internal/status` 重探 + `ctx.effect` disposer，不进顶层 inject；`kind:'exact'` 路径与 stats 路由同族不同路径不冲突；GET-only + 自定义头（403/405）；响应仅 `{ok,sessionId,workerSessionIds}` 无内部字段；catch 降级空数组、不写文件、不改状态机。
- **上区原样 / 去 tab**：`selectActivity` 两组筛选/排序/截断/五态圆点/置顶/当前高亮/行操作全未改，仅多返回 `current`；tab 外壳、tab CSS、旧「暂无外派任务」空态全部删除，grep 无 `activeTab`/`activity-tabs`/`role=tablist` 残留；对话框、拖拽、侧栏隐藏、新建、刷新等既有能力保留。
- **联动与校正**：`onSelectRow` 同帧 ref→state→clearLower→openSession；openSession 完成不写回下区；derived current 校正（初始化 adoption + 外部变化 override + 同值不重复清）逻辑正确。
- **防串**：单飞（factory-scope `dispatchInFlight`）、`seqRef`、AbortController、四道二次校验（disposed / seq / expectedSelectedId vs selectedIdRef / isAssistant）齐全；fetch 失败/abort/404 统一降级 `[]`；与 `AssistantTaskStats` 范式一致。
- **交叉渲染**：过滤未命中/blank/`origin==='subagent'`/archived；圆点状态逻辑与 `selectActivity` 逐字一致；label 用 `sessionLabel`；独立 `data-enkeep-dispatch-*` 属性，顺序按 workerIds；条目只读 + openSession。
- **空态/收起/滚动**：非助手 `return null` 纯空白且无请求；助手无外派显示「当前对话暂无外派」（降级同口径）；下区独立收起按钮含 aria-expanded/title；上下各 `max-height + overflow-y:auto`（264/132）；CSS 并入单一幂等 `<style data-plugin-css="enkeep-activity">`。
- **6(a) 与 A15**：按验收矩阵 A15「上区空、下区有内容仍显示」保留整条（`lowerActive`），注释明确说明与步骤 6(a) 字面冲突的取舍，合理；条件略宽（助手选中即保留，哪怕下区空）但无害。
- 两文件 `node --check` 通过；client 与 index 的 URL/头两端一致；无死代码、无明显命名/接口不一致。
