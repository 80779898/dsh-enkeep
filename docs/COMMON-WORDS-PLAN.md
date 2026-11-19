# dsh-enkeep 常用词移植开发计划（步骤 / 功能 / 技术 / 验收标准）

> 范围：把已安装的 `dsh-wordbox`（我们修改后的版本）的"常用词盒子"功能移植进 dsh-enkeep，
> 移植完成后卸载 `dsh-wordbox`，只保留 enkeep 一份入口。
> 核心约束：**常用词面板的宽度只能在面板内部调整，绝不能影响已开发好的聊天宽度设置（chatWidth）**。
> 词库落盘 `$DSH_HOME`（非 profile 目录），全局可用。触发按钮用内联 SVG 图标。
> 本机版本：DSH 0.2.1-rc.2；文档版本偏差见 `~/.dsh/references/dsh-plugin-dev/插件开发流程.md`。
> 本计划**不含时间安排**，只列步骤、功能、技术与验收标准。
>
> 已拍板：① 独立词库文件（`dsh-enkeep-words.json`，与 wordbox 隔离）；② 移植完成并验证后再卸载 wordbox。

---

## 0. 总体架构与技术选型

### 0.1 要移植的四个组成部分（现状摸底）

`dsh-wordbox`（本机安装在 `~/.dsh/profiles/web/node_modules/dsh-wordbox`）的常用词功能由四部分组成，本计划逐一移植：

| 组成 | 现状位置 | 技术 |
|---|---|---|
| ① 宿主存储 | `patches/new/wordbox-index.js`（已打补丁到 `dsh-wordbox/lib/index.js`） | `inject=['webServer']`；同源路由 `GET/POST /dsh-wordbox/state`；落盘 `$DSH_HOME/dsh-wordbox-state.json`；rev 冲突检测 + 首轮并集播种 + 请求头 CSRF |
| ② 客户端 UI | `dsh-wordbox/lib/client.js` | 注册 `conversation.input.right`（session scope list 槽）；标准 props `useInput`/`inputActions`/`useSessions`/`sessionId`；全局/当前两桶 + 全部/全局/当前三模式；点词 `inputActions.setDraft`；增删/转全局 |
| ③ 同步层 | `patches/new/wordbox-client-sync.js`（补丁 wb-07） | localStorage + 服务端文件对齐；10s 轮询、800ms 防抖推送、三路合并、陈旧响应丢弃、脏检测 |
| ④ 面板定位/宽度 | `manifest.json` 补丁 wb-01/02/03/04 | 面板 `position:fixed` + 不透明背景 + 340px 列表；读 `[data-composer-card]` rect 设**面板自身** left/width/bottom；**原版改聊天宽度的 CSS（wb-05）已被移除**（wb-01 note：宽度控制权移交 dsh-enkeep）。注：manifest 中现仅存 6 条 wb 补丁（01/02/03/04/06/07），wb-05 不存在 |

### 0.2 移植目标形态

仍是 Host + Client 双半体 bundle，不新增文件类型：

| 文件 | 本计划改动 |
|---|---|
| `index.js`（Host） | 新增 `inject=['webServer']`；路由 `GET/POST /dsh-enkeep-words/state`；落盘 `$DSH_HOME/dsh-enkeep-words.json`；Config 新增 `showCommonWords` volatile 开关 |
| `client.js`（Client） | 新增 `CommonWords` 组件注册到 `conversation.input.right`；内联 SVG 触发图标；同步层；面板定位；CSS 用 `ekeep-w-` 前缀；**新增 `ctx.locale.register` 注册中英文字典**（enkeep 现有 client 无 locale 注册、组件文案全为硬编码中文，故这一步是净新增） |
| `cordis.patch.yml` | config 段**重述全部键**（新增 `showCommonWords: true`，保留现有 3 键）——按安全做法整段重写，不依赖合并语义 |
| `locale/en.json`、`zh.json` | **保持不变**：当前仅含 `meta.title/description/detail`。常用词字典按 wordbox 原样内联在 client.js（`ctx.locale.register(NS,{zh,en})`），不放进这两个 json |
| `docs/COMMON-WORDS-PLAN.md` | 本文档 |

