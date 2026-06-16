# 迹录（Trace Keeper）插件 — 设计定案

> **状态**：**已实现（v1 · 2026-06）**；本文档为定案 + 实现对照。  
> **插件 id**：`trace-keeper` · **英文名** Trace Keeper · **中文名** 迹录  
> **关联**：`DOC/09` 插件系统、`DOC/11` 出站补全、`DOC/18` 宿主 API、`DOC/21` 会话插件设置、`DOC/24` 正则剥块、`DOC/12`（分槽：Historian 写 lore，迹录**不写 lore**）。

### 实现摘要（2026-06）

| 能力 | 实现 |
|------|------|
| Together 落盘 | `resolveTurnPluginEntriesFromAssistant` 解析 `<ex-trace-keeper>` → `turn.plugins[]` |
| 组装注入 | `resolveAfterAssemblePromptsAddition`：system 仅 **格式说明 + sample**；历史 state 由正则保留在 assistant 正文；计入 token 预算且不可 trim |
| Separate 补生成 | `POST …/regenerate-separate`；多轮 user/assistant 窗口（`separateTurnCount`）；system 不含历史 state |
| 侧栏 | `host.ui.panel` · live/pinned；只读 `plugins[]` 渲染；无 snapshot **空态+原因**（§4.4）；最后一轮可 Separate |
| Swipe | 按 `receiveId` 多 snapshot（`mergeTurnPluginEntry`） |
| 套件 | 用户 settings `bundleList` + 内置 `scene-tracker-default`；设置页编辑器 |
| 插件互依赖 | **无**；不硬编码其它 `pluginId`（见 `DOC/09` §1） |

---

## 1. 定位

迹录是 **RP 场景状态追踪**插件：用 LLM（默认 **Together** 模式）在助手回复中产出结构化 JSON，解析后按轮落盘，并在 **左侧插件抽屉** 用用户自定义 **Handlebars 模板 + CSS** 渲染面板。

| 项 | 定案 |
|----|------|
| 与 Historian | 互补；Historian 写资料库摘要；迹录 **不注入 lore** |
| 与 memory | 无关；state 不走 Lance hybrid |
| 与其它插件 | **无强依赖**；不读取、不分支其它 `pluginId`；与其它插件 payload 同经宿主组装 / 落盘管道并列生效 |
| 引擎 vs 内容 | 插件提供 **引擎**；字段 / UI 由用户 **TraceBundle（套件）** 定义，仓库只附带 **基础样例** |

---

## 2. 生成模式

### 2.1 Together（默认）

主对话一次生成：**扮演正文 + `<ex-trace-keeper>` 块**。

```text
用户消息
  → afterAssemblePrompts：注入格式说明 + **sampleState 样例**（历史 state 由 outgoing 正则保留在 assistant 内，见 §10）
  → 主模型回复（含 <ex-trace-keeper>{…}</ex-trace-keeper>）
  → 落盘：解析 JSON → turn.plugins[trace-keeper]；regex 剥 outgoing/persist/display（§8）
  → 侧栏：Handlebars(template)({ data: state, meta }) → host.ui.panel.setHtml
```

### 2.2 Separate（补生成）

解析失败或用户手动刷新：`POST /api/plugins/trace-keeper/regenerate-separate`（`plugin.complete` + `json_object`），结果写入 **`turn.plugins[]`**，并**同步回写当前 active receive 的 assistant 正文**（重写 `<ex-trace-keeper>` 块）。侧栏 live 且最后一轮无 snapshot 时显示按钮。

---

## 3. 输出块与正则

| 项 | 值 |
|----|-----|
| 标签名 | **`<ex-trace-keeper>…</ex-trace-keeper>`** |
| 块内 | **纯 JSON**（与 **sampleState** 同形；**不**外包 `{ "data": … }`） |
| 默认 regex seed | `phases: ["outgoing","persist","display"]`，`skipLastNTurns: 3`，`replacement: ""`（见 `DOC/24` §2；标签名与通用 `ex-tracker` 示例区分，迹录专用规则由插件或文档约定 id/label） |

---

## 4. 数据模型

### 4.1 权威 state

| 存储 | 内容 |
|------|------|
| `turn.plugins[]` | 每轮 / 每 swipe 快照：`payload.state`（JSON）、`payload.epoch`、`payload.receiveId?` |
| `index.json` → `pluginSettings.trace-keeper` | `trackerEpoch`、套件选择、`bundleOverride` 等 |
| **不**使用 lore sidecar | 注入仅 `afterAssemblePrompts` system |

