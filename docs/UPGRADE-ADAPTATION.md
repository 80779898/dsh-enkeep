# dsh-enkeep 插件改动全档案 & 主程序升级适配指南

> 目的：完整记录本插件对 Web GUI 的**所有改动点、位置、目的/效果、依赖的官方锚点**，
> 以及**主程序（DSH）升级后如何快速核验是否失效、失效了改哪里**。
> 运行环境基线：DSH `0.2.1-rc.2` / Web GUI `http://127.0.0.1:3080`。
> 唯一改动文件：`client.js`（安装副本 `C:\Users\mason\.dsh\profiles\web\node_modules\dsh-enkeep\client.js`，
> 必须与仓库副本 SHA256 一致）。`index.js` / `package.json` / `cordis.patch.yml` 未改。
> 零新增 npm 依赖、零构建、不改 DSH 核心、不碰任何 single slot、只**读取**宽度变量。

---

## 0. 怎么用这份文档（升级后的操作流程）

主程序升级后，按此顺序操作：

1. **跑第 5 节的「升级自检」**——一段浏览器控制台脚本，逐项检测每个官方锚点是否还在、样式是否生效、间距是否正确。
2. **对照第 2 节的锚点表**——自检报红的项，找到它依赖的官方锚点，看是「选择器变了」「slot 改名/改类型」还是「CSS 变量名变了」。
3. **按第 3 节每个功能的「失效症状 → 修复指引」**改 `client.js` 对应区块。
4. **复用第 4 节的原则**：优先语义钩子（`data-slot` / `role` / `--dsh-*` 变量），最后才用 hash class 片段（`[class*="xxx"]`）。
5. **验证**：`node --check client.js` → 同步安装副本 → 哈希一致 → 刷新页面 → 重跑自检 → 提交推送。

> ⚠️ 硬约束（任何升级适配都必须保持）：**不重启 dsh web**（用户手动刷新）；
> 依赖 URL 保持 `git+https://github.com/80779898/dsh-enkeep.git`（**无 `#SHA`**）；
> 哈希 parity 必须为真。

---

## 1. 架构总览：插件用了哪些官方机制

```
client.js  window.__ModuleLoader__.load({ id:'dsh-enkeep', factory })
  ├─ 8 套样式注入（install*Style → <style data-plugin-css="enkeep-*">，幂等 + disposer）
  │    enkeep-wide / enkeep-activity / enkeep-lastprompt / enkeep-current /
  │    enkeep-header / enkeep-header-compact / enkeep-words / enkeep-gitpanel-split
  ├─ 8 个 ctx.effect（宽度、gitpanel 分隔、活动条、上一条指令、header 标题、composer dock、常用词）
  └─ slot 注入（全部 additive/list 或 overlay，绝不碰 single）：
       shell.overlay / conversation.input.dock / conversation.session.header.actions /
       conversation.composer.dock / conversation.input.right /
       settings.section / main / sidebar.panellist / plugins.detail.actions
数据源（只读官方 React hooks / DOM，无自定义 RPC）：
  useSessions (byId: cwd/title/displayTitle/origin/blank/retainedBy.mainView/updatedAt)
  useSessionStatus (running/completionUnread/pendingInteraction) · useWorkspaces · useInput(draft) · inputActions
  DOM: [data-chat-flow-kind="user"] / [data-clock] / [data-slot=...] / [role=tablist] 等
状态：Host 的易失 Config，经 ctx.configForms.get('enkeep')（无状态文件）。
```

