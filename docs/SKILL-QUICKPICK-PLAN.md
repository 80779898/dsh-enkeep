# dsh-enkeep 技能快捷插入（技能并入常用词体系）开发计划

> 目标：在 enkeep 现有的「常用词 / 快捷提示」体系上，增加**从本机已安装技能中选取、插入 `/技能名` 手势**的能力，从而**不再依赖 `dsh-skill-picker` 插件**（含其 fork + junction + 三处 UI 定制 + 守护规格）。
> 核心只有一件事：**选一个技能 → 往输入框插入 `/skill-name` 文本 → 用户发送消息 → DSH 原生识别手势并加载技能内容**。
> 约束：不新增任何 npm 依赖、不引入构建步骤、不改词库 v2 数据结构、不影响宽度隔离与现有功能；**本计划不含时间安排**，只列步骤、功能、技术与验收标准。
>
> 已拍板决策（用户已确认）：
> 1. 采用方案 A（宿主端只读扫描 + 前端并入常用词面板），不走「复用官方补全源」的方案 B。
> 2. 插入内容是 `/技能名` 手势本身，**不是文件路径、不是 SKILL.md 正文**。
> 3. **不新增搜索框**：技能清单排序后直接列出，靠滚动浏览；复用现有 `keyword` 字段做显示标签。
> 4. 保留现有手动添加常用词的能力，作为扫描遗漏时的兜底。
>
> 关键技术前提（已核查，非猜测）：
> - DSH 识别的是用户消息里的 `/技能名` 手势（`dsh-skill-picker` 的插入代码为 `setDraft(draft + sep + '/' + skill.name + ' ')`）。
> - 技能名 `skill.name` 来自 `SKILL.md` frontmatter 的 `name` 字段，缺省为技能目录名。
> - 官方技能目录是**四个**（与 `dsh-skill-filesystem` provider 一致）：用户级 `~/.agents/skills`、`~/.dsh/skills`，项目级 `<cwd>/.agents/skills`、`<cwd>/.dsh/skills`；低优先级先扫、高优先级同名覆盖（用户级 < 项目级）。
> - 过滤规则（缺一即失效）：legacy invocation keys（`disableModelInvocation` / `modelInvocable` / `userInvocable` 任一出现即整条丢弃）、`user-invocable` 布尔假值（`false/no/off/0`，大小写不敏感）、`SKILL.md.disabled` 的条目跳过（官方 provider 不加载，插入手势会静默失效）。
> - enkeep 已有宿主端只读路由范式（`ctx.webServer.register({ kind:'prefix', path:'/dsh-enkeep-words', handler })`）与自定义头校验（`x-dsh-enkeep-words: 1`），可直接照搬。
> - enkeep 词库 v2 条目为 `{ id, keyword, content, useCount }`，插入统一走 `wordStore.insert(id)` → 注册的 inserter → `inputActions.setDraft(content)`。

---

## 0. 总体架构与技术选型

```
宿主 index.js                          前端 client.js
+-------------------------+            +-------------------------------------+
| GET /dsh-enkeep-skills  |  fetch     | CommonWords 面板                     |
|  - 扫四个技能目录        | <--------> |  - 「技能」独立分区：列 name/desc   |
|  - 读 SKILL.md 的       |  JSON      |  - 「＋收藏」→ wordStore.upsert      |
|    name/description     |            |      { keyword, content:'/name ' }  |
|  - legacy keys / 布尔   |            |  - 收藏后走常用词/快捷条插入          |
|    假值 / 必填校验过滤 |            |  - 独立分区，不进 WORDS_MODES        |
+-------------------------+            +-------------------------------------+
                                                |
                                       common inserter → setDraft('/name ')
                                                |
                                       用户发送消息 → DSH 加载技能
```

- **数据流单向、只读**：技能扫描只读文件，绝不写/改/删任何技能文件；收藏只写 enkeep 自己的词库。
- **数据模型**：技能收藏后就是一条普通 v2 Prompt，`content = '/技能名 '`（带尾空格，分隔手势与后续输入）。**不引入 `kind:'skill'` 之类的新类型字段**——这样现有的三路合并、持久化、置顶、频率排序、跨端共享全部零改动。
- **网关**：与词库路由一致，新增安全头 `x-dsh-enkeep-skills: 1`（插件路由在鉴权门之外，自定义头是那道门）。
- **失败降级**：扫描失败 / 路由不可用时，前端静默显示空技能列表，常用词本身照常可用。

