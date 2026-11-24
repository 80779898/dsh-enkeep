# 活动区会话数量上限（默认 20，可配置）—— 开发计划

> 状态：**规划中（未实施）** —— 只规划步骤与内容（功能 + 技术），不含时间安排
> 落点：`client.js` + **`index.js`（本次必须改）**。
> 需求：活动区悬浮条当前会话条数无实际限制（硬编码 `MAX_ITEMS = 30`），
> 改为**默认 20**，且可在设置页「活动区」页签修改（number 输入，带合理范围）。

---

## 1. 目标与用户诉求

1. 活动区默认最多显示 **20** 个会话（当前是硬编码 30，且用户感知"没有限制"）。
2. 上限值可在**设置页 → 活动区**页签里修改（与现有"时间窗（小时）"同款 number 输入）。
3. 修改后**即时生效**（无需重启 web / 无需刷新插件），刷新页面后保持。
4. 置顶会话、运行中、未读、等待互动等既有筛选/状态逻辑**完全不变**——本次只把"截断数量"从常量改为可配置值。
   - **排序口径已更新（用户后续拍板）**：**按活动时间筛选过滤，排序按 updatedAt 倒序（最近活动在前）、Id 字典序兜底**。
     （本计划最初记为"维持 SessionId 字典序、不要改成最近更新优先"；用户已另行拍板改为最近更新优先，以下排序相关描述均已按最新决定同步更新。）

---

## 2. 现状调研（已确认事实）

### 2.1 上限在哪里、怎么生效
- `client.js:679`：`const MAX_ITEMS = 30`（硬编码常量）。
- `client.js:692` `selectActivity(sessions, statuses, archivedIds, hours, now, pinnedSet)`：
  筛选（时间窗/运行/未读/置顶/等待互动）→ 排序（置顶区在前、各自按 updatedAt 倒序、Id 兜底）→ `735` 行
  `return pinnedRows.concat(normalRows).slice(0, MAX_ITEMS)`。
- **截断发生在排序之后、按 updatedAt 倒序**——当前"前 N 个"是 updatedAt 最新的 N 个（最近活动在前，置顶区优先；同时间按 Id 字典序兜底）。
- `selectActivity` 是纯函数，调用点在 `client.js:1341`，传参含 `hours`；`MAX_ITEMS` 目前是闭包常量，不是入参。

### 2.2 已有的同类配置模式（照搬它）
- **时间窗 `activityWindowHours`** 是现成模板，数据流完整：
  - **schema 默认值**：`index.js:34` `Schema.number().step(1).min(1).max(720).default(24).volatile()`。
  - **配置页输入**：`client.js:2312-2318`（number，min1/max720/step1，`onChange` 校验后 `set('activityWindowHours', n)`）。
  - **活动条订阅**：`client.js:1126-1134`（`form.subscribe` + 初次读取，`setHours`，带 `Number.isFinite && >=1` 校验与默认值回退）。
  - **消费**：`client.js:1341` 把 `hours` 传入 `selectActivity`。
  - **注入**：`client.js:2535` inject 里带 `form`，`ActivityBar({ form, ... })` 接收（1075 行）。
- **配置字段必须 volatile**：`index.js` 注释明确——非 volatile 的字段，Client 的 `configForms` 写入会被 Host 拒绝。
- **`quickPromptCount`（1~12，默认6）** 是第二个同类模板（number + clamp），可参考其边界钳制写法（2155/2282-2283/2331-2337）。

### 2.3 配置页结构
- `EnkeepSettingsBody`（2272 行）有页签：`prompts` / `width` / `activity` /（默认 tab，见 SETTINGS_TABS）。
- `activity` 页签（2307-2319）当前只有"时间窗（小时）"一项。新增上限输入**放在同一页签**即可。
- `set(field, v)`（2285-2289）封装 `form.set`，带 busy 防抖 + 强制重渲染。

---

## 3. 技术方案总览

