# 输入框上方「上一条指令」固定横条 —— 开发计划

> 状态：**已实施**（位置经一次调整：由"消息区顶部"改为"输入框上沿"，见 §1.2）。
> 目标产物：在官方「对话」tab 的**输入框正上方**，固定显示"我最后一次对 AI 助手说的话"，
> 让回答很长、会话很久之后，仍一眼能看到"我上次的要求是什么"。

---

## 1. 目标与用户诉求

### 1.1 诉求
- 场景：AI 回答很长，会话滚动很远之后，用户忘记"我上次让 AI 做什么"。
- 需求：在**官方「对话」tab 里**，做一个**固定横条**，显示**最后一次用户自己发送给 AI 助手的内容**。
- 价值：随时抬头就能看到"上一条指令"，知道 AI 正在围绕什么工作。

### 1.2 已确认的产品决策（用户拍板）
1. **位置**：**紧贴输入框上沿**（横条底边 = 输入框顶边），滚动消息时固定不动。
   - 变更记录：初版放"消息区顶部"，用户改为"放输入框上面、最贴近输入框"。
   - **"真实占位把输入框顶下去"经实测不可行**：官方 composer 是固定高度贴底布局，改 padding/margin 输入框 y 纹丝不动，往 `conversation.input.dock` 注入真实 DOM 也不参与布局流（详见 §2.5）。故采用浮层方案 absolute 锚定输入框顶边（`bottom` 定位，1~2 行都自适应贴合），不改官方布局。
2. **内容**：清洗后的**纯文本** + **最多 2 行** + 前面一个「上一条指令」小标签；超长末尾省略。
3. **交互**：**纯展示，不可点击**（不做跳转/高亮原消息）。理由：跳转要操作 chat 滚动、和虚拟滚动打架，收益低、风险高。

### 2.5 位置方案实测（为何不能用"真实占位顶下去"）
- 输入框（contenteditable `.uV2eYG_input`）：x=309 y=776 w=1052 h=36；提示词行（dock）y=866（在输入框**下方**，中间隔工具栏）。
- 消息滚动区 scrollBody：y=76~768；composer 卡片 root：x=280 y=768 w=1113 h=132（贴底 bottom=900）。
- 6 组 CSS 实验结论：
  - `composerSeat/Stack{padding-top:44px}` → seat/stack 变高但**输入框 y=776 不动**（内部 flex 吃掉空区）。
  - `scrollBody{margin-bottom:44px}` → 输入框**上移**至 y=732、底部留白，布局被破坏。
  - 往 `conversation.input.dock` slot 注入真实 DOM（probe h=40）→ 输入框**仍 y=776**（该 slot 是浮层，不参与布局流）。
- 结论：无 slot / 纯 CSS 能在输入框上方挤一行并下推输入框；硬改官方固定高度脆弱且违背"不改官方"约束。采用浮层锚定输入框顶边（§1.2）。

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
  所以**绝不能**用 `appendChild` 把横条塞进这条链——React 重渲染会把它冲掉。横条 DOM 必须像活动区一样，
  通过 React 渲染进 `shell.overlay`（该 slot 的子节点由我们自己的 React 组件持有，不被官方重绘冲掉），
  再用 `position:absolute` + `bottom` 锚定到输入框顶边。MutationObserver **只读**文本、写入 React state，不直接改官方 DOM。

### 2.4 风险（如实记录）
1. **虚拟滚动**：超长会话只有视口附近的节点在 DOM。但"最后一条用户消息"位于对话末端、必然在 DOM 中，风险小。
2. **文本提取**：用户消息可能含 markdown、@引用、命令、代码块、换行；需清洗为可读纯文本。
3. **固定定位**：横条渲染在 `shell.overlay`（React 组件），用 `position:absolute` + `bottom` 锚定输入框顶边（横条 bottom = 输入框 top，实测 776=776）；不在滚动容器内，天然"滚动时不动"。锚点取 `[data-slot="conversation.composer.bar"]` 的首元素（卡片 rect 给 left/width）+ 其中 `[contenteditable]` 的 top；窗口缩放/observer 触发时重测。
4. **实时性**：新消息发出、切会话、清空历史时都要即时刷新；observer 只更新 React state，不碰官方 DOM。
5. **React 重绘**：横条自身由 React 组件持有（在 shell.overlay），不受官方消息列表重绘影响；这是选 overlay 而非注入消息区的原因。

---

## 3. 技术方案总览

