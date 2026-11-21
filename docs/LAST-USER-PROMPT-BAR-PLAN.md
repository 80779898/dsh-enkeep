# 输入框上方「上一条指令」固定横条 —— 开发计划

> 状态：**已实施**（位置经两次调整：消息区顶部 → 输入框上沿浮层 → **`conversation.input.dock` 文档流内**，见 §1.2）。
> 目标产物：在官方「对话」tab 的**输入框正上方、与其他插件同处 input.dock 文档流**，显示"我最后一次对 AI 助手说的话"，
> 让回答很长、会话很久之后，仍一眼能看到"我上次的要求是什么"，且 hover 可复制。

---

## 1. 目标与用户诉求

### 1.1 诉求
- 场景：AI 回答很长，会话滚动很远之后，用户忘记"我上次让 AI 做什么"。
- 需求：在**官方「对话」tab 里**，做一个**固定横条**，显示**最后一次用户自己发送给 AI 助手的内容**。
- 价值：随时抬头就能看到"上一条指令"，知道 AI 正在围绕什么工作。

### 1.2 已确认的产品决策（用户拍板）
1. **位置**：**`conversation.input.dock` slot 文档流内**，与 git 分支 chip、任务进度条同处一个 additive list slot，由官方布局依次排列——**永不遮挡其他插件**，且位于输入框上方最贴近处。
   - 变更记录：初版"消息区顶部"浮层 → "输入框上沿"浮层（absolute+bottom 锚定）→ 发现浮层压住任务条 → 改为 input.dock 文档流。
   - **形式参照 git 分支 chip**（`BranchChip` 注册在同一 `conversation.input.dock`）：`width:100%; max-width:var(--dsh-composer-card-max-width); margin:0 auto`，正常文档流，不是浮层。实测横条 y=730~764、任务条 y=668~704，零重叠，最贴近输入框。
   - **间隙微调**：横条 wrapper 用 `margin:0 auto -2px` 抵消官方 stack 的部分 gap，使横条底边到输入框顶边的间隙为 **12px**（最初 14px 偏大、-8px 时 6px 贴死、-4px 时 10px，最终定 12px）；横条底边距输入框卡片顶部 4px，不侵入卡片背景。
   - **浮层方案为何废弃**：absolute 浮层脱离文档流，会压住 input.dock 里已有的任务条/git chip；"真实占位顶输入框"经实测也不可行（§2.5）。文档流是唯一既贴近又不遮挡的方案。
2. **内容**：清洗后的**纯文本** + **最多 2 行** + 前面一个「上一条指令」小标签；超长末尾省略。
3. **交互**：**hover 显示「复制」按钮**，点击把纯文本写入剪贴板（navigator.clipboard + execCommand 兜底），带"已复制"反馈；不做跳转/高亮原消息（那要操作 chat 滚动、和虚拟滚动打架，收益低风险高）。

### 2.5 位置方案实测（为何不能用"真实占位顶下去"）
- 输入框（contenteditable `.uV2eYG_input`）：x=309 y=776 w=1052 h=36；提示词行（dock）y=866（在输入框**下方**，中间隔工具栏）。
- 消息滚动区 scrollBody：y=76~768；composer 卡片 root：x=280 y=768 w=1113 h=132（贴底 bottom=900）。
- 6 组 CSS 实验结论：
  - `composerSeat/Stack{padding-top:44px}` → seat/stack 变高但**输入框 y=776 不动**（内部 flex 吃掉空区）。
  - `scrollBody{margin-bottom:44px}` → 输入框**上移**至 y=732、底部留白，布局被破坏。
  - 往 `conversation.input.dock` slot 注入真实 DOM（probe h=40）→ 输入框**仍 y=776**（该 slot 是浮层，不参与布局流）。
- 结论：无 slot / 纯 CSS 能在输入框上方挤一行并下推输入框；硬改官方固定高度脆弱且违背"不改官方"约束。最终采用注册进 `conversation.input.dock` 走文档流（§1.2）。

---

## 2. 现状调研（已确认事实，本机 DSH 0.2.1-rc.2）

