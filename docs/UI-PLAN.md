# dsh-enkeep UI 改造规划（方案评估稿）

> 状态：**用户已拍板**（2026-11-18）——见文末「六、已确认决策」
> 本机版本：DSH 0.2.1-rc.2；评估基于官方文档 + 本机已安装 bundle 交叉验证
> 约束：不依赖其他插件（dsh-wordbox 等），在原生基础上实现

---

## 一、需求解读

1. ~~侧边栏位置~~ **（不做，用户已确认）**。
2. **主聊天宽度**：窄屏 / 宽屏可切换；窄屏用原生样式，宽屏用当前定制设计（640px 下限、去掉 920px 硬顶）。
3. **启动按钮 + 开关**：在侧边栏"工作区"上方增加本插件的点开按钮，默认显示，且可在设置页选择不显示。

### 参照样本：本机 `@xmanrui/dsh-im`（v5.7.0）的实现（用户指定参考）

客户端半侧 `lib/client.js` 的做法，与官方范式一致，可直接照抄：

| 能力 | dsh-im 的做法 | 文件位置 |
|---|---|---|
| 侧栏按钮 | `pageCtx.slots.inject('main', ...)` 里注册 `main` keyed 面板（`key: IM_MAIN_PANEL_ID`），再按 `visible` 注册/注销 `sidebar.panellist`（`id`、`order:10`、`label`、`ImSidebarIcon`） | `installImPluginPage` @1777024 |
| 点击行为 | `onOpen: () => pageCtx.layout.selectPanel(PANEL_ID)` —— 点图标在中央区打开面板 | 同处 `plugins.detail.actions` 注册 |
| 显隐开关 | `visible` 为真才注册 sidebar slot；值来自 RPC `settings.sidebar-entry.get/set`（`mode:auto/show/hide` + `visible`） | `plugin-src/client/sidebar-settings.js` @1586731 |
| 设置页 | `slots.inject('settings.section')` 注册 `id:'xmanrui-dsh-im'` 的设置页，里面改显隐 | @1799831 |
| 会话行徽标 | `sidebar.session.row.leading` list slot 增量注册 | @1744090 |

> 结论：需求 3 有现成、可照抄的成熟范式——`sidebar.panellist` 挂按钮 + `main` keyed 面板 + `settings.section` 设置页 + 布尔显隐。这正是我们要的方案。

## 二、可行性总表（核心结论）

| 需求 | 纯插件可行？ | 关键依据 | 推荐路径 |
|---|---|---|---|
| 聊天区宽 / 窄 | ✅ 可行 | `--dsh-chat-content-width` 是 CSS 变量，官方 `ctx.theme.overrideTokens()` 可写 body inline 变量 | 纯插件接管 |
| 侧边栏左 / 右 | ❌ 不可行 | frame 列顺序写死在宿主 `gridTemplateColumns` 模板 + JSX 顺序 + 拖拽手柄 inline 值；无 slot、无 CSS 变量、无服务 API | 补丁（静态固定）或需求降级 |
| 按钮 + 设置开关 | ✅ 可行 | `sidebar.panellist`（list 可增量）、`shell.overlay`（additive）；Config volatile + `configEditor.edit()` 持久化 | 纯插件 |

## 三、逐项评估与方案

### 需求 1 — 侧边栏左/右（❓ 最大决策点）

**为什么纯插件做不到（证据链）**

- `dsh-client-ui-layout/lib/types/client/index.d.ts`：`sidebar` slot 是 `single/root`，已被 ui-sidebar 占用；owner props 只有 `collapsed`/`width`，**没有 side**。
- `ILayout` 服务只有 `selectPanel` / `toggleSidebar`（折叠展开）/ `openRightbar` / `closeRightbar`，**没有 setSidebarSide**。
- 列位置由宿主 `AppFrame` 决定：`gridTemplateColumns` 是 JS 模板串（`${cols.sidebar}px minmax(...,1fr) minmax(0px,${rightbarMax}px)`），三列 DOM 顺序是 JSX 写死，两个拖拽手柄的 `left` 是 inline 计算值、dx 符号写死。slot 只能往侧栏**内部**塞内容，动不了它在 frame 里是哪一列。
- 本机现状：`sb-01a~sb-01g` 共 7 条宿主 JS 补丁已把侧栏**固定在最右**（含拖拽方向镜像、border 镜像），由 `DSH-PatchGuard` 每 15 分钟补回。

**三个候选方案**

- **1A（推荐·务实）**：保留 sb-01 补丁，侧栏**固定右**，需求降级为"固定右 + 用官方 `toggleSidebar` 折叠"。零新增宿主改动、零维护风险。
- **1B（完整·较重）**：把 sb-01 补丁改造成"CSS 变量驱动"——一次性改宿主 client.js，让列顺序/列宽模板读 `--enkeep-sidebar-side`，DOM 顺序用 CSS `order`，拖拽方向随变量反转；插件切换变量即可实时换边。代价：需撤销并重做现有 sb-01、与 guard 联动、拖拽方向需实机验证。
- **1C（脆弱·不推荐）**：插件注入全局 CSS 覆盖哈希类名 + `order`。拖拽数学对不上、违反"组件外不写 DOM"、哈希漂移即失效。

> 官方 `ui-plugin.md` / `practices.md` 明确禁止：不读别的插件 DOM/样式表、不 append 到 body、不在组件外写 DOM。所以 1C 不属于合规路径。

### 需求 2 — 聊天区宽/窄（纯插件可行）

**证据**