```
index.js（Config schema，本次必须改）
  └─ 新增 activityItemLimit: Schema.number().step(1).min(N_MIN).max(N_MAX).default(20).volatile()
     apply() 的诊断日志可选加一项（非必须）

client.js
  ├─ selectActivity 签名增加入参 limit（或 itemLimit），末尾 .slice(0, limit)
  │    — 移除/替换闭包常量 MAX_ITEMS=30；保留一个模块级 DEFAULT=20 兜底
  ├─ ActivityBar：参照 hours 的订阅模式，新增 state limit + form.subscribe 读取/校验/回退
  │    — 调用点 1341 把 limit 传入 selectActivity
  └─ 设置页 activity 页签：新增 number 输入（min/max/step，onChange 校验后 set('activityItemLimit', n)）
```

- **技术**：沿用现有 `configForms` volatile 配置机制 + React state 订阅 + 纯函数 `selectActivity` 加参数。
- **零新增依赖、零构建、不碰 single slot、不写宽度变量、不重启 dsh web**（用户手动刷新）。
- **兼容性**：旧配置没有该字段时，schema `.default(20)` + 客户端 `Number.isFinite && 范围校验 ? 值 : 20` 双重回退，保证一定有合法上限。

---

## 4. 实施步骤

### 步骤一：index.js 增加配置字段（默认值 20）
**功能**：定义 `activityItemLimit` 配置字段，默认 20，volatile（可即时写入）。
**技术**：在 `Config = Schema.object({...})` 里仿照 `activityWindowHours` 增加一行：
`activityItemLimit: Schema.number().step(1).min(1).max(200).default(20).volatile()`。
范围建议 1~200（够用且防止极端值拖垮渲染；与"时间窗 1~720"相对，条数不宜过大）。
可选：在 `apply()` 的诊断日志里加 `activityItemLimit=%s`（便于排障，非必须）。
**完成定义**：schema 校验通过，字段可读可写、默认 20。
**验收标准**
- 静态：`default(20)` + `.volatile()` 俱全；min/max/step 合理。
- 不破坏其它字段；index.js 仅新增该字段（及可选日志），无其它改动。
- `node --check` 不能直接查 ESM schema，须靠后续真实页面验证。

### 步骤二：client.js 让 selectActivity 接受上限参数
**功能**：把截断数量从硬编码 30 改为入参，默认回退 20。
**技术**
- 删除/保留并弃用 `const MAX_ITEMS = 30`（`679`），新增模块级 `const DEFAULT_ITEM_LIMIT = 20`。
- `selectActivity(..., pinnedSet, itemLimit)`：`const limit = clampLimit(itemLimit)`，末尾 `.slice(0, limit)`。
  `clampLimit = (n) => Number.isFinite(n) ? Math.max(1, Math.min(200, Math.trunc(n))) : DEFAULT_ITEM_LIMIT`。
- 只替换 `.slice(0, ...)` 的来源；排序口径按最新决定为 updatedAt 倒序（Id 兜底）。
**完成定义**：传入不同 limit 时返回条数相应变化；筛选不变、排序按 updatedAt 倒序（Id 兜底）。
**验收标准**
- 静态：`slice(0, limit)` 用的是校验后的值，不是裸入参；默认值 20。
- 纯函数行为：limit=1 → 最多1条；limit=200 → 最多200条；传 NaN/0/负数 → 回退 20 或钳到 1（按实现）。
- 置顶优先、updatedAt 倒序（Id 兜底）、状态判定与改前一致（对比改动前后 items 顺序）。

### 步骤三：ActivityBar 订阅新配置并传入
**功能**：活动条从 config 读取上限，配置变化时即时重渲染并重算列表。
**技术**：仿照 `hours`（1126-1134）新增
```js
const [limit, setLimit] = React.useState(DEFAULT_ITEM_LIMIT)
React.useEffect(() => form.subscribe(() => {
  const n = Number((form.getSnapshot().value || {}).activityItemLimit)
  setLimit(Number.isFinite(n) && n >= 1 && n <= 200 ? Math.trunc(n) : DEFAULT_ITEM_LIMIT)
}), [form])
React.useEffect(() => { /* 同上初次读取 */ }, [form])
```
调用点（1341）改为 `selectActivity(sessions, statuses, archived, hours, Date.now(), pinnedSet, limit)`。
**完成定义**：设置页改上限后，活动条条数即时变化（≤1 帧），刷新后保持。
**验收标准**
- 静态：有 subscribe + 初次读取两个 effect，含范围校验与 20 回退；`form` 已在 inject（2535）传入。
- 动态：设置页把上限改为 5 → 活动条立即只显示 5 条；改回 20 → 恢复；无报错。
- 旧会话（无该配置字段）→ 回退 20，不崩。