### 0.3 关键技术依据（已验证，非猜测）

- `conversation.input.right` 是 `list` 类型、session scope 的槽（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:316`）。
- 组件所需 props 均为 session-scope 标准注入：`useInput`（hook）、`inputActions`（prop）由 `ctx.uiSession.provide({hooks:['conversation','input'], props:['inputActions'], ...})` 提供（`dsh-client-ui-conversation/lib/client.js:19709-19725`）；`useSessions`、`sessionId` 为 root/session 标准 props（renderer `standardProps` at `dsh-client-ui-renderer/lib/client.js:680-702`）。**无需额外 service inject**。
- Client 注册用 `ctx.slots.inject(slot, () => ctx.slots.register(...))`，与现有 enkeep 活动区/`settings.section` 写法一致。
- Host 注入 `webServer` 注册路由的范式与 wordbox 完全相同（wordbox `index.js` `apply` 已实证可用）。
- enkeep 现有宽度控制：client 用 `installWideStyle()` 插入一个 `<style data-plugin-css="enkeep-wide">` 标签（`client.js:63-73`,内容在 `54-58`），规则为 `[data-conversation-content]{--dsh-chat-content-width:...!important; --dsh-composer-card-max-width:...!important}`。移植的面板**不得**写这两个变量。（DEV-PLAN.md 早期"styles.insert"描述已过时，以本条为准。）

### 0.4 命名与隔离约定（避免串数据/样式冲突）

| 项 | enkeep 取值 | wordbox 原值 |
|---|---|---|
| 词库文件 | `$DSH_HOME/dsh-enkeep-words.json` | `$DSH_HOME/dsh-wordbox-state.json` |
| 路由 | `/dsh-enkeep-words/state` | `/dsh-wordbox/state` |
| 请求头 | `x-dsh-enkeep-words: 1` | `x-dsh-wordbox: 1` |
| localStorage 键 | `dsh.enkeep.words.*` | `dsh.common-word-box.*` |
| CSS 前缀 | `ekeep-w-*` | `cwbx_*` |
| slot id | `enkeep-common-words` | `common-word-box` |

---

## 1. 分步开发计划

### 步骤 1：宿主侧存储层（词库落盘 + 同源路由）

**功能**：提供跨实例共享的常用词持久化服务。

**技术**：`index.js` 具名导出 `inject=['webServer']`；`apply(ctx)` 内 `ctx.effect()` 注册 `webServer.register({kind:'prefix', path:'/dsh-enkeep-words', handler})` 并返回 disposer。移植 `wordbox-index.js` 的以下函数，只改路径/路由/头名：
- `dshHome()`（`process.env.DSH_HOME ?? path.join(os.homedir(),'.dsh')`）
- `stateFile()` → `$DSH_HOME/dsh-enkeep-words.json`
- `normalize(value)` → `{rev, updatedAt, mode, words:string[], projects:{dir:string[]}}`
- `readState()`（ENOENT→null；损坏→隔离到 `.corrupt-<ts>` 再返回 null；其他 IO 错误原样抛出）
- `writeState()`（temp + rename 原子写）
- `mergeWords(a,b)`（词表并集，保持左侧顺序）、`mergeStates(stored,incoming)`（首轮迁移：两桶分别并集 + 标量 `mode` 取传入方；**函数名是 `mergeStates`，不是 `seedIfNewer`**）
- `readJsonBody(req)`（带 1MB 上限读取 JSON body）
- `handleState(req,res,url)`：校验头（缺头 → HTTP 403 `{ok:false,error:'missing client header'}`）；GET → `{ok:true,state}`（首次写入前 `state:null`）；POST 三分支——`?migrate=1` 并集播种 / `stored===null` 直接写入（rev=1）/ 带 `baseRev` 且与 `stored.rev` 相同才接受（rev+1），`baseRev` 落后 → **HTTP 200 + `{ok:true,conflict:true,state:stored}`**（客户端据此三路合并重试）
- `CLIENT_HEADER='x-dsh-enkeep-words'`、`MODES=['all','global','current']`、`MAX_BODY=1_000_000`
- 注意 conflict 是 **HTTP 200 + `conflict:true`**，不是 `ok:false`/`error:'conflict'`；同步层靠 `data.conflict` 判断，别改错协议。

**完成标准**：`node --check index.js` 通过；`inject` 为具名导出且无 default export（函数插件规范）；路由挂载在 `ctx.effect` 且返回 disposer（HMR 安全）。

**验收**：
- `dsh --profile web --dump-config` 不报错（层校验通过）。
- 重启 web（宿主侧改动需重启，不热更新）后，`GET http://127.0.0.1:3080/dsh-enkeep-words/state`（带头 `x-dsh-enkeep-words:1`）返回 JSON（首次为 null-state）。
- 不带请求头访问被 403 拒绝；带错误 rev 的 POST 返回 conflict 而非静默覆盖。
- 手动写入两条词 → 文件内容为规范化 JSON；人为写坏文件 → 下次读取隔离为 `.corrupt-*` 且不丢现场。