```
client.js（唯一改动文件）
 ├─ 新增 React 组件 LastPromptBar({ text, visible, left, width })：横条 UI（标签 + 正文 2 行），
 │   由 ActivityBar 所在的 shell.overlay 注册一并渲染（在 overlay 的组件树里加一个
 │   <LastPromptBar .../>，不新开 slot、不碰官方 slot）。
 └─ effect "enkeep: last prompt bar"（新增，第 8 个）
     ├─ 安装 CSS（style[data-plugin-css=enkeep-lastprompt]，幂等 + disposer 清理）
     ├─ 启动 MutationObserver：监听 body 子树（消息区是 React 动态挂载的，observer 挂 body 最稳）
     │    └─ scan()：查 [data-chat-flow-kind="user"] 最后一个 → 清洗文本 → 写 React state
     │               无节点 → visible=false；有会话切换导致的 DOM 换血 → 重新 scan
     ├─ 定位测量：读 composer.bar 首元素 rect（left/width）+ 其中 [contenteditable] 的 top
     │    → 写横条的 left/bottom/width state（bottom=视口高 - 输入框 top）；window resize / observer 时重测
     └─ disposer：断开 observer、移除 resize 监听、清 state（组件随 overlay 卸载自然清理）
```

- **技术**：React 组件（`shell.overlay` 渲染，复用活动区已有的注入点）+ 原生 DOM API（`MutationObserver` 只读、`getBoundingClientRect`）+ CSS（`position:absolute` + token 变量）。
- **关键**：横条 DOM 由**我们自己的 React 组件**持有，绝不用 `appendChild` 注入官方 React 子树（会被重绘冲掉）；observer 只读不写官方 DOM。
- **零新增依赖、零构建、不改官方代码、不碰任何 single slot、不写宽度变量**。
- **纯净文本提取**：取节点 `innerText`/文本节点，去除 markdown 标记（`#`、`` ` ``、`**`、`- ` 等行首符号）、`@提及`、`/命令` 前缀，折叠空白，限 2 行（CSS `-webkit-line-clamp:2`）。

---

## 4. 实施步骤（每步内容 + 验收 + 成功标准）

### 步骤一：静态骨架 —— CSS + React 组件 + effect 生命周期

**内容**
- 在 `ACTIVITY_CSS`/独立常量区新增 `LASTPROMPT_STYLE_ID='enkeep-lastprompt'` 与 `LASTPROMPT_CSS`：
  - 横条容器：`[data-enkeep-lastprompt]`，absolute + bottom 锚定输入框顶边、宽度对齐 composer 卡片、带标签与正文区、正文 2 行省略、细下边框、半透明底。
  - 颜色/圆角/字号一律用 `--dsw-alias-*` / `--dsw-radius-*` token，不用 hash class、不用裸全局选择器。
- 新增 React 组件 `LastPromptBar({ text, visible, left, width })`：纯展示横条；在既有 `ActivityBar` 所在的 `shell.overlay` 注册组件树里挂载它（复用活动区注入点，**不新开 slot、不动官方 slot**）。
- 新增 `installLastPromptStyle()`（幂等，`style[data-plugin-css]` 去重，返回 disposer）。
- 新增 effect `enkeep: last prompt bar`：仅安装样式 + 返回 disposer（移除样式）；横条 UI 由 overlay 组件渲染，state 由步骤二的 observer 驱动。
- 横条初始 `visible=false`（没有用户消息时不显示，避免空条占位）。

**验收**
- `node --check client.js` 通过。
- mock（无 DOM 环境）加载插件：7 个既有 effect + 1 个新 effect 全部执行、无 throw。
- 真实页面：刷新后 `style[data-plugin-css="enkeep-lastprompt"]` 存在、`[data-enkeep-lastprompt]` 节点存在但隐藏；无报错。
- 确认横条渲染在 `shell.overlay` 子树下（与活动区同级），不在 `conversation.chat.flow` 的 React 子树里。

**成功标准**：样式与组件能被安装/渲染/清理，空态不显示、不被官方重绘冲掉；既有 7 个 effect 无回归。

### 步骤二：DOM 观察 + 文本提取 + 实时更新

**内容**
- 创建 `MutationObserver` 观察 `document.body` 子树（`childList + subtree`；消息区 React 动态挂载，挂 body 最稳，不必等 `[data-slot="conversation.chat.flow"]` 出现）。
- `scan()` 逻辑（只读 DOM）：
  - `const nodes = document.querySelectorAll('[data-slot="conversation.chat.flow"] [data-chat-flow-kind="user"]')`
  - 取最后一个节点 → 提取文本（`innerText` → 清洗 markdown/@引用/命令前缀 → 折叠空白）→ 写入 React state（`text`）。
  - 无节点 → `visible=false`（隐藏）；有节点 → `visible=true`。
  - 顺带测量 composer 卡片位置与输入框顶边 → 写入 `left`/`bottom`/`width` state（见步骤三）。
- 触发时机：observer 回调防抖（`requestAnimationFrame` 合并）；初次挂载立即 `scan()` 一次。
- 切会话：DOM 整体替换触发 observer，重新 `scan()` 覆盖。
- **observer 只读、只写自己的 React state，绝不 `appendChild`/改官方 DOM 属性**。

**验收**
- mock：构造含 3 个 user 节点的 DOM → 横条 state.text 等于第 3 个的清洗文本、visible=true。
- mock：新增第 4 个 → 更新为第 4 个；移除最后一个 → 回退到上一个；全部移除 → visible=false。
- mock：文本含 `#标题`、`**粗体**`、`@文件`、`/命令`、多行 → 清洗后无这些符号、空白折叠。
- 真实页面：当前会话横条显示最近一条用户指令（与 DOM 最后一个 `[data-chat-flow-kind="user"]` 一致）。
- 回归：发送消息后横条即时更新；切到空白会话横条隐藏、无残留。