---

## 1. 步骤一：宿主端技能扫描 + 只读路由

### 功能
在 `index.js` 增加：
1. `scanSkills(cwd)`：扫描**四个**技能目录，返回 `[{ name, description }]`。
2. `GET /dsh-enkeep-skills?cwd=…`：带安全头的只读 JSON 路由，`cwd` 来自当前 session，用于项目级目录。

### 技术
- `node:fs/promises` 的 `readdir`（`withFileTypes`）/`readFile`/`stat`；`node:path`；`process.env.DSH_HOME` / `DSH_AGENTS_HOME`，fallback `os.homedir()`。
- 四个目录按**低→高优先级**顺序扫，用 `Map` 按 name 去重（后写覆盖，高优先级胜出）：① `~/.agents/skills`（用户级，最低）② `~/.dsh/skills`（用户级）③ `<cwd>/.agents/skills`（项目级）④ `<cwd>/.dsh/skills`（项目级，最高）。跟随 symlink/junction（`stat` 判目录）。
- frontmatter 解析：正则 `^---\r?\n([\s\S]*?)\r?\n---` 取块，按行拆 `key: value`（YAML 平坦子集），去引号。
- **官方两种布局都支持**：目录 bundle `<name>/SKILL.md` 与扫描根顶层的平铺文件 `<name>.md`（不递归嵌套 `**/SKILL.md`）。
- **过滤（缺一即失效，逐条对齐官方 provider）**：① legacy keys `disableModelInvocation`/`modelInvocable`/`userInvocable` 任一作为 key 出现 → 整条丢弃；② `user-invocable` 布尔假值（`false/no/off/0`，大小写不敏感，解析异常也丢弃，缺省视为可调用）→ 排除；③ `disable-model-invocation` 值非法 → 整条丢弃（只有 `true` 影响模型面，不排除用户调用）；④ 无 frontmatter、`name`/`description` 缺失或空、或 `name` 不匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$` → 丢弃；⑤ 仅存在 `SKILL.md.disabled`（官方不加载）→ 丢弃；⑥ 用户级 `~/.dsh/skills` 下的 `.system` 目录跳过。
- 路由：复用 `ctx.webServer.register({ kind:'prefix', path:'/dsh-enkeep-skills', handler })`；`cwd` 从 query 取并校验（字符串、绝对路径、存在的目录），非 `GET` 返回 405，缺安全头返回 403，异常返回 500 JSON。

### 完成标准
- `scanSkills(cwd)` 对不存在的目录返回 `[]`，不抛错；cwd 为空时只扫两个用户级目录；目录 bundle 与平铺 `.md` 都能识别。
- 上述六条过滤规则逐条生效；同名技能只保留最高优先级的一条；列表按 name 排序稳定。
- 路由只读、无写操作，安全头与状态码正确。

### 验收
- `node --check index.js` 通过。
- 单元脚本（mock fs）：造四个临时目录（用户级2+项目级2）+ 若干 `SKILL.md`/平铺 `.md`，覆盖 含name/无name/无description/无frontmatter/非法name/`user-invocable: false|no|0`/legacy key/非法布尔/仅`.disabled`/`.system`目录/项目级覆盖用户级同名/symlink技能；断言返回内容、去重、排序全对。
- 端到端：启动 dsh web（**必须重启**，见步骤五），`curl` 带/不带安全头各请求一次，断言 200 / 403；响应是 `{ ok:true, skills:[...] }`。

### 成功标准
返回列表与官方 `/` 补全可见的技能集一致（同一套目录、优先级与过滤规则）；只读、无副作用、无新依赖。

---

## 2. 步骤二：前端技能来源数据层

### 功能
在 `client.js` 增加一个轻量技能数据源（hook 或模块级 state）：
- 面板打开时 `fetch('/dsh-enkeep-skills?cwd=' + encodeURIComponent(cwd||''), { headers: { 'x-dsh-enkeep-skills':'1' } })`，`cwd` 取当前 session 的 workspace 根目录（项目级技能所需）。
- 维护 `skills` 列表 state、加载中 / 失败标志。
- 提供手动「刷新」入口（重新 fetch），应对新装技能。

### 技术
- `fetch` + `AbortController`（面板关闭时中止，避免卸载后 setState）。
- `React.useState` / `React.useEffect`；失败时 `skills=[]`，只 `console.warn` 一次。
- 与词库同步的轮询（`WORDS_SYNC_POLL_MS`）互不干扰：技能列表只在面板打开/手动刷新时拉取，不进定时轮询。

### 完成标准
- 面板关闭后不会因迟到的 fetch 结果更新 state。
- 同一时刻最多一个在途请求（刷新时先中止旧的）。
- 技能列表按 `name` 排序（与宿主端返回顺序一致，前端不再重排）。

### 验收
- mock `fetch`：成功返回列表 → state 正确；返回 403/500 → state 为空且无未捕获异常。
- 快速开关面板两次 → 无 "setState on unmounted" 类告警（mock 里表现为无迟到写 state）。

### 成功标准
打开面板即可见到已安装技能清单；网络/宿主异常时优雅降级，不影响词库其他功能。

---

## 3. 步骤三：面板内「技能」来源与收藏

### 功能
在 `CommonWords` 面板里新增一个**独立的「技能」分区**——它是一个 tab/视图切换（面板内新增 `view` state：`'words' | 'skills'`），**不进 `WORDS_MODES` 枚举、不写 localStorage**；现有「全部/全局/当前」显示范围保持不动：
- 列出 `skills` 的 `name` 与 `description`（title 提示全文）。
- 每条右侧一个「＋收藏」按钮：调用 `wordStore.upsert({ keyword: name, content: '/'+name+' ', useCount: 0 }, 'global'|'project', projectKey)`（尾空格分隔手势与后续输入）。
- 已收藏态按词库中存在 `content === '/'+name+' '` 的条目判断，显示「已收藏」并禁用重复收藏。
- 分区顶部提供「刷新技能」按钮（重新 fetch）。

### 技术
- 复用 `wordStore.upsert` / `getSnapshot`；**id 由 store 自动生成**（稳定唯一），不手工拼 id。
- 显示样式复用 `ekeep-w-*` 类（`ekeep-w-list` / `ekeep-w-row` 等），只新增必要的「技能」分区标识与收藏按钮样式，沿用现有主题 token。
- 收藏目标桶跟随当前 `state.mode`（global → 全局，current/all → 当前项目），与现有「＋添加」行为完全一致。
- **不新增搜索框**（用户决定）：技能列表按 name 排序直接滚动浏览。

### 完成标准
- 收藏点击后，词库立即多出一条 `content:'/name '`（带尾空格）的 Prompt；重复点击同一技能不产生第二条。
- 收藏后切到「全部/全局」视图能看到该条，并出现在快捷提示条的候选中（受 `quickPromptCount` 限制）。
- 不修改 `normalizePrompt` / `mergePrompts` / 同步协议（因为没引入新字段）。

### 验收
- mock `wordStore.upsert`：断言写入参数 `content === '/技能名 '`（带尾空格）、`keyword` 非空、`useCount === 0`。
- 收藏两条不同技能 → 列表中两条、content 各不相同；重复收藏同一条 → 仍只有一条。
- 回归测试：词库 v2 合并（base/theirs/mine 三路）、重置计数、全局/项目模式切换全部仍通过。

### 成功标准
在面板里能把「本机技能」一键变成「常用词条目」，且完全落在既有 v2 数据模型内，无 schema 变更、无同步协议变更。

---

## 4. 步骤四：插入手势与端到端打通

### 功能
- 点击收藏后的技能 Prompt（无论来自快捷提示条还是面板列表），走既有 `wordStore.insert(id)` → inserter → `inputActions.setDraft` 链路，把 `/skill-name ` 插入输入框。
- 用户补齐正文并发送，DSH 原生加载对应技能。

### 技术
- **不写新的插入代码**：`QuickPrompts` 与 `CommonWords` 已各自注册 inserter，`wordStore.insert` 会把 `content`（即 `/name `，含尾空格）追加到 draft（现有 `base + sep + content` 逻辑，sep 保证词间空格）。
- 需要确认 `inputActions.setDraft` 对「以 `/` 开头的纯手势文本」不转义、不拦截（参照 skill-picker 的成功先例：它就是这么做且已上线可用）。

### 完成标准
- 点击技能 chip 后，输入框文本末尾出现 `/name `（带尾空格）。
- 连续点两个技能 → 两个手势以空格分隔共存。
- `useCount` +1 并持久化，频率排序随之更新。

### 验收
- mock `inputActions.setDraft`：断言收到文本包含 `/技能名 `；连续两次点击得到 `'/a /b '` 形态。
- 全量回归：常用词增删改、快捷栏 top-N、设置页、活动区（置顶/归档/重命名）、宽度隔离全部通过。
- **真实浏览器验收（用户侧）**：**先重启 dsh web**（宿主路由新增）→ 刷新页面 → 打开「词」面板 → 切到「技能」分区 → 收藏一个技能 → 点 chip → 输入框出现 `/技能名` → 发送 → 确认技能内容随消息加载。（本环境无 DOM/截图能力，此项需用户确认。）

### 成功标准
端到端「选技能 → 插入 → 发送 → 技能加载」真实跑通；现有功能零回退。

---

## 5. 步骤五：全面检查与收尾

### 功能
对本次改动做完整审核与验证，交付前收口。

### 技术 / 动作
- `node --check client.js` 与 `node --check index.js`。
- mock 全量回归（词库 v2 / 三路合并 / 置顶常显 / 成对调用 / 归档二次确认 / 重命名错误 / 宽度隔离 / 新增扫描与收藏）。
- 审核改动范围：只动 `client.js` + `index.js`（+ 本计划文档），无文件删除。
- 依赖约束：`profiles/web/package.json` 中 `dsh-enkeep` 仍是 `git+https://github.com/80779898/dsh-enkeep.git`，无 `#SHA`。
- 数据保护：`dsh-enkeep-words.json`（词库）、`dsh-wordbox-state.json`（备份）保留。
- 同步安装副本：把 `client.js` / `index.js` 拷到 `profiles/web/node_modules/dsh-enkeep/`，哈希一致。
- 提交并推送。