**成功判定**：路由可读可写、冲突检测生效、原子写与损坏隔离生效、HMR dispose 生效——全部满足视为步骤 1 成功。

---

### 步骤 2：客户端 UI 骨架 + 触发图标 + 面板定位（不含持久化）

**功能**：在输入框右下 trailing 区出现一个内联 SVG 图标按钮；点击弹出面板；面板宽度跟随 composer 输入框但不修改聊天宽度。

**技术**：
- `client.js` 新增 `CommonWords({useInput, inputActions, useSessions, sessionId, t})` 组件。
- **locale 接线（净新增，enkeep 现无此机制）**：client 返回对象的 `inject` 数组加入 `'locale'`（`['slots','configForms','locale']`）；`apply` 内 `ctx.effect(() => ctx.locale.register(NS, {zh,en}))` 注册中英文字典（内容照搬 wordbox 的 `zh`/`en`/`NS='commonWordBox'`）；slot `register({..., locale: NS})` 传入命名空间，`t` 由 renderer 注入。若嫌引入 locale 成本高，可退化为硬编码中文（与 enkeep 其余组件一致）——二选一，但需与组件内取值方式保持一致，不能组件用 `t` 却不注册字典（会得到空的 `t`）。
- 注册：`ctx.slots.inject('conversation.input.right', () => ctx.slots.register({name:'conversation.input.right', id:'enkeep-common-words', order:30, locale: NS}, CommonWords))`。
- 触发按钮：复用 `HeaderIcon` 同款 SVG 规格（`viewBox 0 0 16 16`, `stroke-width 1.5`, 尺寸约 14px），画简洁书签/列表图形；`onMouseDown preventDefault` 保持 textarea 焦点；`aria-label`/`title`="常用词"。
- 面板定位 effect（移植 wb-03）：`position:fixed`；`closest('[data-composer-card]')` 取 rect → **只设面板自身** `style.left/width/bottom`；监听 resize 重算、卸载时移除监听。**绝不写** `--dsh-chat-content-width` / `--dsh-composer-card-max-width`。
- CSS：独立 `<style data-plugin-css="enkeep-common-words">`，前缀 `ekeep-w-`，不透明背景 `var(--dsw-alias-bg-layer-2)`，列表 `max-height:340px`，超长词条行内截断 + hover 跑马灯（这两项都是 wordbox 原有行为，随移植一并带来：跑马灯 = `hover` + `translateX(-overflow)`，见原 `client.js:222-257`）。
- 空态、面板开关（点击外部 / Esc 关闭）。

**完成标准**：`node --check client.js` 通过；新组件注册在 `conversation.input.right`；SVG 图标无文字；面板定位只写自身 style；CSS 前缀独立、无 `cwbx_`/`data-enkeep-current` 等他处命名。