**Handlebars 上下文**（引擎固定，用户 template 使用）：

```ts
{
  data: state,              // 解析后的 JSON 对象
  meta: {
    mode: 'live' | 'pinned',
    turnOrdinal?: number,
    epoch: number,
  },
}
```

### 4.2 `trackerEpoch` 与换主角色

- **触发**：`characterIds[0]` 变化（`PATCH` 会话绑定）。
- **行为**：`trackerEpoch++`；live state 回 **sampleState 默认**；从新主卡 `extensions` 重新 resolve **TraceBundle**。
- **历史** `turn.plugins` **保留**；仅 `payload.epoch === trackerEpoch` 参与 live 视图与 Together 注入。
- **无二次确认**（产品定案：换主卡即重置 state）。

### 4.3 Swipe 与侧栏视图

- 每个 `receive` Together 解析成功写独立 payload（含 **`receiveId`**）。
- **live**：**仅最后一轮**、该轮 **`activeReceiveIndex`** 对应 snapshot（不向前回溯）；无 snapshot 时 **空态 + 原因文案**（仅最后一轮可读 assistant 诊断）+ Separate 按钮；**不用 sampleState 占位**。
- **pinned**：固定 `turnOrdinal`；无 snapshot 时 **统一「该轮暂无数据」**（不展示解析细节）；**不**回退 live；head 按钮仍 filled、可点。pinned 在最后一轮且无 snapshot 时与 live 相同诊断 + Separate。
- 展示 **只读** `turn.plugins[]` 渲染 snapshot；**不**用 assistant 作 state fallback。空态时 **仅最后一轮** 可读 active receive 正文做 **diagnose-only**（与落盘解析同源）。

### 4.4 侧栏空态原因（2026-06）

| 条件 | 文案类型 | Separate |
|------|----------|----------|
| 无轮次 | 空会话 | ❌ |
| 查看 **非最后一轮** 且无 snapshot | 统一「该轮暂无数据」 | ❌ |
| **最后一轮** 无 snapshot | 未返回块 / 空块 / JSON 解析失败 / 未落盘 / 格式无效 | ✅ |
| 有 snapshot 但 template 渲染失败 | 模板渲染失败（可附 detail） | ✅ |

`sampleState` **不**参与侧栏占位，仅用于 system 注入与设置页。

---

## 5. TraceBundle（用户可自定义套件）

用户可自定义 **sampleState、template、stylesheet**；插件内置 **仅默认样例**（来源于 WTracker 风格 scene tracker，非硬编码字段）。

**v1 定案（2026-06-14）**：**仅 JSON 样例**引导模型与 UI；**不**要求用户编写 JSON Schema（Companion 式样例注入，非 WTracker 式 schema 注入）。解析后 `JSON.parse` + 弱校验（根为 object、可选体积上限）；**不做 Ajv**。JSON Schema 列为 **后期可选**扩展。

### 5.1 套件结构

```ts
interface TraceBundle {
  id: string
  label: string
  sampleState: object      // 结构契约 + few-shot + 空会话默认；**v1 唯一结构源**
  template: string         // Handlebars HTML 片段（非整页）
  stylesheet: string       // CSS；建议根选择器 .trace-keeper-panel
  // schema?: object      // 后期可选：校验 / Separate API；v1 不实现
}
```

### 5.2 存储层级与优先级

```text
① 用户套件库
   data/plugins/trace-keeper/{userId}/settings.json
     bundles: Record<string, TraceBundle>
     activeBundleId?: string

② 角色卡（主角色 characterIds[0]）
   card.extensions.arousalPub.traceKeeper: {
     bundleId?: string
     bundle?: TraceBundle    // 整包嵌入（导入卡时带走）
   }

③ 会话
   pluginSettings.trace-keeper: {
     bundleId?: string
     bundleOverride?: Partial<TraceBundle>
     trackerEpoch: number
   }
```

**resolve 顺序**（字段级 merge）：

```text
会话 bundleOverride → 会话 bundleId → 主卡 extensions.traceKeeper
  → 用户 activeBundleId → 插件内置 default bundle
```

**种子**：仅 **新用户** `seedNewUserDefaultFiles` 可写入默认套件 `scene-tracker-default`（含 **sampleState** / template / stylesheet）；**禁止**对已有用户启动补写（见 workspace 种子规则）。

### 5.3 模板与交互