### 步骤四：设置页加入上限输入
**功能**：设置页「活动区」页签新增可编辑的数量输入。
**技术**：在 2307-2319 的 activity pane 里，"时间窗"label 之后追加：
```js
h('label', { ... },
  h('span', null, '最多显示会话数（1~200）'),
  h('input', { type:'number', min:1, max:200, step:1, value: limit, disabled: busy.current, style: numStyle,
    onChange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n>=1 && n<=200) set('activityItemLimit', n) } }),
  h('span', { style:{fontSize:12,opacity:0.6} }, '活动区最多列出 N 个会话（置顶仍优先）'))
```
`EnkeepSettingsBody` 里新增 `const limitRaw = Number(value.activityItemLimit); const limit = ... : 20`（仿 2280-2281 的 hours）。
**完成定义**：设置页能显示当前上限、能修改、能持久。
**验收标准**
- 静态：输入范围与 schema（1~200）一致；onChange 有校验；默认值文案正确。
- 动态：改值后输入框显示新值、活动条同步；刷新页面值保持。
- UI：与"时间窗"输入风格一致（复用 numStyle / label 布局）。

### 步骤五：更新升级适配档案
**功能**：把新配置项登记到 `UPGRADE-ADAPTATION.md`。
**技术**：在 §6 常量清单加 `activityItemLimit`（自有配置字段），§1/§3 功能2 补一句"条数上限可配置（默认20）"，版本历史加一条。
**完成定义**：文档与实现一致。
**验收标准**：文档提到的字段名/默认值/范围与代码完全相同。

### 步骤六：提交与交付
**验收标准**
- `node --check client.js` 通过；index.js 语法合法。
- 仓库 client.js 与安装副本 SHA256 一致（**index.js 也需同步安装副本**——本次改了它）。
- `HEAD == origin/main`，工作区干净。
- 依赖 URL 无 `#SHA`；未重启 dsh web。

---

## 5. 成功标准（总验收）

1. 活动区默认最多 20 条（改前是 30）。
2. 设置页「活动区」可改上限（1~200），即时生效、刷新保持。
3. 置顶优先 / updatedAt 倒序（Id 兜底）/ 五种状态 / 时间窗筛选等既有逻辑保持。
4. 旧配置无该字段时回退 20；非法值钳制/回退，不崩。
5. index.js + client.js 两份文件改动都同步安装副本、哈希一致、提交推送。
6. 零新增依赖、零构建、不碰 single slot、不写宽度变量、不重启 web。

---

## 6. 已知行为（本次不改，但需知晓）

- **截断按 updatedAt 倒序，最近活动在前（用户已拍板）**：活动时间是**筛选条件**（哪些会话够格入选），
  同时也是排序依据；入选后排的是 updatedAt 倒序（置顶区在前，时间相同按 Id 字典序兜底）。
  所以"最多 20 个"= updatedAt 最新的 20 个（置顶优先）。列表会随聊天刷新 updatedAt 而变化，这是拍板后的预期行为。
- **置顶会话也计入上限**：当前 `.slice(0, MAX_ITEMS)` 作用在"置顶区+普通区"拼接后的总列表上，
  置顶多时普通区可能被全截掉。这是既有行为，本次保持。
- **上限范围上限 200 的取舍**：纯展示列表，过大无意义且影响渲染，取 200 封顶；如用户要更大，改 schema/input/客户端 clamp 三处即可。

---

## 7. 已确认决策（用户拍板）

1. **截断顺序**：**按活动时间筛选过滤，排序按 updatedAt 倒序（最近活动在前）、Id 字典序兜底**（用户后续拍板，替代原"维持字典序"的决定）。
2. **默认值**：**20**（不是 15）；范围仍取 1~200。若以后要改数值，改四处（schema default + max、input、clampLimit、文档）。
3. **置顶优先**：**保持现状**——置顶排在普通区之前（`pinnedRows.concat(normalRows)`），且置顶计入上限名额。若想"置顶不占额"，需改 slice 位置，属行为变更，本次不做。
