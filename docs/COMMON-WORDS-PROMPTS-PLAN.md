# dsh-enkeep 常用词增强（结构化提示词 + 高频快捷栏）开发计划

> 范围：在已移植的常用词功能基础上做增强。① 数据结构从"纯字符串词条"升级为
> **结构化提示词**（`keyword` 关键字 + `content` 多行正文 + `useCount` 使用频率）；
> ② 在 Enkeep **设置页**增加提示词编辑器（关键字单行输入 + 正文多行 textarea）；
> ③ 在**当前对话标签后面**（`conversation.input.dock`）增加按频率排序的**前 N 名快捷按钮**，
> 点击即插入正文。
> 约束：沿用现有共享存储 `$DSH_HOME/dsh-enkeep-words.json`；宽度隔离、现有功能不回退；
> 本计划**不含时间安排**，只列步骤、功能、技术与验收标准。
>
> 前置：常用词功能已由 `docs/COMMON-WORDS-PLAN.md` 移植完成（提交 86ab76a），dsh-wordbox 已卸载。
>
> 已拍板决策（用户已确认）：
> 1. 旧 19 条合并进新结构一份数据，关键字留空；2. 原"词"面板保留并升级；
> 3. 无关键字显示正文前 6~8 字 + 省略号，title 放全文；4. 频率只读 + 单条归零 + 全部归零，
> 不手填；5. 快捷栏单行横向滚动；6. 关键字可不唯一（轻提示不拦截）。
> 补充：频率持久化到共享文件；schema 带版本号向下兼容；面板与快捷栏插入统一 +1。

---

## 0. 总体架构与技术选型

### 0.1 数据模型升级（核心）

旧结构（v1）：
```
{ rev, updatedAt, mode, words: string[], projects: { dir: string[] } }
```
新结构（v2，带 `version` 字段）：
```
{
  version: 2,
  rev, updatedAt, mode: 'all'|'global'|'current',
  words: Prompt[],                 // 全局桶
  projects: { [dir]: Prompt[] }    // 当前项目桶
}
Prompt = { id: string, keyword: string, content: string, useCount: number }
```
- `id`：稳定唯一，迁移时由内容确定性生成（如 `legacy-<index>`），新建时用时间戳+随机；删除/插入靠 id 定位，不靠数组下标。
  **`addToGlobal` 把项目词条复制进全局桶时必须生成一个新 id**（不能直接复用原 id，否则同一个 id 同时存在于两个桶，`insert(id)` 定位会歧义）。
- `keyword`：可选短标签（3~6 字）；`content`：正文，可多行大段文本；`useCount`：使用次数（>=0 整数）。
- **迁移**：host 与 client 读取时若发现 `version` 缺失/为旧字符串数组，自动把每条 string 包成
  `{ id, keyword:'', content:<原字符串>, useCount:0 }`，写回即为 v2。旧 19 条一条不丢。

### 0.2 关键技术结论（已核查，非猜测）

- `conversation.input.dock` 与 `conversation.input.right` 均为 **session 作用域 list 槽**
  （`client-ui-conversation/lib/client.js:19750`、`19904`）。
- `inputActions`（及 `useInput`）由 `ctx.uiSession.provide({hooks:['conversation','input'], props:['inputActions'], ...})`
  注入（`client-ui-conversation/lib/client.js:19709-19725`），session 作用域的 input 槽可拿到——
  wordbox 已在 `conversation.input.right` 实证。快捷栏放 `conversation.input.dock` 同样可取。
- `conversation.input.dock` 渲染于 composer 卡片正上方（`client.js:17842`），紧邻 `inputBar`，
  当前会话标签（current-session chip）就在此槽——快捷栏放它后面符合"输入框上方、标签后面"的位置要求。
- **双组件同步冲突**：面板（`conversation.input.right`）与快捷栏（`conversation.input.dock`）是两个独立
  组件实例。原同步逻辑（轮询/防抖推送/三路合并）写在组件内，若两处各跑一套会互相覆盖。
  故本次把**词库状态 + 同步逻辑上提到模块级共享 store**（见 0.3），两个组件只读 store + 调 action。

### 0.3 模块级共享 store（新增，本次架构重点）

在 client.js factory 内新建一个模块级单例 `wordStore`（普通闭包对象，非 React state）：