### 2.1 没有现成的 slot 可用
- `conversation.header`、`conversation.session`、`conversation.chat.flow` 全部是 **single slot，已被官方占用**：
  - `conversation.header` — conversation 包注册（client.js:19835）
  - `conversation.session` — conversation 包注册（client.js:19734）
  - `conversation.chat.flow` — chat 包注册（`id:"chat"`，client.js:13204-13218）
- 直接注册这些 single slot 会触发"同优先级冲突" → 启动报错（与之前 `lineage` 插槽事故同源）。**禁止注册**。
- `conversation.session.header.actions` 是 list 插槽、additive，enkeep 已占用（header 标题驱动）——但它在标题栏右侧，不适合放这个横条。

**结论**：横条走 enkeep 现有模式——**纯 client.js + DOM 观察 + 注入 DOM + CSS**，不碰任何官方 slot、不改官方代码。

### 2.2 数据源：enkeep 拿不到消息内容 API
- enkeep 目前只持有 `useSessions`（会话元数据 title/cwd）与 `useSessionStatus`、`useInput` 等标准 hook。
- "最后一条用户消息"存在于 chat 插件内部：`chat.getSnapshot().nodes`（`lastKey`、`lastIsUser`），仅通过 `conversation.chat.flow` 的 inject 暴露给**它自己的 slot**，不对普通插件公开。
- 官方未暴露 `useChat` 给通用 session-scope slot（`dsh-cordis-client-runner` 里的 `useChat: UseChat` 是类型声明，不是跨插件 API）。
- host 侧读 transcript 文件 + RPC 的方案可行但要改 index.js + 重启 web，工程量大——**不采用**。

### 2.3 可行数据源：DOM 抓取（方案 A，采用）
- 真实页面实测：用户消息节点带标记 `data-chat-flow-kind="user"`（实测存在多条；`data-role` / `data-message-role` 均不存在，不能用）。
  同一节点还带 `data-chat-node-key` / `data-chat-flow-key` / `data-chat-turn`，可辅助定位。
- 消息流容器：`[data-slot="conversation.chat.flow"]`，其父为 `.EvIC1a_column`，再上是 `.EvIC1a_scroll`（滚动容器）。
- 因此可用 `MutationObserver` 监听消息流，取**最后一个**用户消息节点，提取其纯文本。
- **重要（实测）**：从 `conversation.chat.flow` 一直到 `main.conversation` 的整条祖先链**全部是 React 管理的 DOM**（节点上有 `__reactFiber`/`__reactProps`）。
  所以**绝不能**用 `appendChild` 手动塞 DOM——React 重渲染会把它冲掉。横条必须通过 `ctx.slots.register` 注册为 React 组件，由框架渲染。
- **最终实现**：注册进 `conversation.input.dock`（additive list slot，git chip/任务条也在其中），走正常文档流。MutationObserver **只读**文本、写入 React state，不直接改官方 DOM。

### 2.4 风险（如实记录）
1. **虚拟滚动**：超长会话只有视口附近的节点在 DOM。但"最后一条用户消息"位于对话末端、必然在 DOM 中，风险小。
2. **文本提取**：用户消息可能含 markdown、@引用、命令、代码块、换行；需清洗为可读纯文本。
3. **遮挡其他插件**：浮层方案（absolute）会压住 input.dock 里的任务条/git chip；文档流方案由官方布局依次排列，实测零重叠（任务条 y=668~704、横条 y=730~764）。
4. **实时性**：新消息发出、切会话、清空历史时都要即时刷新；observer 只更新 React state，不碰官方 DOM。
5. **React 重绘**：横条由我们自己的 React 组件持有（注册在 input.dock），不受官方消息列表重绘影响。

---

## 3. 技术方案总览

```
client.js（唯一改动文件）
 ├─ 新增 React 组件 LastPromptDockBar()：横条 UI（标签 + 正文 2 行 + hover 复制按钮），
 │   内部 useEffect 启动 MutationObserver 抓最后一条用户消息文本 → 写自身 state。
 ├─ 在 activity bar 的 effect 内注册到 conversation.input.dock（additive list slot）：
 │   ctx.slots.register({ name:'conversation.input.dock', id:'enkeep-last-prompt', order:200 })
 │   → 渲染 <LastPromptDockBar/>；order 200 排在 git chip(100)/任务条之后 → 最贴近输入框。
 │   disposer 同时注销 dock 注册。
 └─ effect "enkeep: last prompt bar"（第 8 个）：仅安装 CSS（style[data-plugin-css] 幂等 + disposer）。
```

