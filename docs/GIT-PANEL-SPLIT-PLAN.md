# git-panel 上下列表比例 + 分割线可拖动 —— 开发计划

> 状态：已规划，待实施
> 落点：写在我们自己的 `dsh-enkeep` 插件（`client.js`，纯前端），**不改 git-panel 文件、不 fork、不补丁第三方**
> 本计划不含时间安排，只列步骤、内容（功能 + 技术）、每步完成定义、验收标准、成功标准

---

## 1. 目标

允许用户在 dsh-git-panel 面板里：
1. 调整「上方变动文件列表」与「下方分支/提交图列表」的高度比例；
2. 通过**拖动两者之间的横向分割线**实时调整，位置被记住，双击复位。

且 git-panel **未安装时对本插件零影响**。

---

## 2. 现状调研（已确认事实）

- git-panel 是第三方 npm 包 `dsh-git-panel@0.1.20`，受 guard 守护（webOnly，版本精确）。宿主侧无 Config schema，无官方比例/高度开关。
- 面板根元素 `.dsh-gp`，DOM 自上而下：
  - `.dsh-gp-write`（`border-bottom` 那条线）：内含提交输入区 + `.dsh-gp-changes` 变动文件列表（`.dsh-gp-changes-list` 限高 `140px`，内联 diff `.dsh-gp-changes-pre` 限高 `240px`）。
  - `.dsh-gp-body`（`flex:1`，可滚动）：下方的分支/提交图列表。
- 中间的横向分割线即 `.dsh-gp-write` 的底边 / `.dsh-gp-changes` 区块与 `.dsh-gp-body` 的交界。
- 上半高度目前由 `140px`/`240px` 两个固定上限间接决定，下半 `flex:1` 吃剩余；没有比例参数。
- 两边 CSS 都注入同一个 `document.head`，enkeep 已在用 `data-plugin-css` + `<style>` 的幂等注入模式（`installWideStyle` 等），可复用。
- enkeep 与 git-panel 之间无任何代码依赖；enkeep 是独立 bundle 模块。

---

## 3. 技术方案总览

- **作用域隔离**：所有 CSS 选择器以 `.dsh-gp` 开头，绝不写全局裸选择器。
- **高度变量化**：把上半区高度交给一个自定义属性 `--enkeep-gp-top-h`（默认 `auto`，即保持原样），拖动时写 px 值到 `.dsh-gp` 根元素 style（局部，不写 `:root`/`body`）。
- **拖动手柄**：优先用 `.dsh-gp-write` 的 `::after` 伪元素画视觉手柄，**不插入真实 DOM**（避免被 git-panel 的 React 重渲染冲掉）；在 `.dsh-gp-write` 上监听 `pointerdown`，仅当按下点落在底边 ±N px 内才进入拖动。
- **面板发现**：`MutationObserver` 观察 DOM，找到 `.dsh-gp` 后才绑定事件；面板消失即解绑。
- **持久化**：`localStorage` 键 `dsh.enkeep.gp.topH.v1`；双击复位删除该键并回到 `auto`。
- **防御式**：所有 DOM 访问前判空，null 立即退出；整段逻辑 try/catch 兜底，任何意外都不影响 enkeep 自身功能。

---

## 4. 实施步骤

### 步骤一：防御式框架 + CSS 变量化（先把比例变成"可配置"，静态）

**功能**
- 注入一段仅作用于 `.dsh-gp` 的覆盖样式，把上半区高度交给 CSS 变量控制；默认不改变现有外观。
- 建立对 `.dsh-gp` 面板的发现/观察机制，全部判空、try/catch。

**技术**
- 新增 `installGitPanelStyle()`，复用 `data-plugin-css`（如 `enkeep-gitpanel`）幂等注入 + disposer。
- CSS 要点：
  - `.dsh-gp .dsh-gp-write{height:var(--enkeep-gp-top-h,auto);flex:none;overflow:hidden}`
  - `.dsh-gp .dsh-gp-changes{flex:1;min-height:0;overflow-y:auto}`（上半区变紧时自身滚动）
  - `.dsh-gp-body` 保持 `flex:1;min-height:0`（下半区吃剩余）
- `MutationObserver` 观察 `document.body` 子树，回调里 `querySelector('.dsh-gp')`，找不到就退出；找到记录引用供步骤二用。

**完成定义**
- CSS 注入幂等、可清理；观察器就位；git-panel 装/不装都不报错。

**验收标准**
- 静态检查：新增选择器全部带 `.dsh-gp` 前缀，无裸选择器。
- 静态检查：所有 `querySelector`/DOM 访问前有 null 判断。
- mock：页面无 `.dsh-gp` 时，观察回调不产生任何写入、无 throw。
- mock：`--enkeep-gp-top-h` 未设时，覆盖样式等价于原样（`height:auto`）。
- 宽度隔离：未写 `--dsh-chat-content-width` / `--dsh-composer-card-max-width`。

**成功标准**
git-panel 安装与未安装两种情况下，enkeep 全部既有功能正常、无 console 报错；CSS 仅在 `.dsh-gp` 存在时生效，未拖动时面板外观与改动前完全一致。