| 职责 | 说明 |
|---|---|
| 状态 | 持有 `version/mode/words/projects/useCount`，单一真相源 |
| 订阅 | `subscribe(fn)` / `getSnapshot()`，组件用 `React.useSyncExternalStore` 订阅（或自实现 subscribe hook 回退，见步骤 2），一处更新两处刷新 |
| 动作 | `insert(id)`（插入正文 + useCount+1）、`upsert(prompt)`、`remove(id)`、`resetCount(id)`、`resetAll()`、`setMode`、`addToGlobal` |
| 插入回调 | store 不直接持有 `inputActions`（它是 session 作用域、逐会话不同）；由各组件把 `inputActions.setDraft` 以 `registerInserter` 注入，store 调当前注册的 inserter 完成插入 |
| 同步 | 三路合并 / 10s 轮询 / 800ms 防抖推送 / 脏检测 / 离线降级全部收敛到 store，全局只跑一套 |
| 持久化 | localStorage 即时缓存 + 服务端共享文件对齐 |

store 需要在首个组件挂载时启动同步、最后一个卸载时可停（引用计数或常驻；常驻更简单，Web 页生命周期内只一份）。

### 0.4 文件与非目标

- 改动文件：`client.js`（store + 三个组件/编辑器 + CSS）、`index.js`（host normalize 支持 v2）、
  `cordis.patch.yml`（新增 `quickPromptCount` 配置）、`docs/COMMON-WORDS-PROMPTS-PLAN.md`（本文档）。
- **不改**：路由路径、词库文件位置、`showCommonWords` 语义、宽度控制逻辑。
- 不引入新 npm 依赖；不做时间规划。

---

## 1. 分步开发计划

### 步骤 1：数据模型 v2 + 迁移（host 与 client）

**功能**：词库从字符串数组升级为结构化提示词对象，带版本号，旧数据自动迁移不丢。

**技术**：
- `index.js` 的 `normalize(value)`：识别 `version===2` 且 `words/projects` 元素为对象 → 规范化
  `{id:string, keyword:string, content:string, useCount>=0}`；否则走 v1 兼容分支——把每条 string 包成
  `{ id:'legacy-'+i, keyword:'', content:s, useCount:0 }`，输出 `version:2`。去重、剔空、空桶丢弃等原语义保留。
- `stateFile()` 路径不变；`mergeWords`/`mergeStates` 改为按 `id` 合并（保留两侧、冲突以 incoming 为准），
  不再是字符串并集。
- client 侧 `loadWords/loadProjects`：同样识别 v1/v2 并迁移；`saveWords/saveProjects` 写 v2。

**完成标准**：`node --check` 通过；v1 旧文件读一次即变 v2；19 条原文一条不丢。

**验收**：
- 用现有 `dsh-enkeep-words.json`（19 条 v1 字符串）喂给 normalize → 输出 19 个 v2 对象，`content` 与原文逐字一致，`keyword=''`、`useCount=0`、`version=2`。
- 重复读同一文件结果稳定（id 不每次变）；损坏文件仍走隔离；rev 冲突协议不变。

**成功判定**：v1→v2 迁移数据零丢失、幂等、协议不变——视为步骤 1 成功。

---

### 步骤 2：模块级 wordStore + 同步层上提

**功能**：建立单一真相源的共享 store，把原组件内的同步/持久化逻辑收敛进来，供面板、快捷栏、编辑器共用。

**技术**：
- 在 factory 内实现 `createWordStore()`；状态字段对齐 v2 结构。
- `subscribe/getSnapshot` + `React.useSyncExternalStore`。**实施前先确认 `require('react')` 暴露了
  `useSyncExternalStore`**（host 打包暴露，磁盘上无独立 react 包可直接查）；若没有，回退用一个 5 行的
  自实现 hook：`useState(getSnapshot())` + `useEffect(() => subscribe(() => setState(getSnapshot())), [])`，
  同样能实现"一处更新、多处刷新"，不依赖该 API。
- 动作：`insert(id)`（调注册的 inserter 插入 `content`，再 `useCount+1` 并触发同步）、
  `upsert(prompt)`（新增/编辑，按 id）、`remove(id)`、`resetCount(id)`、`resetAllCounts()`、
  `setMode`、`addToGlobal(id)`。所有动作就地不可变更新 + `notify()`。
- `registerInserter(fn)`：组件把 `inputActions.setDraft` 注入；store 插入时调它。
- 同步层从原 `CommonWords` 内整体搬入 store（fetch 地址/头不变：`/dsh-enkeep-words/state` + `x-dsh-enkeep-words:1`），三路合并按 `id` 处理。

**完成标准**：`node --check` 通过；组件内不再残留独立的轮询/推送 effect；store 动作可被 mock 调用。

**验收**：
- 两个订阅者同时订阅，`insert(id)` 一次 → 两者都收到更新，useCount 恰好 +1（不是 +2）。
- 800ms 内多次 insert 只推送一次（防抖）；10s 轮询只跑一套（全局一个 setInterval）。
- 未注册 inserter 时调 insert 不抛错（只记数不插入）；注册后插入内容为 `content` 全文。

