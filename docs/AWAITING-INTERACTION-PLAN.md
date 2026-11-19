# 活动区「等待互动」状态方案（A 方案）

> 状态：已规划，待实施。本文只规划步骤与技术，不含时间估算。
> 目标：修复「会话弹出问题等待用户交互时，活动区仍一直显示绿色运行中圆点」的误导。

---

## 0. 背景与根因（调研结论）

### 现象
会话运行过程中弹出需要用户交互的问题（审批 / 提问 / 计划审查）后，会话实际已停在等待态；但活动区该行仍显示绿色脉冲「运行中」，直到用户回到该会话回答为止。此时用户在别的会话里操作，会误以为它还在跑。

### 根因
DSH 官方 `useSessionStatus` 对每个会话暴露**三个独立字段**（见 `@deepseek-ai/dsh-client-ui-session` 类型定义 `SessionStatus`）：

| 字段 | 含义 |
|---|---|
| `running: boolean \| undefined` | 进程是否活跃（技术层） |
| `pendingInteraction: SessionPendingInteraction \| undefined` | 最高优先级的「等待用户交互」请求（对象，含 `kind`），**语义层已暂停** |
| `completionUnread: boolean` | 完成但用户未看 |

官方 workspace UI 的 `sessionStatuses()` 明确注释 **"pending interaction is primary"**，判定顺序为：

```
pendingInteraction 存在 → state "warning"（等待态）
否则 running          → state "ongoing"（运行中）
否则 completionUnread → state "done"（完成未看）
否则                  → state "idle"（空闲）
```

官方 conversation 也把 `pendingInteraction !== undefined` 当作「会话当前不可推进」的判据，印证等待交互即暂停语义。

**我们的问题**：`selectActivity()`（client.js）只读 `st.running`，完全没读 `st.pendingInteraction`。等待交互时 `running` 仍为 `true`，于是圆点一直是 `ongoing`（绿+脉冲）。这是漏读字段，不是配色错误。

### 结论
采用 **A 方案**：对齐官方，把「等待互动」作为独立于 running 的最高优先级状态读入并展示。不改宿主代码，纯前端改动。

---

## 1. 总体方案与技术选型

### 状态优先级
`awaiting（等待互动）> ongoing（运行中）> unread（完成未看）> idle（空闲）`

### 数据流（全部在 client.js 内，无新增依赖、无新增 hook）
```
useSessionStatus((s) => s)   → statuses（现有，client.js:707 已在取）
        │
        └─ st.pendingInteraction !== undefined ─→ 等待互动（awaiting）
        └─ 否则 st.running ─────────────────────→ 运行中（ongoing）
        └─ 否则 st.completionUnread ────────────→ 完成未看（unread）
        └─ 否则 ─────────────────────────────────→ 空闲（idle）
```

### 视觉规范（圆点，三者必须互不混淆）
| state | 圆点样式 | 语义 |
|---|---|---|
| `ongoing` | 绿色 + 脉冲环（现状，不动） | 真正在运行 |
| `awaiting` | 琥珀色 `--dsw-alias-state-warn-label` **空心环**（透明中心 + 2px 描边）、**静态无脉冲** | 停下来了，在等用户 |
| `unread` | 琥珀色**实心点** + 光环（现状，不动） | 完成但未看 |
| `idle` | 灰点（现状，不动） | 空闲 |

脉冲动画专门保留给 `ongoing`：等待态恰恰是「静止等你」，用脉冲会和真运行混淆。

### 文案
- 圆点 `title` / 无障碍标签统一写 **「等待互动」**。
- **不按 `kind` 细分**（不显示「等待批准 / 等待回答 / 计划审查」），避免 i18n 与维护负担。`kind` 字段存在但本方案不使用，只以 `pendingInteraction !== undefined` 判定。

### 生效方式
纯前端 `client.js` 改动 → **只需刷新浏览器页面**，无需重启 dsh web。

---

## 2. 步骤一：状态判定逻辑（selectActivity）

### 功能
在 `selectActivity()`（client.js 约 370-411 行）读取每个会话的 `st.pendingInteraction`，产出新的 `awaiting` 状态并参与入选与排序：
- 新增布尔判定：`awaiting = st && st.pendingInteraction !== undefined`。
- `state` 计算改为优先级链：`awaiting ? 'awaiting' : (running ? 'ongoing' : (unread ? 'unread' : 'idle'))`。
- **入选逻辑**：等待互动的会话即使超时也保留——把 `awaiting` 加入保留条件（`if (!running && !unread && !recent && !isPinned && !awaiting) continue`），因为它比普通超时项更需要用户注意。
- 排序：仍按「置顶区在前、普通区在后，各自 SessionId 字典序」；`awaiting` **不单独提序**（保持列表稳定，避免跳动）；它只影响圆点与保留，`current` 仍是叠加高亮维度。

### 技术
- 复用现有 `statuses`（`useSessionStatus((s) => s)`，client.js:707 已在取，无需新增 hook 或订阅）。
- `pendingInteraction` 是对象或 `undefined`，只做存在性判断，不读内部 `kind`。
- 不修改 `useSessions` / `useSessionStatus` 的取法，不新增 slot，不改宿主 `index.js`。