---

### 步骤二：横向分割线拖动手柄 + 位置持久化

**功能**
- 在上下两区交界的分割线处提供可拖动视觉手柄；按住拖动实时改上半区高度（即比例）。
- 位置写入 localStorage；双击复位到默认（`auto`）。

**技术**
- `::after` 伪元素画手柄（`cursor:row-resize`，hover 高亮），用 `.dsh-gp-write` 的定位上下文。
- `pointerdown`：计算按下点相对 `.dsh-gp-write` 底边的偏移，±N px 内才 `preventDefault` 并进入拖动；绑定 `pointermove`/`pointerup`（挂 window，up 时解绑）。
- 拖动值 `clamp`：最小高度（如 120px）≤ value ≤ 面板高度 − 最小下半高度（如 120px）；写入 `.dsh-gp.style.setProperty('--enkeep-gp-top-h', px)`。
- 双击 `.dsh-gp-write` 底边区域：删除 localStorage 键、`removeProperty` 变量，回到 `auto`。
- `localStorage` 读写用 try/catch；页面初始化时若存有值且找到 `.dsh-gp`，恢复该值。
- 面板消失（观察器检测）时解绑事件、清理定时器。

**完成定义**
- 可拖动、实时改变比例、刷新后保留、双击复位；全程防御式、不污染全局。

**验收标准**
- mock：pointerdown 在底边外不触发拖动；在底边内触发。
- mock：拖动值被 clamp 在 [min, 面板高−min] 区间。
- mock：变量写在 `.dsh-gp` 元素 style 上，未写 `:root`/`body`。
- mock：localStorage 键写入/读取/双击删除正确。
- mock：面板消失后事件解绑、无残留监听。
- 未安装 git-panel：手柄逻辑不绑定、无报错。

**成功标准**
用户能拖动分割线实时改变上下比例，松手后位置持久化、刷新仍保留，双击恢复默认；过程中 enkeep 与 git-panel 均无异常。

---

### 步骤三：全面回归 + 发布

**功能**
- 回归所有既有功能，审核改动范围，同步安装副本并发布。

**技术**
- `node --check client.js`。
- mock 全量回归：本功能多场景 + 既有活动栏（多置顶 stale-closure 修复）、常用词 v2、技能快捷插入、awaiting 状态、宽度隔离。
- 范围审核：仅 `client.js` + 新文档改动；无新依赖、无构建、无 schema 变更、不碰 skill-picker、依赖 URL 无 SHA、词库数据未变。
- 同步安装副本，`Get-FileHash` 校验源与副本一致。
- 提交推送，`HEAD == origin/main`，工作区干净。
- 重启 dsh web，核实服务 200、页面 preload 含 enkeep。

**完成定义**
- 所有检查通过，工作区干净，线上副本含新代码。

**验收标准**
- 全部 mock/静态检查通过（含"未安装 git-panel"用例）。
- 哈希一致、HEAD 一致、安装副本含拖动代码。
- 重启后服务正常。

**成功标准**
发布完成且可回滚；刷新页面后功能可用，git-panel 装/不装互不干扰。

---

## 5. 关键约束（钉死）

- 零新 npm 依赖、零构建。
- 只改 `client.js`（+ 规划文档），**不改 git-panel 的 lib 文件、不 fork、不加 manifest 补丁**。
- 所有 CSS 以 `.dsh-gp` 前缀限定作用域；变量只写在 `.dsh-gp` 元素上，不写 `:root`/`body`。
- 宽度隔离：不写 `--dsh-chat-content-width` / `--dsh-composer-card-max-width`。
- **健壮性硬要求**：git-panel 未安装/被卸载时，enkeep 零影响、无报错、无死循环；装了但 React 重渲染时手柄不被冲掉、绑定不丢失。
- 不动词库 v2 schema、不碰 skill-picker、依赖保持 `git+https://github.com/80779898/dsh-enkeep.git`（无 SHA）。
- 不破坏既有功能：多置顶修复、awaiting、技能快捷插入、常用词面板。
- 严禁再用 PowerShell 的 `ConvertFrom-Json`/`ConvertTo-Json`/`Set-Content` 处理中文词库数据（详见 `COMMON-WORDS-ADD-PLAN.md` 的事故记录）。

---

## 6. 风险与兜底

| 风险 | 兜底 |
|---|---|
| git-panel 升级改了 `.dsh-gp-*` class 名 | 覆盖仅失效不报错；enkeep 其它功能不受影响；届时按需更新选择器 |
| React 重渲染冲掉手柄/绑定 | 用伪元素 + 事件委托，不插入真实 DOM；观察器在面板重建后重新绑定 |
| 拖动值极端导致某区块不可见 | clamp 保证上下各留最小高度（如 120px） |
| localStorage 存了异常值 | 读取时校验数值类型与范围，非法则忽略并回 `auto` |
| 多实例 `.dsh-gp` | 每个根元素独立绑定、变量写在各自根元素上，互不干扰 |