- 用户 template 可含 **`input`、`button`、`textarea`、`radio` tab** 等；不限于 `details/summary`。
- 插件 **不提供**用户自定义 Handlebars helper（防任意 JS）；仅内置 helper（如 `eq`、`json`）。
- 手改：`data-tk-field` 点路径写回 `state`；宿主 **`interactive: true`** 消毒档 + 事件委托（§7）。
- 全量 `setHtml` 会丢焦点：轻量编辑宜 **委托更新 viewModel** 或 debounce 后局部更新；切 Tab / 切轮再整页渲染。

### 5.4 模型提示（v1：仅样例 JSON）

`afterAssemblePrompts` 从 **当前 resolve 的 bundle** 读取：

1. 输出格式（必须用 `<ex-trace-keeper>` 包裹纯 JSON）
2. 当前 **live state**（epoch 匹配；有则给）
3. **`sampleState`** — 结构参考（并写明：**按此结构更新当前场景，勿照抄样例数值**）

**不**向主对话注入 JSON Schema 全文。用户改字段时同步改 **sampleState + template** 即可；**template 只影响侧栏展示**。

**Separate** 补枪：同样在 `complete` 的 messages 里附 **sampleState** few-shot；可用 `responseFormat: 'json_object'`，**不**绑 schema。

---

## 6. UI

### 6.1 左侧抽屉（宿主 `host.ui.panel`）

```text
┌─────────────────────────────────────┐
│ [📌 Pin] [迹录] […预留插件 Tab…]     │  ← 顶栏：Pin + 插件图标切 Tab
├─────────────────────────────────────┤
│  Handlebars 渲染 + 用户 stylesheet   │
│  （宿主 DOMPurify pluginPanel 档）   │
└─────────────────────────────────────┘
```

| 控件 | 行为 |
|------|------|
| **Pin** | 钉住侧栏保持打开（与「按轮 pinned 查看」**不同图标/语义**） |
| **插件 Tab** | `placement: 'leftDrawer'` 下多插件共用；`activeTab` 切换 |
| **固定入口** | 顶栏/页脚 **Trace Keeper** 按钮 → 打开 drawer 并聚焦 `trace-keeper` tab |

宿主占位：`App.vue` 左 `v-navigation-drawer`（280px，`app.pluginsHint` 预留）。

### 6.2 每轮按钮

- **Slot**：`turn-block-head`（`registerSlotButton`；仅图标）。
- **无数据且未 pinned 该轮**：disabled + tooltip「本轮无 tracker」。
- **pinned 该轮但无 snapshot**：**可点**；tooltip「固定查看：本轮无 tracker 数据」；drawer 显示空态文案。
- **有 snapshot 或 pinned**：点击 → 切换 pinned + 打开 drawer；pinned 轮 **filled**。
- **live 默认**：最后一轮 snapshot；无则 **空态**（原因见 §4.4）+ Separate（仅 viewing 为最后一轮）。

### 6.3 设置页

- **套件库**：CRUD；编辑 **sampleState / template / stylesheet**（三个大文本；v1 无 schema 编辑器）。
- **conversationSettingsSchema**（可选）：本会话 `bundleId`、覆盖项（见 `DOC/21`）。
- 角色库（后期）：绑定 `bundleId` 或嵌入 bundle。

### 6.4 后期（非 v1）

- 最近 **X 轮**数值字段折线图（`sampleState` 内约定数值路径或用户配置）；数据来自 `turn.plugins` 历史。
- **JSON Schema** 可选字段 + Ajv 校验（非 v1）。

---

## 7. 宿主 API（已实现）

命名空间 **`host.ui.panel`**。宿主组件 **`PluginLeftDrawerHost`**（`App.vue` 左 drawer 280px）。

```ts
// 注册
host.ui.panel.register({
  placement: 'leftDrawer',
  pluginId: 'trace-keeper',
  tabIcon: 'mdi-…',
  tabLabelKey: host.pluginKey('tabLabel'),
  interactive: true,   // 迹录：允许 input/button 等 + 事件委托
})

// 内容（插件 Handlebars 后调用）
host.ui.panel.setHtml(
  'leftDrawer',
  'trace-keeper',
  html: string,
  opts?: { revision?: number },
)

host.ui.panel.setPinned('leftDrawer', boolean)
host.ui.panel.open('leftDrawer', 'trace-keeper'?)

// 交互（注册一次）
host.ui.panel.onPanelEvent('leftDrawer', 'trace-keeper', {
  onInput?: (e: { field: string; value: unknown }) => void,
  onAction?: (e: { action: string; … }) => void,
})
```

**消毒**：`pluginPanel` profile（独立于聊天富文本）；`interactive: true` 时允许 `input`（type 白名单）、`button[type=button]`、`label`、`textarea` 等；禁止 `on*`、`form action`、`javascript:`。插件 **不得**绕过宿主直接 `innerHTML`。