### 完成标准
- `st.pendingInteraction !== undefined` 时，`state === 'awaiting'`，即使 `st.running === true`。
- `st.pendingInteraction === undefined` 且 `running === true` 时，`state === 'ongoing'`（不误伤正常运行）。
- `pendingInteraction` 存在但会话已超时（超出 hours 窗口）时，仍保留在活动区列表中。
- 置顶、current、归档/subagent/blank 的既有规则全部不变。

### 验收（mock）
- `st = { running: true, pendingInteraction: { kind: 'question', ... }, completionUnread: false }` → 该项 `state === 'awaiting'`。
- `st = { running: true, pendingInteraction: undefined, completionUnread: false }` → `state === 'ongoing'`。
- `st = { running: false, pendingInteraction: {...}, completionUnread: false }` + `updatedAt` 超时 → 项仍在列表且 `state === 'awaiting'`。
- `st = { running: false, pendingInteraction: undefined, completionUnread: true }` → `state === 'unread'`（回归）。
- 置顶排序、current 高亮、归档剔除的既有 mock 全部通过。

### 成功标准
等待互动的会话在活动区稳定显示为「等待互动」态，且不会被超时过滤掉；正常/未读/空闲语义零回归。

---

## 3. 步骤二：圆点样式与文案

### 功能
在活动区样式表（client.js 约 142-155 行圆点规则区）新增 `awaiting` 圆点样式，并把该项的 `title` 文案改为「等待互动」：
- 新增 `[data-enkeep-dot="awaiting"]`：琥珀色 `--dsw-alias-state-warn-label`，但做成**空心环**（`background:transparent;box-sizing:border-box;border:2px solid ...`）且**静态无脉冲**。与同为琥珀色的 unread 实心点+光环在形状上区分，避免颜色混淆（实施期对原计划的细化——原写「静态光环」会与 unread 视觉重合）。
- 该项主按钮 `title`：等待互动时后缀「（等待互动）」，否则维持现有「（当前对话）」逻辑。
- 圆点本身 `data-enkeep-dot` 属性值直接由 `it.state` 提供（现有机制），无需改渲染结构。

### 技术
- 复用现有 SVG 圆点渲染（`h('span', { 'data-enkeep-dot': it.state })`，client.js:773），只加一条 CSS 规则与 title 文案分支。
- 样式 token 沿用主题变量（与 width 隔离约束一致：不写 `--dsh-chat-content-width` / `--dsh-composer-card-max-width`）。
- `aria` / title 用纯中文「等待互动」，不使用 dsh-ui 围栏。

### 完成标准
- 四种圆点在视觉上可区分：绿脉冲（运行）、琥珀静态+光环（等待互动）、橙光环（未看）、灰（空闲）。
- `awaiting` 圆点无 `animation`（不脉冲）。
- title 文案正确：等待互动项含「等待互动」；非等待项文案不变。

### 验收
- mock 渲染：`state='awaiting'` 的项，其圆点 `props['data-enkeep-dot'] === 'awaiting'`，title 含「等待互动」。
- CSS 文本断言：存在 `[data-enkeep-dot="awaiting"]` 规则且不含 `animation`；`ongoing` 规则仍含 `animation`（回归）。
- 宽度隔离断言：新增 CSS 不含 `--dsh-chat-content-width:` / `--dsh-composer-card-max-width:`。

### 成功标准
用户一眼能把「在等你」和「在跑」「已完成未看」区分开，且不会产生新的颜色混淆。

---

## 4. 步骤三：全量回归、审核与发布

### 功能
- `node --check client.js` 通过。
- 全量 mock 回归：活动区既有功能（置顶防抖、归档二次确认、重命名、current 高亮、宽度隔离、词库 v2、快捷提示条、设置 Tab）全部仍通过。
- 审核改动范围：仅 `client.js`（+ 本文档）；无新 npm 依赖、无构建、不改词库 v2 schema、不碰 skill-picker 及其 fork/守护配置。
- 同步安装副本 `C:\Users\mason\.dsh\profiles\web\node_modules\dsh-enkeep\client.js`，SHA256 与源一致。
- 提交并推送，确认 `HEAD == origin/main`。

### 技术
- mock harness（复用既有模式：注入 React/DOM/fetch 桩，渲染 `ActivityBar`）。
- `node --check`、`git diff --name-only`、SHA256 哈希对比、`git rev-parse HEAD` / `origin/main`。

### 完成标准
- 所有 mock 用例与全量回归通过。
- 安装副本与源哈希一致；提交已推送且 `HEAD == origin/main`；工作区干净。

### 验收
- 见「完成标准」逐条。
- **真实浏览器验收（用户侧）**：刷新页面（无需重启 dsh web）→ 让一个会话停在等待交互态 → 活动区该行圆点显示琥珀静态「等待互动」而非绿色脉冲；回到该会话交互后恢复为运行中/完成态。（本环境无 DOM/截图能力，此项需用户确认。）

### 成功标准
改动可安全交付，既有功能零回归，部署一致。

---

## 5. 全局约束
- 零新 npm 依赖、零构建步骤。
- 不改词库 v2 schema、不改同步协议。
- 不碰 `dsh-skill-picker` 及其 fork / guard 配置。
- 宽度隔离：活动区样式可读 `--dsh-composer-card-max-width`，但**不得写** `--dsh-chat-content-width` 或 `--dsh-composer-card-max-width`。
- 显示文案统一「等待互动」，不按 `kind` 细分。
- 不新增搜索框，不动技能快捷插入相关逻辑（本次仅处理状态判定与圆点）。
