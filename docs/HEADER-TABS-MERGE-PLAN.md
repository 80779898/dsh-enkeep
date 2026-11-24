# 顶部标题栏「对话 / 轨迹」tab 嵌入标题行 —— 开发计划

> 状态：**已实施（2026-11-21）** —— 4 步全部完成并通过真实页面回归，见 §9 实施记录
> 原文只规划步骤与内容（功能 + 技术），不含时间安排
> 落点：写在我们自己的 `dsh-enkeep` 插件（`client.js`，纯前端），**不改任何 DSH 核心源码、不改其他插件**
> 目标：把当前 header 的上下两行合并为一行——tabs 嵌入标题后面，"标准模式/后台任务"等自然后移，
> header 高度从 76px 压到 48px，下方消息区上移 28px。
> 决策演变：最初想"用目录:会话名替换'对话'二字"（tab label 由官方 slot 注册时写死，插件无法覆盖），
> 改为用户新方案"把两个 tab 整体嵌入标题后面"——tab 文字保持"对话/轨迹"不变，只改位置。

---

## 1. 目标与用户诉求

### 1.1 诉求
- 现状：顶部 header 占 76px，分两行：
  - 上排 `titleRow`（y=10~40）：标题 crumb + "标准模式" + "后台任务数" + 右侧工具按钮
  - 下排 `tabs`（y=50~75）：「对话」「轨迹」两个 tab
- 需求：合并成一行更紧凑；把「对话/轨迹」两个 tab 放到**标题后面**，其余内容自然后移。

### 1.2 价值
- header 省 28px，消息可视区更大。
- 布局符合"标题即导航"的直觉，减少视觉分层。

### 1.3 已确认的产品决策
1. tab 文字不变（"对话"/"轨迹"），只改位置。
2. tabs 紧跟当前会话标题的右边缘。
3. 标题后的"标准模式/后台任务/工具按钮"依次后移，不遮挡、不重叠。
4. header 高度压缩到 48px，下方消息区整体上移。
5. 用户约束：**不重启 dsh web**，手动刷新验证。

---

## 2. 现状调研（已确认事实，本机 DSH 0.2.1-rc.2）

### 2.1 header DOM 结构（真实页面实测）
- `<header class="wSkVaW_header">`：`display:grid`，高 76px，x=280 w=1120
  - 子节点 `headerLeading`（w=0）
  - 一个 `display:contents` 包装下有两个**兄弟**节点：
    - `titleRow`（y=10 h=30 w=1072）：
      - `titleCluster` → `crumbCurrent`（标题，x=300 w=207，带 `::before` 目录前缀）
      - `headerActions`（x=517 w=228，含"标准模式" + "1 个后台任务运行中"）
      - `headerUtilities`（x=1273 w=79）、`headerCorner`（x=1360 w=28）
    - `tabs`（y=50 h=25 w=1072，`role="tablist"`，`gap:36px`）：
      - tab「对话」（x=308 w=26，`role="tab"`）、tab「轨迹」（x=370 w=26）
- **tabs 与 titleRow 是兄弟**，可在 CSS 层分别定位，**无需搬动 DOM、无需改 React 结构**。

### 2.2 tab label 不可覆盖（为何不改文字）
- 「对话」「轨迹」来自 `conversation.view` slot 注册项的 `label: () => t("view.chat")` / `t("view.trajectory")`，
  由官方 `dsh-client-ui-chat` / `dsh-client-ui-trajectory` 在注册时写死。
- 插件不能修改别的插件的 slot entry options，运行时也不可变 → 排除"替换 tab 文字"方案。
- 轨迹 tab 受 `developerTools.enabled` 开关控制（源码 `dsh-client-ui-conversation` 的 `viewTabs()`），关闭时 tab 消失 → tabs 宽度会变。

### 2.3 可复用的现有机制（HeaderTitle + HEADER_CSS）
- `HEADER_CSS` 用稳定结构选择器定位当前标题 crumb，**不依赖哈希 class**：
  `HDR_CRUMB = 'span:has(+ [data-slot="conversation.session.header.lineage"])'`