**四条核心原则**（升级适配时务必延续）：
1. **能读官方 CSS 变量就不硬编码**（如 `--dsh-composer-card-max-width`、`--dsh-frame-overlay-top`、`--dsh-sidebar-inline-padding`）。
2. **能用稳定语义钩子就不用 hash class**：`data-slot` / `role` / `data-conversation-content` > `[class*="语义片段"]`（如 `[class*="headerActions"]`）> 精确 hash class（尽量不用）。
3. **样式改动用 `<style>` + `!important` + disposer**，不直接改 React 内联样式、不改官方 DOM 结构。
4. **所有 observer / rAF / 注入都要有 disposer`，幂等安装防重复**。

---

## 2. 改动点总表（升级核验速查）

| # | 功能 | 改动位置 / 样式 ID | 依赖的官方锚点（升级重点核验） | 脆弱度 |
|---|---|---|---|---|
| 1 | 聊天区/输入框等宽 | `enkeep-wide` | `[data-conversation-content]`、`--dsh-conversation-column-width`、`--dsh-chat-content-width`、`--dsh-composer-card-max-width` | 中 |
| 2 | 活动区悬浮条 | `enkeep-activity` + `shell.overlay` slot | `--dsh-frame-overlay-top`、`--dsh-sidebar-inline-padding`、`[data-sidebar-collapsed]`、hooks 字段 | 中高 |
| 3 | 侧栏完全隐藏 | `enkeep-activity` + `--dsh-enkeep-grid-cols` | `.sidebarCol`、`[data-side="sidebar"]`、frame 的 grid 列顺序、`data-slot="shell.bottom"` | 高 |
| 4 | 标题栏目录前缀 + 16px | `enkeep-header` + `conversation.session.header.actions` slot | `[data-slot="conversation.session.header.lineage"]`（结构选择器锚点）、`--enkeep-dir-prefix` | 高 |
| 5 | tabs 嵌入标题行（单行 header） | `enkeep-header-compact` + HeaderTitle 布局驱动 | `header:has([data-slot=...lineage])`、`[role="tablist"]`、`[role="tab"]`、`[class*="headerActions"]`、tabs 的 `column-gap`/`padding-left` | 高 |
| 6 | 上一条指令横条 | `enkeep-lastprompt` + `conversation.input.dock` slot | `[data-slot="conversation.chat.flow"] [data-chat-flow-kind="user"]`、`[data-clock]`、`--dsh-composer-card-max-width` | 中高 |
| 7 | composer dock 宽度对齐 + 圆角 | `enkeep-current` | `[data-composer-dock]`、`[data-composer-card]`、`--dsh-composer-card-max-width` | 中 |
| 8 | 快捷提示词/常用词面板 + skill 快选 | `enkeep-words` + `conversation.composer.dock`/`conversation.input.right` slot | `useInput(draft)`、`inputActions.setDraft`、`/dsh-enkeep-skills` host 路由 | 中 |
| 9 | git 面板拖拽分隔条 | `enkeep-gitpanel-split` | `.dsh-gp`、`.dsh-gp-write`（来自 dsh-git-panel 插件） | 高（外部插件） |
| 10 | 设置页入口 / 中心面板 | `settings.section` / `main` / `plugins.detail.actions` slot | slot 名 + ctx.configForms | 低 |

---

## 3. 逐功能详档

### 功能 1：聊天区 / 输入框等宽（wide 模式）
- **改在哪**：`WIDE_CSS`/`installWideStyle`（约 60–80 行）；`ctx.effect('enkeep: width')`。
- **目的/效果**：去掉原生 920px 上限，让聊天文本列与输入框等宽（用户诉求：二者对齐）。
- **做法**：在 `[data-conversation-content]` 上用 `!important` 覆盖 `--dsh-chat-content-width`，
  再令 `--dsh-composer-card-max-width` 等于它。**注意**：body 级覆盖无效（conversation DIV 自带该变量且 `100%` 在不同包含块解析不同）——这是实测结论，别回退成 body 覆盖。
- **依赖锚点**：语义属性 `[data-conversation-content]` + 官方变量 `--dsh-conversation-column-width` / `--dsh-chat-content-width` / `--dsh-composer-card-max-width`。
- **失效症状**：文本列和输入框又不等宽 / 出现 920px 上限。
- **修复**：若 `[data-conversation-content]` 改名，替换为新的会话内容容器语义钩子；若官方变量改名，更新这三处变量名。仍遵循"在 DIV 上覆盖、不碰 body"。

### 功能 2：活动区悬浮条（常驻会话列表）
- **改在哪**：`ACTIVITY_CSS`/`installActivityStyle`（82–205 行）+ `ActivityBar` 组件 + `shell.overlay` slot 注册（约 2531 行）。
- **目的/效果**：右侧固定位置（right≈1380）常驻显示"最近/运行中/未读"会话，点条目切会话；5 个头部按钮；圆点五态（运行中绿脉冲/等待互动琥珀空心环/完成未读橙/完成已读灰/当前高亮）；支持置顶、重命名、归档、拖拽。
- **做法**：`shell.overlay` 是 click-through，根元素显式 `pointer-events`；定位用 `--dsh-frame-overlay-top`、`--dsh-sidebar-inline-padding`（只读），固定在常量 right，不随侧栏展开/折叠/隐藏横跳。头部按钮统一 22×22 盒/15px SVG。
- **数据源（升级重点）**：`useSessions(s=>s)` 的 `byId`（`cwd`/`title`/`displayTitle`/`origin`/`blank`/`updatedAt`/`retainedBy.mainView`）、`useSessionStatus(s=>s)` 的 `running`/`completionUnread`/`pendingInteraction`。
- **条数上限（可配置）**：`activityItemLimit`（index.js schema 默认 20、1~200、volatile；设置页「活动区」number 输入；`selectActivity` 末参 + `clampItemLimit` 钳制）。**筛选按活动时间窗、排序按 updatedAt 倒序（最近活动在前，Id 字典序兜底）、置顶优先**——排序已由用户拍板改为最近更新优先，升级时不要改回字典序。
- **失效症状**：条不显示 / 位置错乱 / 圆点状态不对 / 点击无效 / 条数上限不生效。
- **修复**：overlay 锚点变了 → 换 slot；状态字段名变了（如 `pendingInteraction`/`completionUnread`）→ 更新 `ActivityBar` 的读取；定位变量变了 → 更新 CSS 的 `var()`。**这些字段是官方内部状态，升级最易变，优先自检**。

### 功能 3：侧栏完全隐藏
- **改在哪**：`[data-enkeep-sidebar-hidden]` 系列 CSS（107–114 行）+ `--dsh-enkeep-grid-cols` 写入（1168 行）+ 组件里的 `frame` 列宽处理（925–1174 行）。
- **目的/效果**：原生收起仍留 56px 图标栏，此功能把侧栏列压到 0；纯声明式（只打 DOM/CSS 标记），不动原生 toggle，刷新后记住用户选择。
- **做法**：从 `shell.bottom` 反查 AppFrame，按稳定语义 `.sidebarCol` 找侧栏列（**不用** `bottom.previousElementSibling`——sb-01 卸载后那会指向 rightbarCol），把 frame 内联 `grid-template-columns` 的**第一列**（纯 px 才动）写成 0，经 `--dsh-enkeep-grid-cols` + `!important` 覆盖，observer 跟随原生重绘重算。
- **失效症状**：隐藏按钮无效 / 隐藏后中栏被误压 / 拖拽手柄没藏住。
- **修复**：**这一项脆弱度最高**。核验 frame 的 grid 列顺序（应 sidebar|center|rightbar）与 `.sidebarCol` 类名是否还在；列顺序或类名变了就更新"定位侧栏列"的语义查找和第一列正则。解析不出列宽就不打标记（宁可不隐藏，勿误伤）。

### 功能 4：标题栏目录前缀 + 16px
- **改在哪**：`HEADER_CSS`/`installHeaderStyle`（335–360 行）+ `HeaderTitle` 组件的 prefix 写入（794–804 行）+ `conversation.session.header.actions` slot（2585 行）。
- **目的/效果**：在原生当前会话标题前加 `工作目录: ` 前缀（如 `.dsh: `），并放大到 16px；祖先 crumb / subagent 链保持原生。
- **做法**：**不注册 lineage slot**（它是 `kind:"single"`，被 `dsh-client-ui-subagent` 占用，二次注册会在启动报 "1 entry did not activate"）。改为注册 additive 的 `header.actions` 空渲染驱动，只为拿 `useSessions`/`sessionId`，写 `--enkeep-dir-prefix`（`content:var()` 需 JSON.stringify 带引号字符串）。CSS 用结构选择器 `HDR_CRUMB = 'span:has(+ [data-slot="conversation.session.header.lineage"])'` 命中当前 crumb。
- **失效症状**：前缀不显示 / 标题没放大 / 启动报错（single slot 冲突）。
- **修复**：`[data-slot="conversation.session.header.lineage"]` 锚点变了 → 更新 `HDR_CRUMB`；**绝不能**因失效而改去注册 lineage slot。空白会话无 lineage → 选择器不匹配属正常。

### 功能 5：tabs 嵌入标题行（单行 header）—— 最新功能
- **改在哪**：`COMPACT_HEADER_CSS`/`installCompactHeaderStyle`（370–395 行）+ `HeaderTitle` 的 `useLayoutEffect` 布局驱动（812–872 行）+ header effect 安装（约 2600 行）。
- **目的/效果**：把原生两行 header（标题行 y≈10 + tab 行 y≈50，共 76px）合并成一行 48px；「对话/轨迹」tab 嵌入标题后，actions/工具按钮依次后移；三处间距统一 36px（标题→对话、对话→轨迹、轨迹→actions）；消息区上移 28px。
- **做法**：
  - CSS：`header:has([data-slot=...lineage]){position:relative;height:48px;min-height:48px}`、
    `[role="tablist"]{position:absolute;left:var(--enkeep-tabs-left,235px)}`、
    `[class*="headerActions"]{margin-left:var(--enkeep-tabs-shift,150px)}`（fallback 值随间距调整同步）。
  - JS 驱动：`requestAnimationFrame` + `ResizeObserver`(tabs/header) + `MutationObserver`(crumb 文本) 测量 →
    写两个变量。**坐标转换关键**：`left = crumb.right − header.left − paddingLeft(header) + lead`；
    `lead = max(0, columnGap − tabPadLeft)`；`shift = tabSpan + 34 + lead`。漏减 padding 会偏 20px，漏减 header.left 偏 280px（都实测踩过）。
  - 过滤零宽 tab（`display:none` 的轨迹 tab 会让 span 变负）。
- **依赖锚点（升级重点）**：`[data-slot=...lineage]`（容器+crumb 定位）、`[role="tablist"]`/`[role="tab"]`（稳定）、`[class*="headerActions"]`（语义片段）、tabs 的 `column-gap`/`padding-left`。
- **失效症状**：tabs 没嵌入（还是两行）/ 位置偏右 280 或 20px / 遮挡标题或 actions / 轨迹隐藏时 actions 跑飞 / 间距不统一。
- **修复**：
  - `:has()` 或 lineage 锚点失效 → 更新 `HDR_CONTAINER`/`HDR_CRUMB`（可考虑改从 `[role="tablist"]` 反查 header）。
  - `[class*="headerActions"]` 语义后缀变了 → 更新片段（用真实页面 grep 确认当前类名）。
  - **坐标基准**：若 header 的 `position`/`padding` 变了，重新实测"视口坐标 vs CSS left"的差值，调整减项。
  - 间距：读 `columnGap`/`paddingLeft` 是动态的，一般不用改；若官方改成 flex `gap` 简写，注意 `columnGap` 仍可读。

### 功能 6：上一条指令横条
- **改在哪**：`LASTPROMPT_CSS`/`installLastPromptStyle`（225–266 行）+ `LastPromptDockBar` 组件（约 920–1010 行）+ `conversation.input.dock` slot（2553 行）。
- **目的/效果**：输入框正上方显示最后一条用户消息（最多 2 行、清洗纯文本），hover 出现「复制」按钮；与 git chip/任务条同处 input.dock 文档流，永不重叠。
- **做法**：注册 additive `conversation.input.dock`（order 200），走文档流（**不是浮层**——浮层会压住任务条）。`MutationObserver` 只读 `[data-slot="conversation.chat.flow"] [data-chat-flow-kind="user"]` 的最后一个，clone 去 `[data-clock]` 后清洗文本。复制用 `navigator.clipboard`+`execCommand` 兜底（含超时兜底），同步捕获 `currentTarget`。
- **失效症状**：横条不显示 / 文本错（含时间戳）/ 遮挡其他插件 / 复制无效。
- **修复**：`data-chat-flow-kind="user"` 标记变了 → 更新选择器（实测确认用户消息节点的稳定标记）；input.dock slot 改名/类型变 → 换 additive slot；宽度对齐变量 `--dsh-composer-card-max-width` 变了 → 更新。

### 功能 7：composer dock 宽度对齐 + 圆角
- **改在哪**：`CURRENT_CSS`/`installCurrentStyle`（273–306 行）。
- **目的/效果**：快捷提示词行与输入卡片等宽（`[data-composer-dock]` 用 `!important` 覆盖，压过官方 `.uV2eYG_dock{max-width:100%}`）；输入卡片圆角对齐主题。
- **依赖锚点**：`[data-composer-dock]`、`[data-composer-card]`、`--dsh-composer-card-max-width`、`--dsw-radius-lg`。
- **失效症状**：提示词行宽度和输入框不一致。
- **修复**：data 钩子变了 → 更新；`!important` 仍保留（官方样式可能在其后注入）。

### 功能 8：快捷提示词 / 常用词面板 + skill 快选
- **改在哪**：`WORDS_STYLE_ID`（397 行）/ `.ekeep-w-*` 样式 + `CommonWords`/`QuickPrompts` 组件 + `conversation.composer.dock`/`conversation.input.right` slot（2625/2649 行）。
- **目的/效果**：输入框下方快捷提示词按钮 + 可展开常用词面板（分类/搜索/收藏），独立 skill 快选 tab（只读拉取已安装 skill 列表）。
- **数据源**：`useInput(draft)`、`inputActions.setDraft`（注入要判空，缺则不可用）；skill 走 host 路由 `GET /dsh-enkeep-skills?cwd=…` + header `x-dsh-enkeep-skills`（在 `index.js` 里提供——**但本轮未改 index.js，说明早已存在**）。
- **失效症状**：提示词按钮不显示 / 点击不填输入框 / skill 列表拉不到。
- **修复**：slot 变了 → 换；`inputActions` 方法名变了 → 更新判空与调用；host 路由变了 → 改 `SKILLS_URL`/`SKILLS_HEADER`（需同步 index.js，属扩展场景）。

### 功能 9：git 面板拖拽分隔条（依赖外部插件）
- **改在哪**：`GITPANEL_CSS`/`installGitPanelStyle`（512–545 行）+ `enkeep-gitpanel-split` effect（2400 行）。
- **目的/效果**：给 dsh-git-panel 的编写区加可拖拽分隔条，宽度记忆。
- **依赖锚点（外部插件，脆弱度最高）**：`.dsh-gp` / `.dsh-gp-write` / `.dsh-gp-write::after`（来自 `dsh-git-panel/lib/client.js`）。
- **失效症状**：分隔条消失 / git 面板布局异常。
- **修复**：git-panel 升级改了类名 → 更新这些选择器；**若 git-panel 卸载**，这套样式应自动无害（选择器不匹配），可考虑整体移除。

### 功能 10：设置页入口 / 中心面板
- **改在哪**：`settings.section`/`main`/`plugins.detail.actions` slot（2607/2409/2442 行），ctx.configForms.get('enkeep')。
- **目的/效果**：全局设置页 + 插件详情"打开 Enkeep"动作 + 侧栏 launcher。
- **失效症状**：设置入口消失。
- **修复**：slot 名变了 → 更新；configForms key `enkeep` 变了 → 更新。

---

## 4. 升级适配原则（决策树）

```
某功能失效？
├─ 样式类问题（位置/宽度/间距/颜色不对）
│   ├─ 选择器命中了吗？ → 用 DevTools 查官方 DOM 当前类名/属性
│   │   ├─ data-slot / role / data-conversation-content 还在 → 优先用这些稳定钩子
│   │   └─ hash class 变了 → 用 [class*="语义片段"] 匹配，别写死全名
│   ├─ CSS 变量改名？ → 查 getComputedStyle 里 --dsh-* / --dsw-* 的新名字
│   └─ 被官方新样式覆盖？ → 检查注入顺序，必要时 !important
├─ 数据问题（状态/文本不对）
│   ├─ hook 字段名变了 → 对照官方 client.js 的类型/store 定义更新读取
│   └─ DOM 标记变了 → 真实页面确认新标记（如 data-chat-flow-kind）
├─ slot 问题（入口/组件不渲染）
│   ├─ slot 改名 → 更新 inject/register 的 name
│   └─ slot 从 list 变 single（或被占用）→ 换 additive slot，切勿抢 single
└─ 启动报错 "entry did not activate"
    └─ 几乎都是抢了 single slot → 检查是否注册了 lineage/conversation.header 等，改回 list slot