- **技术**：React 组件（注册在 `conversation.input.dock` list slot，走正常文档流）+ 原生 DOM API（`MutationObserver` 只读）+ CSS（`max-width:var(--dsh-composer-card-max-width);margin:0 auto` + token 变量，参照 git chip 形式）。
- **关键**：横条 DOM 由**我们自己的 React 组件**经 slot 框架渲染，绝不用 `appendChild` 注入官方 React 子树；observer 只读不写官方 DOM；文档流排列保证永不遮挡其他插件。
- **零新增依赖、零构建、不改官方代码、不碰任何 single slot、不写宽度变量**（只读取 `--dsh-composer-card-max-width`）。
- **纯净文本提取**：clone 节点去掉 `[data-clock]` 时间戳 → 取文本 → 去 markdown 标记（`#`、`` ` ``、`**`、`- ` 等行首符号）、`@提及`、`/命令` 前缀，折叠空白，限 2 行（CSS `-webkit-line-clamp:2`）。
- **复制**：hover 显示「复制」按钮，`navigator.clipboard.writeText` + `execCommand` 兜底（含 600ms 超时兜底，防 promise 挂起），点击反馈"已复制"。

---

## 4. 实施步骤（每步内容 + 验收 + 成功标准）

### 步骤一：静态骨架 —— CSS + React 组件 + slot 注册 + effect

**内容**
- 新增 `LASTPROMPT_STYLE_ID='enkeep-lastprompt'` 与 `LASTPROMPT_CSS`：横条走文档流（`width:100%; max-width:var(--dsh-composer-card-max-width); margin:0 auto`），内层为圆角卡片（标签 + 正文 2 行省略 + 复制按钮），颜色用 `--dsw-alias-*` token。
- 新增 React 组件 `LastPromptDockBar()`：渲染横条 UI，内部 useEffect 管 observer（见步骤二）。
- 新增 `installLastPromptStyle()`（幂等 + disposer）；新增 effect `enkeep: last prompt bar`（第 8 个）仅安装样式。
- 在 activity bar 的 effect 里注册 `conversation.input.dock`（additive list slot，id `enkeep-last-prompt`，order 200）渲染 `LastPromptDockBar`，disposer 一并注销。
- 无用户消息时组件返回 null（不占位）。

**验收**
- `node --check client.js` 通过；8 个 effect 全部执行无 throw。
- 真实页面：刷新后样式存在；横条出现在 `[data-slot="conversation.input.dock"]` 内；无报错。

**成功标准**：样式/组件/slot 注册能安装与清理；空态不占位；既有 7 个 effect 无回归。

### 步骤二：DOM 观察 + 文本提取 + 实时更新

**内容**
- `MutationObserver` 观察 `document.body` 子树（`childList + subtree`），回调防抖（rAF 合并），初次挂载立即 `scan()`。
- `scan()`：`querySelectorAll('[data-slot="conversation.chat.flow"] [data-chat-flow-kind="user"]')` 取最后一个 → clone 去掉 `[data-clock]` → 清洗文本 → 写入 state。无节点写入空串（组件返回 null）。
- 切会话：DOM 换血触发 observer 重扫。
- observer 只读、只写自身 state；忽略自身与 `<head>` 的 mutation 防自激。

**验收**
- 新增 user 节点 → 横条更新；删除 → 回退；全删 → 隐藏。
- 文本含 markdown/@引用/命令/时间戳 → 清洗后为纯文本。
- 真实页面：横条文本与最后一个 `[data-chat-flow-kind="user"]` 一致，且不含时间戳。

**成功标准**：文本恒等于最后一条用户消息纯文本，新增/删除/切会话即时刷新，不改官方 DOM。

### 步骤三：文档流排列 + 复制按钮 + 视觉打磨

**内容**
- 横条注册在 `conversation.input.dock` 走正常文档流，由官方布局与 git chip/任务条依次排列（order 200 → 最贴近输入框），永不重叠。
- 宽度用 `max-width:var(--dsh-composer-card-max-width); margin:0 auto` 对齐 composer 卡片（只读该变量）。
- hover 显示「复制」按钮：同步捕获按钮引用（React 异步回调会清空 currentTarget）→ `navigator.clipboard.writeText` + `execCommand` 兜底 + 600ms 超时兜底 → "已复制"反馈。
- 视觉：标签弱化 + 正文 2 行省略 + 圆角卡片；不遮挡消息/输入框。

**验收**
- 真实页面：横条与任务条/git chip 零重叠（实测任务条 y=668~704、横条 y=730~764），位于输入框上方最贴近处，间隙 12px。
- 宽度对齐 composer 卡片；hover 复制按钮出现，点击后反馈"已复制"。
- 无遮挡：不盖输入框/标题栏/活动区浮动条。

**成功标准**：零重叠、宽度对齐、复制可用、视觉协调。

### 步骤四：全面回归 + 发布

**内容**
- `node --check client.js`（源码 + 安装副本）。
- mock 回归：7 个既有 effect（宽度/活动区/标题/设置/composer dock/common words/git-panel 等）+ 新 effect 全部 OK、无 throw（注意 input.dock 现在是 additive list slot，与 git chip/任务条共存正常）。
- 范围审核：只改 `client.js`；无新增依赖、无 schema/词库变更、不改官方代码、不写宽度变量、依赖 URL 无 `#SHA`。
- 同步安装副本，`Get-FileHash` 校验源与副本 SHA256 一致。
- 刷新页面 + 拉取线上 preload 脚本，确认含新标记（**不重启 dsh web**）。
- 提交推送，`HEAD == origin/main`，工作区干净。