**成功标准**：横条文本恒等于"当前会话最后一条用户消息的纯文本"，新增/删除/切会话即时刷新，全程不改官方 DOM。

### 步骤三：锚定输入框 + 宽度对齐 + 视觉打磨

**内容**
- 横条由 shell.overlay 的 React 组件渲染，用 `position:absolute` + `bottom` 定位；在 `scan()` 里读
  `[data-slot="conversation.composer.bar"]` 首元素 rect（left/width）与其中 `[contenteditable]` 的 top，
  算出 `left`/`bottom`/`width`（bottom=视口高−输入框top）写入组件 state；`window.resize` / observer 时重测。
  因不在滚动容器内，天然"滚动时不动"，且横条底边紧贴输入框顶边。
- 宽度与 composer 卡片对齐：直接取 `[data-slot="conversation.composer.bar"]` 首元素的 rect（left/width），不写任何宽度变量。
- 视觉：标签「上一条指令」小字弱化 + 正文 2 行省略 + 细下边框 + 半透明背景；不遮挡消息、不遮挡输入框。

**验收**
- 真实页面：滚动消息列表，横条位置保持不动。
- 横条左右边缘与 composer 卡片对齐、横条 bottom == 输入框 top（用脚本量 `getBoundingClientRect`，实测 776=776）。
- 遮挡检查：不盖住输入框、不盖住标题栏、不与活动区浮动条重叠。

**成功标准**：固定不动、宽度对齐、视觉协调、零遮挡。

### 步骤四：全面回归 + 发布

**内容**
- `node --check client.js`（源码 + 安装副本）。
- mock 回归：7 个既有 effect（宽度/活动区/标题/设置/composer dock/common words/git-panel 等）+ 新 effect 全部 OK、无 throw。
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
| 固定定位遮挡消息/输入框 | 锚定输入框顶边（bottom=视口高−输入框top）、限高 2 行、细边框；实测横条 bottom == 输入框 top（776=776），零重叠 |
| observer 误触发/性能 | 防抖（rAF 合并）；disposer 中断 observer |
| 与既有 header-title 全局变量串扰 | 横条完全独立 DOM/CSS，不复用 `--enkeep-dir-prefix` |
| 页面结构升级导致选择器失效 | 选择器集中在 `scan()` 一处，失效时横条隐藏（优雅降级），不抛错 |

---

## 7. 验收清单（最终）

- [ ] 横条显示当前会话最后一条用户消息的纯文本（2 行内、有「上一条指令」标签）
- [ ] 消息滚动时横条固定不动，紧贴输入框上沿（bottom==输入框top），宽度对齐 composer 卡片，无遮挡
- [ ] 新增消息 / 删除消息 / 切换会话 → 横条即时刷新
- [ ] 无用户消息时横条隐藏、不占位
- [ ] 既有功能零回归；无启动报错
- [ ] 哈希一致、线上脚本含新标记、无需重启
- [ ] 提交推送后 HEAD == origin/main、工作区干净