```

**永远不要做的事**：改 DSH 核心源码；改其他插件文件；注册 `conversation.session.header.lineage` / `conversation.header` / `conversation.session` / `conversation.chat.flow` 这类 single slot；写 `--dsh-*` 宽度变量（只读）；重启 dsh web。

---

## 5. 升级自检脚本（刷新页面后在 DevTools Console 跑）

把下面整段粘到浏览器控制台，逐项返回 `OK` / `FAIL`，对照第 2 节表定位：

```js
(() => {
  const out = [];
  const ok = (name, cond, detail='') => out.push(`${cond?'OK ':'FAIL'} ${name}${detail?' — '+detail:''}`);
  const q = (s) => document.querySelector(s);
  // 1 wide
  const cc = q('[data-conversation-content]');
  ok('wide: 会话内容容器', !!cc);
  if (cc) ok('wide: 宽度变量已覆盖', getComputedStyle(cc).getPropertyValue('--dsh-chat-content-width').includes('clamp') || !!getComputedStyle(cc).getPropertyValue('--dsh-composer-card-max-width'));
  // 2 activity
  ok('activity: 悬浮条', !!q('[data-enkeep-activity-bar]'));
  ok('activity: 5 头部按钮', document.querySelectorAll('[data-enkeep-activity-action],[data-enkeep-activity-toggle]').length >= 5);
  // 4/5 header
  const crumbAnchor = '[data-slot="conversation.session.header.lineage"]';
  ok('header: lineage 锚点', !!q(crumbAnchor));
  ok('header: 目录前缀变量', !!getComputedStyle(document.documentElement).getPropertyValue('--enkeep-dir-prefix').trim());
  const H = 'header:has(' + crumbAnchor + ')';
  const tablist = q(H + ' [role="tablist"]');
  ok('tabs: 容器存在', !!tablist);
  if (tablist) {
    ok('tabs: 绝对定位(单行header)', getComputedStyle(tablist).position === 'absolute');
    ok('tabs: left 变量已写', !!getComputedStyle(document.documentElement).getPropertyValue('--enkeep-tabs-left').trim());
    ok('tabs: 间距变量已写', !!getComputedStyle(document.documentElement).getPropertyValue('--enkeep-tabs-shift').trim());
    const tabs = [...tablist.querySelectorAll('[role="tab"]')].filter(t=>t.getBoundingClientRect().width>0);
    const crumb = q('span:has(+ ' + crumbAnchor + ')');
    if (tabs.length && crumb) {
      const g1 = Math.round(tabs[0].getBoundingClientRect().left - crumb.getBoundingClientRect().right);
      ok('tabs: 标题→对话间距应≈36', Math.abs(g1-36)<=4, '实际 '+g1);
    }
  }
  ok('header: 高度应为48', Math.round((q(H)||q('header')).getBoundingClientRect().height) === 48);
  // 6 last prompt
  ok('lastprompt: 横条', !!q('[data-enkeep-lastprompt]'));
  ok('lastprompt: 文档流 slot', !!q('[data-slot="conversation.input.dock"] [data-enkeep-lastprompt]'));
  // 7 composer dock
  ok('composer: 快捷行宽度对齐', !!q('[data-composer-dock]'));
  // styles all present
  const ids = ['enkeep-wide','enkeep-activity','enkeep-lastprompt','enkeep-current','enkeep-header','enkeep-header-compact','enkeep-words','enkeep-gitpanel-split'];
  ids.forEach(id => ok('style: '+id, !!q(`style[data-plugin-css="${id}"]`)));
  console.log(out.join('\n'));
  return out;
})()
```

> 若空白新会话：lineage/tabs/横条相关项报 FAIL 属**正常**（空白会话无这些结构），先在有内容的会话里测。

---

## 6. 升级前必须备份/核对的常量清单

改代码时，以下常量集中体现了"对官方的依赖"，升级后逐条核对即可：

| 类别 | 值 | 所在功能 |
|---|---|---|
| data 钩子 | `data-conversation-content` / `data-composer-dock` / `data-composer-card` / `data-chat-flow-kind="user"` / `data-clock` / `data-slot="conversation.chat.flow"` / `data-slot="conversation.session.header.lineage"` / `data-sidebar-collapsed` / `data-side="sidebar"` | 1/6/7/4/5/2/3 |
| role | `role="tablist"` / `role="tab"` | 5 |
| hash 片段 | `[class*="headerActions"]` / `.sidebarCol` / `.dsh-gp` `.dsh-gp-write` / `.uV2eYG_dock` | 5/3/9/7 |
| 官方 CSS 变量（读） | `--dsh-conversation-column-width` / `--dsh-chat-content-width` / `--dsh-composer-card-max-width` / `--dsh-frame-overlay-top` / `--dsh-sidebar-inline-padding` / `--dsw-radius-lg` | 1/2/7 |
| 自有 CSS 变量（写） | `--enkeep-dir-prefix` / `--enkeep-tabs-left` / `--enkeep-tabs-shift` / `--dsh-enkeep-grid-cols` / `--enkeep-gp-top-h` | 4/5/3/9 |
| slot 名 | `shell.overlay` / `conversation.input.dock` / `conversation.session.header.actions` / `conversation.composer.dock` / `conversation.input.right` / `settings.section` / `main` / `sidebar.panellist` / `plugins.detail.actions` | 全部 |
| 官方状态字段 | `useSessions.byId[]`: `cwd/title/displayTitle/origin/blank/updatedAt/retainedBy.mainView`；`useSessionStatus`: `running/completionUnread/pendingInteraction` | 2/4 |
| 自有配置字段（index.js schema，volatile） | `chatWidth`(默认wide) / `showLauncher`(true) / `activityWindowHours`(24,1~720) / `activityItemLimit`(20,1~200) / `showCommonWords`(true) / `quickPromptCount`(6,1~12) | 全部 |
| host 路由 | `/dsh-enkeep-skills` + header `x-dsh-enkeep-skills`（在 index.js，本轮未改） | 8 |

---

## 7. 版本历史

| 版本/提交 | 内容 |
|---|---|
| 早期 | 活动区、宽度、常用词、git-panel 分隔、skill 快选、设置页等基础功能 |
| `294dac1` | 标题栏显示目录:名字（最终改用 header.actions list slot）、移除底部 chip、composer dock 宽度对齐 |
| `1cc641f`~`de2edfa` | 上一条指令横条：浮层 → input.dock 文档流 → 间距 12px |
| `92dbb08` | 修正过时注释与实测数据 |
| `1afe1b8` | tabs 嵌入标题行：header 76→48px、坐标转换、隐藏 tab 过滤 |
| `614d1d9` | 标题→对话间距对齐官方 36px（lead 动态计算） |
| 本次 | 活动区条数上限可配置（`activityItemLimit` 默认 20、1~200，index.js + client.js 双改） |
| 本文档 | 升级适配全档案（含自检脚本） |