- 列宽由变量驱动：`dsh-client-ui-chat/lib/client.js` 的 `.EvIC1a_column{max-width:var(--dsh-chat-content-width)}`。
- 官方入口：`ctx.theme.overrideTokens(source, {'--dsh-chat-content-width': { light, dark }})` 返回 disposer；实现里 `validateOverrides()` 只校验明暗值对、不校验 token 名，`ThemePresenter.apply()` 把 token 全量写到 `body.style.setProperty`。
- 原生默认：`clamp(680px, 0.64×栏宽, 920px)` —— **920px 硬顶**。
- 当前定制（wb-01 补丁，寄生在 dsh-wordbox）：`clamp(640px, calc(栏宽 - 64px), 100%)` —— 去掉硬顶，下限 640px。

**方案**

- 插件 Config 增 `chatWidth: 'narrow' | 'wide'`（默认 `narrow` = 原生）。
- 选 `wide` 时 `overrideTokens` 注入宽屏值；选 `narrow` 时 dispose 覆盖、回原生。
- ❓ 需确认："宽屏用现在的设计"= 当前 wb-01 那套（640/无硬顶）吗？若是，插件接管后应**撤销 wb-01/wb-05 补丁**，否则双重 `!important` 冲突。
- 风险：`--dsh-*` 是内部变量，文档只承诺 `--dsw-alias-*`；越界用法，上游收紧校验会失效。需在本机实测 override 是否生效。

### 需求 3 — 按钮 + 设置页开关（纯插件可行）

**按钮挂载点候选（按推荐度）**

| slot | kind | 可否增量 | 评价 |
|---|---|---|---|
| `sidebar.panellist` | list | ✅ 新 id 即可 | 全局面板图标行，最安全，注册即出现在侧栏顶部区域 |
| `shell.overlay` | list | ✅ additive | 官方指定"自己的浮层用新 id 加入"，可用 CSS 定位到工作区上方 |
| `sidebar.workspaces` | single | ❌ 被 ui-workspace 占用 | 注册会替换整个工作区，不可用 |
| `sidebar.brand.mark/name` | single | ❌ 被占用 | 注册即替换官方品牌，不推荐 |

**开关持久化**

- Config volatile 字段 `showLauncher: boolean`（默认 `true`），用户改 `cordis.patch.yml` 或用设置页表单。
- 运行时保存走官方 `configEditor.edit(entry, current => ({...current, showLauncher}))`；volatile 字段原地更新、不重启插件。
- 设置页 UI：走 `settings.section` / 插件页表单（`ctx.configForms`）；`settings.general.item` 是 `settings-general` 包的 slot。
- 按钮"点开"的行为：照 dsh-im 范式——`sidebar.panellist` 图标 → `ctx.layout.selectPanel(PANEL_ID)` 在中央区打开本插件面板（`main` keyed slot）。

## 四、推荐架构（已按确认决策收敛）

两个功能：

**A. 聊天宽窄**（纯 CSS 变量，Host+Client 配合）
- Host `Config`：`chatWidth: 'narrow' | 'wide'`（默认 `narrow`=原生）。
- Client：`wide` 时用 `ctx.theme.overrideTokens` 写 `--dsh-chat-content-width: clamp(640px, calc(var(--dsh-conversation-column-width) - 64px), 100%)` + 配套 composer 变量；`narrow` 时 dispose 覆盖回原生。
- 撤销旧补丁：从 `~/.dsh/patches/manifest.json` 移除 `wb-01-panel` 与 `wb-05-chatwidth-hash-refresh`（并跑 apply/guard 验证），宽度控制权交给插件。

**B. 侧栏按钮 + 显隐开关**（照 dsh-im 范式）
- Config volatile：`showLauncher: boolean`（默认 `true`）。
- Client `sidebar.panellist` 注册图标按钮，`main` keyed 注册面板；按 `showLauncher` 注册/注销；`settings.section` 注册设置页放开关。
- 持久化走 profile 的 volatile 字段（configEditor），不手改 cordis.patch.yml。

```
dsh-enkeep/
├── package.json          # dsh.bundle.patch + dsh.client (platform/immediately/inject)
├── cordis.patch.yml      # 插入插件行 + Config 默认值（showLauncher/chatWidth）
├── index.js              # Host：Config schema + configEditor + 状态下发
├── client.js             # Client：theme.overrideTokens + sidebar.panellist/main/settings.section
├── locale/{en,zh}.json   # meta + 按钮/设置/面板文案
├── docs/{DETAIL,UI-PLAN}.md
└── icon.svg
```

## 五、原决策点（已确认）

1. ~~侧栏左右~~：**不做**（用户 2026-11-18 确认）。
2. **宽屏定义**：确认是当前 wb-01 的 640/无硬顶效果；**由插件接管并撤销 wb-01/wb-05**。
3. **按钮行为**：参考 dsh-im —— `sidebar.panellist` 图标 → 中央区面板，显隐可在设置页切换。

## 六、已确认决策（2026-11-18）

- ✅ 侧栏左右切换 **不做**；只做宽窄切换 + 按钮/开关。
- ✅ 宽屏 = 当前 640/无硬顶效果；插件接管、撤销 wb-01/wb-05（撤销动作需用户确认后再执行，涉及本机补丁清单改动）。
- ✅ 按钮照 `@xmanrui/dsh-im` 范式实现。

## 七、待实现前澄清（非阻塞，可实现中定）

- 中央区面板内容放什么？（可以先放"宽窄切换 + 使用说明"的最小面板）
- 宽窄切换的入口：放设置页（`settings.section`）还是面板内按钮，或两者都要？