**验收**：
- 刷新 web 页面，输入框右侧出现 SVG 图标（非文字"词"），风格与活动区头部图标一致。
- 点击弹出面板，位置紧贴输入框上方、宽度与输入框一致；缩放窗口面板重新贴合。
- 开/关宽屏（chatWidth）后面板宽度**跟随**输入框变化，但聊天文字列宽度不受本功能影响（切回原宽度前后对比：文字列宽 = 输入框宽 - 32px 的原生关系保持不变）。
- 点击面板外部 / 按 Esc 关闭面板；点击图标不抢 textarea 焦点。
- 全局搜索 `client.js` 无对 `--dsh-chat-content-width`/`--dsh-composer-card-max-width` 的新增写入（除既有宽度逻辑外）。

**成功判定**：图标显示正确、定位正确、宽度不干扰既有宽度设置、开关行为正常——全部满足视为步骤 2 成功。

---

### 步骤 3：词库交互逻辑（两桶 / 三模式 / 增删 / 插入）

**功能**：全局桶 + 当前项目桶；全部/全局/当前三种显示模式；添加、删除、转全局；点击词条插入输入框。

**技术**（移植 wordbox `client.js` 的纯逻辑，改 localStorage 键为 `dsh.enkeep.words.*`）：
- 状态：`mode`、`globalWords`、`projects`，`localStorage` 三键持久化（`loadWords`/`saveWords`/`loadProjects`/`saveProjects`/`loadMode`/`saveMode`）。
- `projectKey = normalizeProject(cwd)`（cwd 来自 `useSessions(s => byId[sessionId]?.cwd)`）。
- `visible`：`global`→仅全局；`current`→仅当前项目；`all`→并集去重（全局优先）。
- `insert(word)`：`inputActions.setDraft(base + sep + word)`（一次事务一个撤销步；`onMouseDown preventDefault` 保持焦点；面板不关闭）。
- `addWord`/`removeWord`（按词条从两桶一起删）/`addToGlobal`（当前项目词复制进全局，幂等）。
- 跨标签页 `storage` 事件同步。

**完成标准**：`node --check` 通过；localStorage 键为 enkeep 自有；`insert` 走 `inputActions.setDraft`；无数组原地变异。

**验收**：
- 添加词条：全部模式默认进当前项目桶；全局模式进全局桶；去重生效。
- 三模式切换显示正确；"全部"下两桶重复词只显示一行。
- 删除词条：从两桶一起消失（"删了还在"为失败）。
- "当前"模式"转到全局"按钮：只加到全局、不动当前项目桶；已在全局时置灰。
- 点击词条：文字追加到输入框（词间自动补空格），光标/焦点保持在输入框，面板仍开着，一次点击 = 一次撤销步。
- 切到另一个工作区：当前项目桶内容随 cwd 隔离，全局桶不变。
- 开两个标签页：一个增删，另一个通过 storage 事件同步。

**成功判定**：两桶/三模式/增删/插入/隔离/跨标签同步全部符合预期——视为步骤 3 成功。

---

### 步骤 4：客户端 ↔ 宿主同步层（三路合并持久化到 $DSH_HOME）

**功能**：把 localStorage 状态与 `$DSH_HOME/dsh-enkeep-words.json` 对齐，实现全局/跨实例共享，根治"重启恢复默认"。

**技术**（整搬 `wordbox-client-sync.js`，改 URL/头名/localStorage 键）：
- `SYNC_URL='/dsh-enkeep-words/state'`、`SYNC_HEADERS={'x-dsh-enkeep-words':'1'}`、`SYNC_POLL_MS=10000`。
- ref：`syncRevRef`/`syncHydratedRef`/`syncSentRef`/`syncBaseRef`/`syncStateRef`（首次以挂载时状态初始化基线，避免覆盖挂载后即时编辑）。
- `syncMergeWords(base,theirs,mine)` 三路合并（双方各自删除的词不回魂）。
- `syncPull()`：陈旧响应（rev≤当前）丢弃；脏检测（本地未推送）→ 三路合并后 re-POST（带 baseRev）。
- 变更 effect：防抖 800ms 推送，`baseRev` 用改动所基于的版本（非推送时刻值）。
- 轮询 effect：仅面板打开时、标签页可见时拉取；visibilitychange 切回前台立即拉。
- 服务端不可用：静默退回纯 localStorage（保留离线可用）。

