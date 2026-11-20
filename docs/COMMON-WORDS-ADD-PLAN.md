# 常用词「添加」修复 + 关键字输入 规划

> 状态：已规划，待实施
> 范围：`client.js`（纯前端），不改 `index.js`、不改词库 v2 schema、不加搜索框、不碰其它插件
> 本规划不含时间安排，只列步骤、内容、验收标准

---

## 0. 数据事故与恢复（2026-11-20，规划阶段发现）

**事故**：规划调研时做的一次诊断探针，用 PowerShell `Invoke-WebRequest | ConvertFrom-Json` 读取词库、再用 `ConvertTo-Json` POST 回去，把 19 条常用词的中文全部写成了 `????`（GBK/ASCII 编码器不支持中文时的替换行为）。损坏文件已备份为 `~/.dsh/dsh-enkeep-words.CORRUPTED-20261120-072746.json`。

**恢复**：用 `~/.dsh/dsh-wordbox-state.json`（迁移源，中文完好）逐字恢复 19 条 global 词；删除项目桶 `c:/dev/fuke` 里那条 `??` 乱码词（已无法找回原文）。恢复用 Node + 显式 `'utf8'` 写盘，校验 19 条中文完好、无 `???`、schema 不变。

**根因**：PowerShell 的 `ConvertFrom-Json`/`ConvertTo-Json` 处理 UTF-8 中文时按系统 ANSI(GBK) 解码/编码，中文被替换成 `?`。服务端写入链路本身正常（用 Node 直接 POST 验证无误）。

**防护（纳入实施约束）**：
- 任何对 `dsh-enkeep-words.json` 的读写、以及与 `/dsh-enkeep-words/state` 的 JSON 往返，**只用 Node 显式 UTF-8**（`fs.readFileSync(f,'utf8')` / `JSON.stringify` + `fs.writeFileSync(f,...,'utf8')`），**禁止用 PowerShell 的 `ConvertFrom-Json`/`ConvertTo-Json`/`Set-Content`**。
- 实施阶段的关键字功能只改前端 `client.js`（浏览器内 JS 天然 UTF-8），不新增任何写盘脚本。
- 每次操作词库后必须校验：中文条数 > 0 且无 `???`。

---

## 1. 背景与用户诉求

用户在底部「常用词」面板点「＋ 添加」并输入内容后，词条**没有成功保存下来**；怀疑添加功能被删或没生效。同时希望添加时增加一个可填**关键字（keyword）**的输入框，让新增词自动带关键字存入词库。

---

## 2. 根因调研（已定位，确凿）

### 2.1 现有 UI 与保存链路

- 添加入口：`client.js:1500` 的「＋ 添加」按钮 → `setEditing(true)` → 显示 `ekeep-w-addRow`（`1449-1463`），只有一个输入框 `draftWord`（placeholder「输入词或句子…」）+ 确定/取消。
- 确定动作：`addWord`（`1396-1401`）：
  ```
  wordStore.upsert({ keyword: '', content: word, useCount: 0 },
                   state.mode === 'global' ? 'global' : 'project', projectKey)
  ```
  **关键字写死为空字符串** —— 这是"没有关键字输入框"的直接原因。
- 保存链路：`upsert → commit → persist(localStorage) → schedulePush → POST /dsh-enkeep-words/state`。
  `commit`（`1004`）确实会落 localStorage 并 800ms 后推服务端；服务端写入能力实测正常（POST 测试 rev 48→49 成功）。
  **所以"添加功能"没有被删除，服务端也没坏。**

### 2.2 真正的根因：`projectKey` 恒为 null，非 global 模式下 upsert 静默丢弃

- `projectKey = wordsNormalizeProject(cwd)`（`1324`），而 `cwd` 来自 `useSessions(s => s.byId[sessionId]?.cwd)`（`1321-1323`）。
- 官方 `conversation.input.right` 插槽在渲染时调用 `renderSlot("conversation.input.right", {})`（官方源码 `dsh-client-ui-conversation/lib/client.js:19080`）——**不传 `sessionId`**；该插槽的 inject 返回对象里也没有 `sessionId`。
- 因此 enkeep 拿到的 `props.sessionId === undefined` → `cwd === undefined` → `projectKey === null`。
- `upsert`（`1046-1057`）在 bucket 为 `'project'` 时有硬性守卫 `if (!key) return`：`projectKey` 为 null 时**直接返回，词条被静默丢弃**。

### 2.3 现象吻合