**成功判定**：单一 store、双订阅一致、防抖/轮询单实例、插入走 inserter——视为步骤 2 成功。

---

### 步骤 3：设置页提示词编辑器

**功能**：在 Enkeep 设置页增删改提示词，关键字单行、正文多行大段，频率只读可归零。

**技术**：
- 新组件 `PromptsEditor({ store })`，挂进 `EnkeepSettings`（`settings.section` 的 enkeep 条目）末尾。
- 列表：每条显示 `keyword || '（无关键字）'` + `content` 单行预览（截断）+ `useCount` + 操作按钮
  （编辑 / 删除 / 归零）；顶部"＋ 新增"与"全部归零"。
- 编辑态：`keyword` 单行 `input`、`content` 多行 `textarea`（`rows>=4`，可拉伸），
  "确定/取消"。确定调 `store.upsert`。
- 关键字重复：输入时与其条目比较，重复则显示轻提示文字（黄色/次要色），**不阻止保存**。
- 删除/归零/全部归零：调 `store.remove` / `resetCount` / `resetAllCounts`，二次确认删除。
- 设置页通过 `React.useSyncExternalStore(store.subscribe, store.getSnapshot)` 订阅，改动即时反映。

**完成标准**：`node --check` 通过；编辑器走 store 动作，不直接碰 localStorage/路由。

**验收**：
- 新增一条（关键字"审核"+ 多行正文）→ 出现在列表，持久化到文件，重启后仍在。
- 编辑正文为长文本（含换行）→ 保存后列表预览正确、`content` 全文保留换行、点击插入不丢格式。
- 关键字重复显示提示但仍可保存；删除有二次确认；单条归零/全部归零后 useCount 归 0。
- 旧 19 条以"无关键字"出现在列表，可编辑补关键字。

**成功判定**：增删改 + 多行正文 + 频率归零 + 重复轻提示全部符合预期——视为步骤 3 成功。

---

### 步骤 4：高频快捷栏（前 N 名按钮）

**功能**：在当前对话标签后面显示按 `useCount` 降序的前 N 条提示词按钮，点击插入正文。

**技术**：
- 新组件 `QuickPrompts({ store })`，注册到 `conversation.input.dock`，order 紧随 current chip
  （如 110），`inject` 注入 `inputActions` 与 `useSessions/sessionId`（标准 props）。
- `registerInserter(props.inputActions?.setDraft)`：挂载时把 inserter 注入 store。
- 取数：`React.useSyncExternalStore` 订阅 store → 合并全局桶 + 当前项目桶（`useSessions` 取 cwd，
  与面板同 `wordsNormalizeProject`）→ 按 `useCount` 降序（并列时 keyword/内容字典序稳定）→ 取前 N。
- N = `quickPromptCount` 配置（步骤 5 加），默认 6；`useCount===0` 的条目是否占位：默认也显示
  （迁移后全是 0，否则空栏），排序靠 id 稳定；后续用起来自然分层。
- 按钮标签：`keyword || <content 前 6~8 字 + '…'>`；`title` = 完整 content；`onMouseDown preventDefault`
  保持 textarea 焦点；点击调 `store.insert(id)`。
- CSS 前缀 `ekeep-q-*`：单行 `display:flex; overflow-x:auto; scrollbar-width:thin;`，按钮不换行、
  不撑破输入框宽度；空列表时不渲染。

**完成标准**：`node --check` 通过；快捷栏只读 store + insert；CSS 前缀独立；不写聊天宽度变量。

**验收**：
- 当前对话标签后面出现 N 个按钮，按频率降序；标题/截断标签正确。
- 点击按钮 → 正文插入输入框（多行含换行原样插入），该条 useCount +1、排序随之更新，焦点留在输入框。
- 面板点击插入与快捷栏点击插入都走 store.insert → 频率同步 +1（不重复计数）。
- 横向滚动生效，按钮不换行、不挤压输入框；`showCommonWords=false` 时快捷栏随面板一起隐藏。
- 切换到另一工作区：当前项目桶部分的按钮随 cwd 变化，全局桶不变。

**成功判定**：位置正确、排序正确、点击插入 + 频率同步、宽度不干扰——视为步骤 4 成功。

---

### 步骤 5：`quickPromptCount` 配置 + 面板升级显示

**功能**：前 N 名数量可配置；原"词"面板升级为显示 keyword + 内容摘要。

**技术**：
- `index.js` Config 新增 `quickPromptCount: Schema.number().step(1).min(1).max(12).default(6).volatile()`；
  `loader/volatile-update` 日志补该字段；`cordis.patch.yml` config 重述全部键（含新键）。
- `EnkeepSettings` 加数字输入（1~12）；快捷栏订阅 store 时同时读该配置（从 form 或注入进 store 的 getter）
  决定 N。