**完成标准**：`node --check` 通过；URL/头名/键为 enkeep 自有；三路合并与 re-POST 逻辑与原版逐字等价（只改名）；所有 ref/effect 随组件卸载清理。

**验收**：
- 面板打开 → 拉取服务端词库覆盖本地（本地无未推送改动时）。
- 本地增删 → 800ms 后服务端文件更新；重启 web → 词库仍在（不再"恢复默认"）。
- 并发编辑（两标签页同时改）→ 三路合并保住双方增删，无整体覆盖。
- 防抖窗口内轮询 → 本地未推送改动不被取消/覆盖（脏检测生效）。
- 陈旧 rev 响应被丢弃；冲突响应触发 re-POST（带正确 baseRev）。
- 停掉宿主路由（或改错 URL）→ 功能退回 localStorage 仍可用，无报错轰炸。

**成功判定**：持久化跨重启、并发合并正确、脏检测与陈旧丢弃生效、离线降级正常——视为步骤 4 成功。

---

### 步骤 5：`showCommonWords` 开关 + 收尾打磨

**功能**：设置页可单独关闭常用词入口；面板细节打磨。

**技术**：
- `index.js` Config 新增 `showCommonWords: Schema.boolean().default(true).volatile()`；`cordis.patch.yml` config 段**重述全部键**（含新键）；`loader/volatile-update` 日志补该字段。
- `EnkeepSettings` 加复选框；`CommonWords` 注册受 `showCommonWords` 门控（关闭时不注册/隐藏入口）。
- 打磨（**均为可选项，非移植必需**）：键盘导航（上下选择/Enter 插入）——注意 wordbox 原版**没有**此功能（只有 Esc 关闭），这是净新增，若实现成本高可不做；空态文案沿用字典。超长词跑马灯已在步骤 2 随原版移植，不在此重复。

**完成标准**：`node --check` 两个文件通过；Config 四字段均 volatile（chatWidth / showLauncher / activityWindowHours / showCommonWords）；patch 重述全部键；开关门控生效。

**验收**：
- 设置页勾选/取消"显示常用词"→ 入口即时显隐（volatile 不重启）。
- 关闭后刷新页面仍关闭（配置持久化）；重新打开恢复。
- 跑马灯：超长词条悬停露出尾部、移开复位（步骤 2 已带，此处回归确认）。
- 键盘导航（若实现）：上下选择 / Enter 插入可用；未实现则不作为失败项。

**成功判定**：开关生效；打磨项按"实现则验收、未实现不阻塞"处理——视为步骤 5 成功。

---

### 步骤 6：全量自审 + 同步安装副本 + 提交推送（移植部分）

**功能**：对 enkeep 仓库内所有改动做最终审核并落地。

**技术/动作**：
- git diff 全审：删除行是否都是合理重构；无 `TODO`/死代码/命名冲突/临时文件。
- 属性/CSS 前缀/路由/localStorage 键与他插件隔离校验。
- `node --check` 全部文件；纯函数行为测试（`normalize`/三路合并/`sessionLabel` 等）。
- 同步到 `~/.dsh/profiles/web/node_modules/dsh-enkeep`，哈希一致性核对。
- git commit + push（不引入 SHA 到 `package.json` 依赖）。

**完成标准**：工作区干净、哈希一致、无临时产物、测试全绿、已推送。