**验收**
- 全部静态检查/mock 通过；哈希一致；线上脚本含新标记；HEAD 一致、工作区干净。
- 用户刷新页面后亲眼确认横条显示正确、位置固定。

**成功标准**：功能符合三点产品决策、零回归、可按既有发布流程提交。

---

## 5. 关键约束（钉死）

1. **只改 `client.js`**；不改 index.js、不改任何 npm 包源码、不改官方 slot 注册。
2. **零新增 npm 依赖、零构建**。
3. **绝不注册** `conversation.header` / `conversation.session` / `conversation.chat.flow` 等 single slot（会启动报错）。
4. **不写宽度变量**（`--dsh-chat-content-width`、`--dsh-composer-card-max-width` 只读）。
5. **不重启 dsh web**（用户明确要求）；刷新页面 + 线上脚本校验。
6. 保持既有 7 个 effect 与所有既有功能零回归。
7. 依赖 URL 保持 `git+https://github.com/80779898/dsh-enkeep.git`，**无 `#SHA`**。
8. 文本清洗为纯展示，不解析/执行任何内容（防注入）。

---

## 6. 风险与兜底

| 风险 | 兜底 |
|---|---|
| 虚拟滚动导致抓不到最后一条 | 最后一条用户消息必在末端 DOM；抓不到时横条隐藏，不报错 |
| 富文本/markdown 清洗不干净 | 只做保守清洗（去行首符号、折叠空白），保留可读文字即可 |
| 浮层遮挡其他插件 | 不用浮层：注册进 input.dock 走文档流，由官方布局依次排列；实测与任务条零重叠（任务条 668~704、横条 730~764） |
| observer 误触发/性能 | 防抖（rAF 合并）；disposer 中断 observer |
| 与既有 header-title 全局变量串扰 | 横条完全独立 DOM/CSS，不复用 `--enkeep-dir-prefix` |
| 页面结构升级导致选择器失效 | 选择器集中在 `scan()` 一处，失效时横条隐藏（优雅降级），不抛错 |

---

## 7. 验收清单（最终）

- [ ] 横条显示当前会话最后一条用户消息的纯文本（2 行内、有「上一条指令」标签）
- [ ] 横条在 input.dock 文档流内，与任务条/git chip 零重叠，位于输入框上方最贴近处，宽度对齐 composer 卡片
- [ ] hover 显示「复制」按钮，点击复制纯文本并反馈"已复制"
- [ ] 新增消息 / 删除消息 / 切换会话 → 横条即时刷新
- [ ] 无用户消息时横条隐藏、不占位
- [ ] 既有功能零回归；无启动报错
- [ ] 哈希一致、线上脚本含新标记、无需重启
- [ ] 提交推送后 HEAD == origin/main、工作区干净