- `HeaderTitle` 注册在 `conversation.session.header.actions`（**list 插槽、空渲染**），只为拿到
  `useSessions`/`sessionId`，把目录前缀写入 `--enkeep-dir-prefix`（`content:var()` 需 `JSON.stringify` 的带引号字符串）。
- 本次复用同一组件/同一 slot：额外测量 crumb 右边缘与 tabs 宽度，写入新的位置变量（如 `--enkeep-tabs-left` / `--enkeep-tabs-shift`）。
- 已知局限（现有前缀同款）：CSS 变量是全局的，分屏不同工作区时后挂载的覆盖前者；本次沿用，不扩大。

### 2.4 只读 CSS 原型验证（临时注入，未落盘，已清理）
用 puppeteer 注入临时 CSS（**未改任何文件**），实测：
- `header{height:48px!important;min-height:48px!important}` → header 76→48px，`body`/`scrollBody` 从 y=76 上移到 y=48 ✓
- `tabs{position:absolute;top:12px;left:225px}` → tabs 到 x=505 y=22，紧跟标题（标题右边缘 x=507）✓
- `headerActions{margin-left:130px}` → actions 从 x=517 后移到 x=647，与 tabs（右边缘 601）零重叠 ✓
- 标题 / actions / utilities / corner 结构与宽度保持正常，无横向溢出 ✓
- **原型局限**：`left:225px` / `margin-left:130px` 是固定值——标题变长会被压、轨迹 tab 隐藏时后推量不自适应。
  正式实现必须改为**动态测量 + CSS 变量驱动**。
- **⚠️ 坐标基准（实测，务必遵守）**：`getBoundingClientRect().right` 是**视口坐标**，而 tabs 绝对定位的包含块是
  `.wSkVaW_root`（`position:relative`，left=280），CSS `left` 是**相对包含块坐标**。实测：crumb 右边缘视口值
  =507.25，直接赋给 `left` → tabs 实际 x=787.25（偏右 280px）；必须减去包含块 left（507.25−280=227.25）才得到
  正确的 x=507.25。因此测量写入变量前须做转换：`left = crumb.right - header.left - paddingLeft(header)`。
  **⚠️ 实施时又踩一层坑（已修正）**：CSS 绝对定位的 `left` 相对包含块的 **padding box**，而 header 有
  `padding-left:20px`，若只减 header.left（不减 padding）仍偏右 20px（实测 tabs x=527、gap=20）。
  最终公式：`left = crumb.getBoundingClientRect().right - header.getBoundingClientRect().left - parseFloat(getComputedStyle(header).paddingLeft)`。

### 2.5 风险（如实记录）
1. **动态位置**：标题长度随会话名/目录变化，tabs 落点必须实时跟随；固定像素会压字。
2. **坐标基准**：视口坐标 ≠ 相对包含块坐标，测量后须减去包含块 left（§2.4 有实测数据），否则 tabs 偏右 280px。
3. **tab 数量变化**：轨迹 tab 显隐导致 tabs 宽度变化，后推量要自适应。
4. **交互控件**：tabs 是 `role=tab` 交互元素；actions 里"标准模式"是下拉、"后台任务"是可点触发器——位移后点击命中与浮层锚点要验证。
5. **哈希类名**：`wSkVaW_*` 是构建生成的，升级可能变；用 `[role="tablist"]` 和 `[class*="headerActions"]` 等语义/片段选择器缓解。
6. **CSS 变量时机**：测量须在 DOM 渲染后（`useLayoutEffect` + `requestAnimationFrame`），标题异步变化用 `ResizeObserver` 兜底。
7. **不重启约束**：只改 `client.js`，用户手动刷新生效；不碰 web 进程。

---

## 3. 技术方案总览