**验收**：
- `git status` 干净；`git log -1` 为新提交；本地 HEAD == origin/main。
- 安装副本与源码逐文件哈希一致。
- 刷新 web 页面，常用词入口正常、宽度设置保持此前验证结果（文字列/输入框 32px 差）。

**成功判定**：全部满足视为步骤 6 成功。

---

### 步骤 7：卸载 dsh-wordbox（含全局补丁系统联动，单独确认后执行）

**功能**：移植验证通过后，卸载旧插件，只留 enkeep 一份常用词入口。

**技术/动作**（有副作用，执行前单独与用户确认）：
1. `dsh plugin --profile web remove dsh-wordbox`（打 `disabled:true`，非删条目）。
2. 改 `~/.dsh/patches/guard-plugins.json` 的 `shared` 名单去掉 `dsh-wordbox`——**否则 `DSH-PatchGuard` 每 15 分钟补回**。
3. 改 `~/.dsh/patches/manifest.json`：给现存 **6 条** wb 补丁（`wb-01-panel`/`wb-02-list-height`/`wb-03-panel-position`/`wb-04-panel-ref`/`wb-06-host-state`/`wb-07-client-sync`；wb-05 早已不存在）加 `profiles: []` 休眠——**否则 `apply.mjs` 因目标文件不存在整条 ABORT，连累 genui/侧栏补丁静默停摆**（先例：sc-01 的 `profiles:[desktop]` 处理；`appliesToProfile` 用 `patch.profiles.includes(profile)` 判断，空数组即对所有 profile 跳过，见 `patches/lib.mjs:55-56`）。
4. 跑 `node ~/.dsh/patches/verify.mjs` + `apply.mjs` + `replay-all.mjs` 确认补丁链仍全绿。

**完成标准**：wordbox 不再加载、guard 不补回、补丁链 verify/apply/replay 全绿、enkeep 常用词仍可用。

**验收**：
- 输入框右侧只有一个常用词图标（enkeep 的）。
- 等待超过 15 分钟（一个 guard 周期）后 wordbox 仍未被补回。
- `verify.mjs` 退出码 0、无 ABORT；`replay-all.mjs` 逐字节一致。
- enkeep 常用词增删改与持久化正常（词库文件已是 enkeep 自己的）。

**成功判定**：全部满足视为步骤 7 成功。

---

## 2. 全局验收标准（最终交付）

1. 输入框右侧有且仅有一个内联 SVG 图标的常用词入口（enkeep）。
2. 面板功能完整：两桶、三模式、增删、转全局、点击插入、跨工作区隔离、跨标签同步、跨重启持久化。
3. **宽度隔离**：开/关宽屏、增删词条、面板开合，聊天文字列宽度始终满足既有"文字列 = 输入框 - 32px"关系；本功能从未写聊天宽度变量。
4. 词库存 `$DSH_HOME/dsh-enkeep-words.json`，全局可用；与 wordbox 数据互不干扰。
5. `showCommonWords` 开关可单独关闭入口，volatile 即时生效。
6. 代码质量：`node --check` 全绿、git 干净已推送、安装副本哈希一致、无临时文件、HMR dispose 完整。
7. 旧插件已卸载且不被 guard 补回；全局补丁链 verify/apply/replay 全绿。

## 3. 风险与取舍（如实记录）

- **宿主侧改动需重启 web**：步骤 1/5 改 `index.js`，前端刷新不生效，必须重启 web；步骤 1 验收因此需重启后做。
- **guard 联动是全局改动**：步骤 7 动 `guard-plugins.json`/`manifest.json`，影响面超出 enkeep 仓库，单独确认后执行（用户已同意先移植验证、最后再卸载）。
- **双写冲突**：步骤 7 前若 wordbox 仍启用且两插件同开，因各自独立词库文件不会冲突；但界面会有两个入口——这是过渡态，步骤 7 消除。
- **键盘导航**（步骤 5 净新增、wordbox 原版没有）若实现成本高可不做，不阻塞主流程验收；跑马灯是 wordbox 原有行为，随步骤 2 移植，非可选。