**第三种 UI 通道**（与 `registerSlotButton`、`registerFormDialog` 并列）：**HTML 面板注入**。

---

## 8. Server 插件（已实现）

| Hook / 路由 | 用途 |
|-------------|------|
| `resolveAfterAssemblePromptsAddition` | 注入 tracker system（sample + live states）；`afterAssemblePrompts` 兼容路径 |
| `resolveTurnPluginEntriesFromAssistant` | Together：从 assistant 解析 → 落盘条目 |
| `regenerateSeparateState` | Separate 补生成（由路由 `regenerate-separate` 调用） |
| `patchTraceKeeperState` | 手动编辑 state（由路由 `patch-state` 调用） |
| `POST …/regenerate-separate` | Web 侧栏触发；需 `plugin.complete` + `conversation.read` |
| `POST …/patch-state` | Web 侧栏 JSON 编辑保存；需 `turn.plugins.write` + `conversation.read` |
| `permissions` | `conversation.read`、`turn.read`、`turn.plugins.write`、`plugin.complete` |

**两条写回路径均为双写**（`turn.plugins[]` + `receive.content`）：

| 操作 | `turn.plugins[]` | active receive 正文 |
|------|------------------|---------------------|
| Together 落盘（`resolveTurnPluginEntriesFromAssistant`） | ✅ 写入 | 模型直接产出，落盘不再改写 |
| Separate 补生成（`regenerate-separate`） | ✅ 写入 | ✅ 重写 `<ex-trace-keeper>` 块 |
| 侧栏 JSON 编辑（`patch-state`） | ✅ 写入 | ✅ 重写 `<ex-trace-keeper>` 块 |

**宿主**：`loadEnabledServerPlugins` 在同一次组装内 **只加载一次**（`assembleRuntime` + `additionCache` 共享）。插件注入 token 写入 **`assembly.plugins`**（审计 Tab，见 `DOC/24` §3.2）。

换主角色 **`trackerEpoch++`**：`PATCH` 会话 `characterIds[0]` 变化时服务端写入（`server/src/index.ts`）。

---

## 9. 插件包结构（仓库）

```text
plugins/trace-keeper/
  manifest.json
  locales/{en,zh}.json
  settings.json
  bundles/scene-tracker-default/
  src/
    index.ts                 # Web：panel、turn 按钮、Separate 客户端
    trace-state-resolve.ts   # plugins[] 解析；live 仅最后一轮
    tracker-prompt.ts
    server/
      index.ts
      separate-regenerate.ts
  build.mjs → dist/web.mjs + dist/server.mjs
```

已注册 **`BUNDLED_PLUGIN_IDS`** / **`sync-bundled-plugins.mjs`**。测试：`src/**/*.test.ts` + `server/src/plugin-bundled-dist.test.ts`。

---

## 10. 与正则 / 审计

- 剥块规则见 §3；近 `skipLastNTurns` 轮保留块供模型续写，更早轮 outgoing/persist 剥除。
- 审计中合法 XML 转义见 `DOC/24` §2.3（与标签名无关的通用说明）。

---

## 11. 验收要点

- [x] Together 默认；`<ex-trace-keeper>` 解析落 `turn.plugins`
- [x] **不**写 lore；仅 system 注入
- [x] 用户可编辑 **sampleState / template / stylesheet**；默认样例可渲染侧栏
- [x] `host.ui.panel` 消毒 + `interactive` 委托
- [x] 左 drawer Pin + Tab
- [x] live / pinned；swipe `receiveId` 多 snapshot；无 snapshot 空态 + 原因（§4.4）
- [x] Separate 补生成（侧栏 + API）
- [x] 组装审计 `assembly.plugins`（插件注入 token 预留）
- [x] 侧栏 JSON 编辑写回（`patch-state` + 编辑按钮）
- [ ] 顶栏/页脚独立「打开迹录」入口（可选）
- [ ] JSON Schema / Ajv（后期）

---

## 12. 参考样例（非仓库路径）

开发用 WTracker 风格样例（用户本地）：`index.html`（Handlebars + CSS + `testData`）。迁入 `bundles/scene-tracker-default/` 时：

- `sampleState` ← 原 `testData.data`（**v1 不用** `wt json tmpl.json` Schema 文件）  
- `template` ← `#wtracker-template` 片段  
- `stylesheet` ← 原 `<style>`（建议根 class 改为 `.trace-keeper-panel`）