```
client.js（唯一改动文件）
 ├─ 扩展 HeaderTitle（仍空渲染，复用 actions-slot 拿 useSessions/sessionId）：
 │    useLayoutEffect + requestAnimationFrame + ResizeObserver 监听 crumb 尺寸，
 │    测量 crumb 右边缘 − 包含块 left（坐标转换，见 §2.4）→ 写 --enkeep-tabs-left（px）
 │    测量 [role="tablist"] 宽度        → 写 --enkeep-tabs-shift（px，含间距）
 │    disposer 断开 observer + removeProperty。
 ├─ 新增 installCompactHeaderStyle()：style[data-plugin-css="enkeep-header-compact"]
 │    - header 高度压到 48px（height + min-height:48px!important 覆盖官方）
 │    - [role="tablist"] 绝对定位：top:12px; left:var(--enkeep-tabs-left, <fallback>)
 │    - [class*="headerActions"]：margin-left:var(--enkeep-tabs-shift, <fallback>)
 │    - 选择器限定在 header 容器内，不写裸全局。
 └─ 复用现有 installHeaderStyle()（crumb 16px + 前缀），无需改动。
```

- **技术**：CSS 变量驱动布局（JS 测量 → CSS 消费）+ 稳定语义选择器 + ResizeObserver。
- **零新增依赖、零构建、不改官方代码、不碰任何 single slot、不写宽度变量**（只写自有 `--enkeep-*` 位置变量）。
- **回退**：CSS 变量提供 fallback，测量失败时 tabs 落在默认位置，布局不崩。

---

## 4. 实施步骤

### 步骤一：测量驱动——动态写入 tab 位置变量

**功能**
- 实时测量当前标题 crumb 的右边缘 + tabs 的实际宽度，写入 CSS 变量，供 CSS 定位使用。

**技术**
- 扩展现有 `HeaderTitle`（保持空渲染、仍挂在 `conversation.session.header.actions` list slot）。
- `useLayoutEffect` 内 `requestAnimationFrame` 测量；`ResizeObserver` 监听 crumb 与 tablist 尺寸变化。
- **坐标转换**：`--enkeep-tabs-left` 必须用 `crumb.getBoundingClientRect().right - header.getBoundingClientRect().left - parseFloat(getComputedStyle(header).paddingLeft)`
  （相对包含块 padding box，见 §2.4），不能直接用视口坐标（偏 280px）也不能漏减 padding（偏 20px）。
- 写 `--enkeep-tabs-left` / `--enkeep-tabs-shift` 到 `document.documentElement.style`（`setProperty`，值带 `px`）。
- 返回 disposer：断开 observer、取消 pending rAF、`removeProperty`。

**完成定义**
- 切换会话、标题变化、轨迹 tab 显隐时，两个变量随之更新；无内存泄漏。

**验收标准**
- 静态：有 rAF/observer 且 disposer 完整断开；变量值为合法 px 字符串；`--enkeep-tabs-left` 计算含「减去包含块 left」（非裸视口坐标）；不写任何 `--dsh-*` 宽度变量。
- 动态（真实页面）：新会话（无标题）→ 变量指向 crumb 右边缘；有标题（含前缀）→ 指向标题后；隐藏轨迹 tab → shift 变量变小。
- 切会话后变量更新无可见延迟（≤1 帧）；刷新页面无残留旧变量报错。

### 步骤二：CSS 布局改造——压高 + 嵌入 + 后推

**功能**
- header 76→48px；tabs 嵌入标题后；actions / 工具按钮后移；消息区上移。

**技术**
- 新增 `installCompactHeaderStyle()`（`style[data-plugin-css]` 幂等 + disposer 移除）。
- `[role="tablist"]` 绝对定位到 `left:var(--enkeep-tabs-left)`；`[class*="headerActions"]` 用 `margin-left:var(--enkeep-tabs-shift)` 后推。
- 变量带 fallback 值。

**完成定义**
- 真实页面呈现"标题 → tabs → 标准模式/后台任务 → 工具按钮"的单行排列，header 48px。

**验收标准**
- 几何：header 高 48±2px；`body`/`scrollBody` 起点 y=48；tabs 左边缘与 crumb 右边缘间距 ≤8px；tabs 与 actions 零重叠；actions 与 utilities 零重叠；无横向溢出（所有元素 right ≤ 视口宽）。
- 多状态：短标题、长标题、新会话（无标题）、轨迹 tab 隐藏——四种状态下均不重叠、不压字。
- 既有功能不受影响：header 前缀仍显示、crumb 16px 字号不变、消息区 / `input.dock` / 上一条指令横条位置正常。

### 步骤三：交互回归验证