- 面板 `CommonWords` 改为订阅 store（不再自带状态与同步）：`WordRow` 显示 `keyword || content 截断`，
  悬停 title 为完整 content；点击调 `store.insert(id)`；原两桶/三模式/转全局/增删逻辑改用 store 动作，
  useCount 自增。面板保留 V1 的用户体验（位置、三模式、增删）。

**完成标准**：`node --check` 全过；Config 五字段均 volatile；patch 重述全部键；面板不再持有独立状态/同步。

**验收**：
- 设置页把 N 从 6 改成 3 → 快捷栏即时只显示 3 个（volatile），刷新后仍为 3。
- 面板显示关键字/内容摘要，点击与快捷栏频率同源；三模式、增删、转全局回归通过。
- 全局搜索确认只有 store 一处 fetch 同步路由，无第二套轮询/推送。

**成功判定**：配置即时生效、面板升级且无独立状态、同步单例——视为步骤 5 成功。

---

### 步骤 6：全量自审 + 同步安装副本 + 提交推送

**功能**：审核、落地、交付。

**技术/动作**：
- git diff 全审：无死代码/TODO/临时文件；v1 兼容分支与 v2 主分支无重复逻辑；命名无冲突。
- `node --check` 全文件；纯函数测试（v1→v2 迁移、按 id 合并、频率排序、store 动作）。
- 同步到 `~/.dsh/profiles/web/node_modules/dsh-enkeep`，哈希一致。
- git commit + push（依赖行不带 SHA）。

**完成标准**：工作区干净、哈希一致、测试全绿、已推送。

**验收**：`git status` 干净；本地 HEAD == origin/main；安装副本逐文件哈希一致；刷新页面三个入口正常。

**成功判定**：全部满足视为步骤 6 成功。

---

### 步骤 7：重启 web + 真实浏览器验收（宿主改动需重启）

**功能**：在真实 GUI 验证端到端。

**技术/动作**：用户重启 web 会话（步骤 1/5 改了 `index.js` 的 normalize 与 Config，前端刷新不生效），
刷新页面后按清单验收。

**验收**：
- 设置页能新增/编辑/删除提示词，正文多行大段保存正常。
- 当前对话标签后出现前 N 个高频按钮，点击插入正文 + 频率 +1 + 排序更新。
- 面板显示关键字/摘要，点击与快捷栏频率同源。
- 聊天宽度设置保持既有表现（文字列 = 输入框 - 32px），本功能未影响宽度。
- 共享词库文件为 v2，含 19 条迁移词条 + 任何新增，频率跨重启保留。

**成功判定**：真实 GUI 全链路通过——视为步骤 7 成功。

---

## 2. 全局验收标准（最终交付）

1. 数据结构 v2（带 version），旧 19 条零丢失迁移，schema 向下兼容。
2. 设置页可增删改提示词：关键字单行、正文多行大段、频率只读+归零、重复轻提示。
3. 快捷栏按 useCount 降序显示前 N（默认 6，可配 1~12），点击插入正文 + 频率 +1。
4. 面板保留并升级（关键字/摘要显示），与快捷栏共用 store，插入频率同源不重复。
5. 模块级 store 单一真相源，同步/持久化/防抖/轮询全局单例，两组件订阅一致。
6. 宽度隔离：不写 `--dsh-chat-content-width`/`--dsh-composer-card-max-width`，既有宽度表现不变。
7. 代码质量：node --check 全绿、git 干净已推送、安装副本哈希一致、无临时文件。

## 3. 风险与取舍（如实记录）

- **双组件同步冲突**（本次最大技术风险）：用模块级 store 收敛解决；若不做，两处各跑同步会互相覆盖。
- **inputActions 作用域**：dock/right 均为 session 作用域，理论上可注入；若某环境 dock 拿不到 inserter，
  回退是快捷栏点击退化为只更新频率、由面板承担插入——需在步骤 4 验收实测确认。
  store 的 `registerInserter` 是单一槽位（后注册覆盖先注册），DSH web 同时只有一个主会话输入框，符合此假设；
  若将来支持多会话并排，需改成按 sessionId 映射多个 inserter。
- **v1→v2 迁移 id 稳定性**：迁移 id 用确定性规则，保证重复读取不漂移；新建用时间戳+随机。
- **useCount=0 全占位**：迁移后全为 0，按 id 稳定排序即可；初期排序看似固定，点击后自然分层。
- **宿主改动需重启**：步骤 1/5 改 index.js，必须重启 web 才能加载（步骤 7）。
- **频率并发**：沿用 rev 冲突 + 三路合并；useCount 作为字段随词条一起合并，冲突时以服务端合并结果为准，
  极端并发下计数可能非严格精确，但排序足够可用。