- 当前服务端 `mode=global`，19 条词全是 `legacy-*`（历史迁移数据，都在 global 桶）。
- 当模式处于 **global** 时，`addWord` 走 `'global'` 桶，不依赖 projectKey → **能存**（这正是历史 19 条在 global 的原因）。
- 当模式处于 **all / current**（`WORDS_MODES` 的另两个值）时，`addWord` 走 `'project'` 桶 + `projectKey=null` → **静默丢弃** → 用户看到"点了添加但没保存"。
- 结论：`all`/`current` 模式下的添加必然失败；`global` 模式下能存但关键字为空。两个问题叠加，正好解释用户描述。

### 2.4 keyword 字段确认

词库 v2 的 Prompt 形状本就是 `{ id, keyword, content, useCount }`（`872`、`886-888`），`keyword` 字段**早已存在**，不需要改 schema。设置页的 PromptsEditor 已在用关键字（`1590-1601`）。只需在快速添加面板补一个 keyword 输入框并传给 `upsert`。

---

## 3. 规划（步骤 + 内容 + 验收）

### 步骤一：修复 projectKey 为 null 时的添加丢弃

**内容**
- `addWord` 增加兜底：`projectKey === null` 时，不再写入必失败的 `'project'` 桶，改为写入 `'global'` 桶（保证任何模式下添加都能落地）。
- 或在 `upsert` 的 `'project'` 分支对 `!key` 做降级到 global（二选一，实施时取对其它调用面影响最小的；倾向改 `addWord`，因为 `favoriteSkill` 也调用 upsert 且依赖相同 projectKey，一并受益）。
- 保持 `global` 模式行为不变。
- 不修改词库 v2 schema、不新增依赖、不改服务端。

**验收**
- mock：`projectKey=null` 且 mode=all/current 时，addWord 后词出现在 global 桶且能落盘。
- mock：mode=global 时添加行为不变。
- mock：`favoriteSkill`（同样依赖 projectKey）在 null 时不再静默失败。
- 回归：19 条历史词、rev、schema 均未被改动。

### 步骤二：添加面板增加关键字输入框

**内容**
- 新增 state `draftKeyword`，与 `draftWord` 并列。
- `ekeep-w-addRow` 增加关键字 input（placeholder 如「关键字（可选）」），宽度/样式复用现有 `ekeep-w-addInput` 或新增一个紧凑变体，不与词库面板共享宽度变量。
- `addWord` 用 `draftKeyword.trim()` 作为 `keyword`（为空则保持 ''，与现有空关键字兼容）；`promptLabel` 会自动优先显示关键字。
- 提交后清空 `draftKeyword` 与 `draftWord`；Escape/取消同样清空两者。
- 复用现有 CSS 类，不新增 npm 依赖、不改 HTML 结构之外的东西。

**验收**
- mock：填关键字「审批」+ 内容「你仔细审核一下」→ upsert 收到 `{ keyword:'审批', content:'你仔细审核一下', useCount:0 }`。
- mock：关键字留空 → `keyword:''`，与旧行为一致。
- mock：确定/取消/Enter/Escape 后输入框状态正确清空。
- 面板样式与现有常用词面板一致，无宽度变量污染。

### 步骤三：回归 + 发布

**内容**
- `node --check client.js`。
- mock 覆盖：多模式添加、关键字有无、取消/转义、收藏技能、插入计数、归档 unpin、置顶修复（上一任务）、awaiting 状态（更早任务）无回归。
- 范围审核：仅 `client.js` 改动；无新依赖、无 schema 变更、不碰 skill-picker、依赖 URL 无 SHA、词库数据未变。
- 同步安装副本，`Get-FileHash` 校验源与副本一致。
- 提交推送，`HEAD == origin/main`，工作区干净。
- 重启 dsh web，核实页面 preload 含 enkeep、服务 200。

**验收**
- 全部 mock/静态检查通过。
- 哈希一致、HEAD 一致、工作区干净。
- 重启后服务正常。

---

## 4. 关键约束（钉死）

- 零新 npm 依赖、零构建。
- 不改词库 v2 schema：`{ id, keyword, content, useCount }` 与 `projects` 结构不变。
- 不加搜索框（用户明确不要）。
- 不碰 dsh-skill-picker / fork / guard 配置（已卸载，保持现状）。
- 依赖保持 `git+https://github.com/80779898/dsh-enkeep.git`，不带 `#SHA`。
- 保留 `dsh-enkeep-words.json` 与 `dsh-wordbox-state.json` 数据。
- 宽度隔离：面板样式只读不写 `--dsh-chat-content-width` / `--dsh-composer-card-max-width`。
- 不破坏上一任务的多置顶 stale-closure 修复，以及更早的 awaiting 状态、技能快捷插入。