**功能**
- 确认位移后所有交互控件正常可用。

**技术**
- puppeteer 自动化点击 + 真实页面手动验证；**不重启 dsh web**。

**完成定义**
- tab 切换、下拉浮层、触发器、键盘导航全部正常。

**验收标准**
- 点击「对话」/「轨迹」tab 能正确切换视图，选中态高亮跟随。
- "标准模式"下拉正常弹出，浮层定位在触发按钮附近（不跑到旧位置）。
- "后台任务"触发器点击正常。
- tablist 上 Tab / 方向键键盘导航正常。
- 页面无 JS 报错（`pageerror` 为空）。

### 步骤四：文档、同步与交付

**功能**
- 更新文档状态与实测数据，同步安装副本，提交推送。

**技术**
- git + `Get-FileHash` 哈希校验 + 文档编辑。

**完成定义**
- `client.js` 与安装副本哈希一致；`HEAD == origin/main`；工作区干净。

**验收标准**
- `node --check client.js` 通过。
- 安装副本 `.../profiles/web/node_modules/dsh-enkeep/client.js` 与仓库 `client.js` SHA256 一致。
- 本文状态改为"已实施"，补齐实测几何数据。
- `HEAD == origin/main`，`git status --porcelain` 为空。
- 依赖 URL 仍为 `git+https://github.com/80779898/dsh-enkeep.git`（**无 `#SHA`**）。
- 未重启 dsh web。

---

## 5. 成功标准（总验收）

1. header 从 76px 压到 48px，消息区上移 28px，布局不崩。
2. tabs 紧跟标题后面；标准模式 / 后台任务 / 工具按钮依次后移，零重叠、无横向溢出。
3. 标题长度变化、轨迹 tab 显隐时布局自适应。
4. 所有交互（tab 切换、下拉、触发器、键盘导航）正常，无 JS 报错。
5. 不改 DSH 核心、不改其他插件、不碰 single slot、零新增依赖、零构建、不重启 web。
6. 哈希一致、提交推送完成、文档同步。

---

## 6. 回退方案

- **交互验证失败（步骤三不通过）**：只回退 CSS 改造（步骤二），保留测量驱动（步骤一）无害；或直接移除 `enkeep-header-compact` 样式，header 恢复原生两行。
- **哈希类名升级导致选择器失效**：更新 `[class*="headerActions"]` 等语义片段；tabs 的 `[role="tablist"]` 不受影响。
- **布局异常**：移除位置变量后 CSS fallback 生效，tabs 回到默认位置，不至于遮挡。

---

## 7. 约束（明确不做）

- 不替换 tab 文字（官方 slot 注册时写死，插件不可覆盖）。
- 不改 tab 的 React 组件结构、不搬 DOM。
- 不改 header 以外区域、不动 composer / input.dock。
- 不引入依赖、不构建、不重启 dsh web、不发 `dsh-ui` 围栏。
- 不写宽度变量（只写自有 `--enkeep-*` 位置变量）。

---

## 8. 待确认事项（开工前）

1. `headerActions` 的稳定选择器：优先 `[class*="headerActions"]`（语义片段抗哈希前缀变化）；若升级后语义后缀也变，需同步更新。开工时再实测确认一次。
2. 压缩 header 高度是否影响其他注入 header 的插件（如 agent-preset / jobs 的 actions 项）——步骤二需在真实页面扫一遍 actions 带内容。

---

## 9. 实施记录（2026-11-21）

### 9.1 改动清单（仅 `client.js`）
- `HeaderTitle`：新增 `useLayoutEffect` 布局驱动——`requestAnimationFrame` + `ResizeObserver`(tabs/header) +
  `MutationObserver`(crumb 文本) 测量并写 `--enkeep-tabs-left` / `--enkeep-tabs-shift`；完整 disposer 断开观察、
  取消 rAF、清变量。**只读官方 DOM，不写 React 节点**。
- 新增 `COMPACT_HEADER_STYLE_ID = 'enkeep-header-compact'` + `installCompactHeaderStyle()`：
  `header:has([data-slot=...lineage]){position:relative;height:48px;min-height:48px}`、
  `tablist{position:absolute;top:12px;left:var(--enkeep-tabs-left,235px);z-index:5}`、
  `headerActions{margin-left:var(--enkeep-tabs-shift,150px)}`——全部限定在会话 header 内。
  （fallback 值随 9.5 间距调整同步更新。）