### 完成标准
- 所有测试脚本退出码 0；无调试残留；工作区干净。
- `HEAD == origin/main`。

### 成功标准
换机 / 升级 DSH 后，功能仍可用（因为全部是 enkeep 自己的代码，不依赖任何 fork 或插件）。
**注意：本方案在宿主端 `index.js` 新增了路由，必须重启 dsh web（VSCode 里 `DeepSeek Harness: 重启 dsh web`）后路由才注册；之后再刷新页面即可使用。** 仅刷新页面会出现 `404 /dsh-enkeep-skills`、技能列表为空。

---

## 6. 明确不做的事（范围边界）

| 不做 | 原因 |
|---|---|
| 不新增搜索框 | 用户明确不考虑；技能清单排序后直接列出 |
| 不引入 fuzzysort / pinyin-pro / esbuild | 保持零新依赖、零构建 |
| 不做技能的启用/禁用/卸载 | 这些属于技能管理，不是「选取插入」 |
| 不接管官方 `/` 补全源 | 这是方案 B 的脆弱耦合，已放弃 |
| 不存文件路径到词库 | 插入手势只需 name；保持 v2 数据结构不变 |
| 不修改 skill-picker / 其 fork / 守护配置 | 本方案目标是完全绕开它，不与其产生新耦合 |

## 7. 风险与降级

| 风险 | 处置 |
|---|---|
| 官方改了技能目录约定或 frontmatter 规则 | 扫描规则集中在 `scanSkills()` 一处，改一处即可；失败时降级为空列表 |
| 新装技能后列表未刷新 | 面板提供手动「刷新」按钮 |
| 技能被禁用/改名后 `/name` 失效 | 用户可见并可删除该常用词；低风险 |
| 宿主路由未注册（旧版 dsh 或 webServer 不可用） | 前端 fetch 失败降级为空，常用词本身不受影响 |

> 本计划完成后，可与用户确认是否卸载 `dsh-skill-picker` 并从 `guard-plugins.json` 移除（按「先改清单 → 再卸载 → 归档 fork」顺序），作为独立的后续步骤，不在本计划内。