- header effect 安装/注销 compact 样式，disposer 一并清 `--enkeep-dir-prefix` / `--enkeep-tabs-left` / `--enkeep-tabs-shift`。

### 9.2 实测几何（1400×900，真实页面）
| 项目 | 原（两行） | 实施后（单行） |
|---|---|---|
| header 高 | 76px | **48px** |
| body / scrollBody 起点 y | 76 | **48**（上移 28px） |
| 标题 crumb | x=300 right=507 | 原位（x=300 right=507） |
| 对话/轨迹 tabs | 下排 y=50 x=308 | **x=535（标题右缘后 36px）** y=22 |
| 标准模式/后台任务 actions | x=517 | **x=667**（tabs 后 36px） |
| 工具按钮 / 角落 | x=1273 / 1360 | 原位 |
| `--enkeep-tabs-left` | — | **235px**（=507−280−20+28，见 9.5） |
| `--enkeep-tabs-shift` | — | **150px**（tab 跨度 88 + 34 + 28） |

### 9.3 踩坑与修正（2 处，均已修）
1. **坐标基准（规划期已预见）**：视口坐标 ≠ 相对包含块坐标，直接赋值偏右 280px——已减 header.left。
2. **padding box（实施期新踩）**：header `padding-left:20px`，CSS 绝对 `left` 相对 padding box，只减 header.left 仍偏 20px（tabs x=527、gap=20）——已再减 padding-left，最终 gap=0（标题右缘到 tab 容器，容器 padding-left:8px 即文字间隙）。
3. **隐藏 tab 负 span**：轨迹 tab `display:none` 时零宽 rect 使跨度变负（shift=-481px、actions 跑到 x=36）——已过滤零宽 tab，隐藏后 shift=90px、actions 到 x=605（自适应，间距恒定）。
4. **间距不协调（用户反馈）**：初版标题→对话仅 8px（tab 容器 padding-left），而对话→轨迹是官方 36px——已读取 `columnGap`(36) 与 `tabPadLeft`(8) 算 `lead=28`，left/shift 各 +28px，三处间距统一为 36px（见 9.5）。

### 9.4 验收结果（全部通过）
- 几何：header 48px、body y=48、三处间距统一 36px（见 9.5）、零重叠、无横向溢出。
- 多状态：短标题 ✓ / 长标题动态跟随 ✓ /
  空白新会话（blank header 40px、无 lineage → 选择器不匹配、样式不生效、vars 清空、无报错）✓ /
  轨迹 tab 隐藏（shift 自适应，间距恒定）✓。
- 交互：tab 点击切换正常（active 态与 chatFlow 同步）、后台任务触发器浮层锚定跟随（x≈715 浮层在按钮 x=791 下方）、
  无 JS 报错。**注**：点"标准模式" text label 不弹菜单是控件原生行为（对照实验：移除本样式后点击同样不弹），与本改动无关。
- 既有功能回归：header 前缀 `.dsh: `+16px、上一条指令横条（y=730~764）、会话列表 5 按钮、composer 输入框、提示词行位置均不变。
- 约束：零新增依赖、零构建、未改官方代码/single slot、未写宽度变量、**未重启 dsh web**。

### 9.5 间距对齐（用户反馈，2026-11-21）
- **问题**：初版标题→对话只有 8px（tab 容器 `padding-left`），而对话→轨迹是官方 `column-gap:36px`，不协调。
- **改法**：测量时读 `getComputedStyle(tabs).columnGap`(36) 与 `paddingLeft`(8)，`lead = max(0, 36−8) = 28`；
  `left` 与 `shift` 各 `+lead`。不硬编码 28——跟随官方 gap 动态变化。
- **实测（1400×900）**：标题 crumb right=507 → 对话 x=543（**36px**）、对话 right=569 → 轨迹 x=605（**36px**）、
  轨迹 right=631 → actions x=667（**36px**）；变量 left=235px、shift=150px。三处间距统一为 36px。
