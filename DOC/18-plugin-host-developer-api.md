# 插件宿主 API — 开发者参考

> **状态**：**已实现**（2026-06-02 核对）。本文是第三方插件作者的**单一入口**：Web `PluginWebHost`、服务端 hook、REST 路由与权限一览。  
> **类型契约源码**：`web/src/plugins/types.ts`、`web/src/plugins/conversation-host.ts`、`server/src/plugin-system/types.ts`  
> **示例插件**：`plot-summary`（出站补全 + lorebook + 摘要）、`guidance-generate`（聊天管线 hook）、`conversation-export`（对话 read）

---

## 1. 核心原则

| 项 | 定案 |
|----|------|
| **数据与密钥** | 插件在浏览器**不**持 API Key；出站模型调用、读盘均由服务端完成 |
| **访问路径** | 聊天页插件**只**通过 `register(host)` 注入的 **`host.*`** 访问能力；**禁止**在 `web.mjs` 里直 `fetch('/api/lorebooks')`、`fetch('/api/settings')` 等本体 REST |
| **业务边界** | 宿主提供 **原语**（read/patch、转发 messages、lore 条目 CRUD）；摘要 prompt、解析、触发策略等 **插件自建** |
| **鉴权** | 所有 `/api/plugins/...` 需 JWT；各路由按 `manifest.permissions` **enforce** |
| **会话差异** | 全局设置：`data/plugins/{id}/{userId}/settings.json`；每对话覆盖：`index.json` → `pluginSettings[pluginId]` |

### 1.1 与正常聊天的区别

| | `POST /api/chat` | 插件出站补全 `host.plugin.complete` |
|--|------------------|-------------------------------------|
| 组装 | 角色卡、预设、history、memory、lore 扫描 | **仅**插件提交的 `messages[]` |
| 落盘 | 追加 turn / 流式 assistant | **无**（除非插件另调 conversation patch） |
| 用途 | 用户对话 | 摘要、sidecar、独立 LLM 任务等 |

---

## 2. 快速上手

### 2.1 最小 Web 插件

```javascript
// dist/web.mjs
export function register(host) {
  host.registerSlotButton('composer-toolbar', {
    id: 'my-plugin-action',
    icon: 'mdi-puzzle',
    tooltipKey: host.pluginKey('tooltipAction'),
    onClick: () => {
      host.ui.toast(host.t(host.pluginKey('done')), { color: 'success' })
    },
  })
}
```

```json
// manifest.json（节选）
{
  "id": "my-plugin",
  "name": "示例插件",
  "version": "1.0.0",
  "permissions": [],
  "ui": {
    "slots": [{ "name": "composer-toolbar", "entry": "./dist/web.mjs" }]
  }
}
```

### 2.2 `host.pluginKey`

`host.pluginKey('foo')` → `plugins.{pluginId}.foo`，与 `locales/zh.json` 中键名对应，供 `host.t()` 使用。

### 2.3 Slot 懒加载

- 进聊天页只拉 `GET /api/plugins/registry`，**不**立即加载全部 `web.mjs`。
- 某 slot 首次挂载时，宿主加载 manifest 中 **`ui.slots[].name` 包含该 slot** 的插件。
- **无 slot、仅 lifecycle** 的插件：registry 就绪后 **eager** 加载（须在 `register()` 内挂 lifecycle）。
- `register(host)` 应轻量；重逻辑放在 `onClick` / `onSubmit` / `runScope` 等 handler 内。

---

## 3. Web 宿主：`PluginWebHost`

在 `register(host)` 中，`host` 已由宿主注入当前 `pluginId` 作用域（`createScopedPluginHost`）。下列 API **均已实现**。

### 3.1 注册与 UI

| 成员 | 说明 |
|------|------|
| `registerSlotButton(slot, def)` | 注册工具栏等 slot 按钮；支持 `menu[]` 子菜单、`when` / `disabled` / 动态 `icon` / 动态 **`class`** |
| `registerFormDialog(pluginId, def, dialogId?)` | 注册动作弹框（与设置页 schema 表单分离） |
| `openFormDialog(pluginId, model, dialogId?)` | 打开已注册弹框 |
| `refreshSlotButtons()` | 动态改按钮状态后刷新 UI |
| `registerStyles(css)` | 注入 `<style data-plugin-styles="{pluginId}">`；同插件重复调用为**覆盖**更新（仅 scoped host） |
| `t(key, params?)` | i18n |
| `pluginKey(key)` | → `plugins.{id}.{key}` |
| `composer` | 输入区引用（如 `userInput`） |
| `session` | 当前 `useChatSession`（`turns`、`loading`、写锁等） |

**Slot 名称（常用）**：`composer-toolbar`、`turn-block-head`（章回 divider 下）、`assistant-turn-footer`、`user-turn-footer`（以 manifest 声明为准）。

**Slot 按钮 `def.class`**：可选 `string | (ctx) => string`，追加到宿主 `.plugin-slot`（与 `is-filled` 并存）。插件应用 **带插件前缀** 的 class 名，配合 `registerStyles` 定义颜色/布局，避免改宿主全局 CSS。

**Slot 按钮 `def.order`**（可选）：同 slot、同插件内排序；未设时按 **`registerSlotButton` 注册先后**（0、1、…）。**不要**依赖 `id` 字母序（例如 `range-end` 会排在 `range-start` 前）。

**`registerStyles` 示例**：

```ts
export function register(host: PluginWebHost) {
  host.registerStyles(`
    .plugin-slot.my-plugin-start--active {
      color: rgb(var(--v-theme-primary));
      border-color: rgba(var(--v-theme-primary), 0.45);
    }
  `)
  host.registerSlotButton('turn-block-head', {
    id: 'my-plugin-start',
    icon: (ctx) => (isStart(ctx) ? 'mdi-play' : 'mdi-play-outline'),
    class: (ctx) => (isStart(ctx) ? 'my-plugin-start--active' : ''),
    tooltipKey: host.pluginKey('rangeStart'),
    onClick: (ctx) => { /* … */ },
  })
}
```

**表单字段 `type`**：`text`、`textarea`、`integer`、`radio`、`apiPreset`、`lorebook`、`checkboxGroup`；支持 `visibleWhen`、`readOnly`、`persistent`、`skipKey` / `regenerateKey` 等（见 `PluginFormDialogDef`）。

### 3.2 `host.turn`

| 方法 | 说明 |
|------|------|
| `isLastUserTurn(turn)` | 是否为列表最后一条 user turn |
| `isTurnAwaitingAssistant(turn)` | 是否等待助手回复 |

### 3.3 `host.chat`

| 方法 | 说明 |
|------|------|
| `sendWithPlugins(userText, plugins)` | 带 `body.plugins` 发消息（走 `/api/chat` 组装） |
| `regenerateWithPlugins(listIndex, userText, plugins)` | 再生 |

用于 **guidance-generate** 等需要在正常聊天管线注入的插件；**不是**独立 LLM 任务入口。

### 3.4 `host.lifecycle`

| 方法 | 说明 |
|------|------|
| `onAssistantReplyPersisted(handler)` | 服务端落盘成功（SSE `arousal.persist` 或等价 JSON）→ **早于** `loadMessages` |
| `onAssistantReplyComplete(handler)` | 发送/再生流程结束（含 UI 刷新之后） |
| `onTurnDataChanged(handler)` | swipe / `turn.plugins` 等轮次数据变更 |
| `onGeneratingChanged(handler)` | `session.loading` 或 `regeneratingTurnOrdinal` 变化（等待回复 UI 等） |

返回 **取消订阅函数**。持久化类逻辑优先用 `onAssistantReplyPersisted`。

**事件字段（persisted）**：`mode`、`traceId?`、`turnOrdinal?`、`receiveId?`、`isFirstTurn?`。

### 3.5 `host.conversation`

| 方法 | 说明 |
|------|------|
| `getId()` | 当前对话 id |
| `getMeta()` | `title`、`userDisplayName`、`assistantDisplayName`、`characterIds` 等 |
| `runScope(opts, fn)` | 批处理作用域；`fn` 接收 `ConversationBatchContext` |
| `runBatch(fn)` | `runScope({ writeLock: true, requireIdle: true }, fn)` 别名 |
| `refresh()` | 写盘后刷新消息列表 |
| `getPluginSettings()` | 读本对话 `pluginSettings[pluginId]` |
| `patchPluginSettings(partial)` | 写会话级插件设置（合并进 `index.json`） |
| `setPluginHold(hold)` | 插件长流程占用对话时禁止用户发消息 |

**`ConversationBatchContext`**（在 `runScope` 内）：

```ts
interface ConversationBatchContext {
  conversationId: string
  read(opts: { range: { from: number; to: number } }): Promise<ConversationTurnDto[]>
  patchTurns(dtos: ConversationTurnDto[]): Promise<{ ok: number; failed: …[] }>
}
```

| 约束 | 值 |
|------|-----|
| 单批 `from..to` 闭区间 | **≤ 50** 轮（`CONVERSATION_BATCH_MAX_TURNS`） |
| `writeLock: true` | 批处理期间禁止其它对话写入 |
| `requireIdle: true` | `loading` / 再生中拒绝进入 |

**`ConversationTurnDto`**：`turnOrdinal`、`user`、`receives[]`、`activeReceiveIndex`（与 PATCH 对齐）。

**权限**：`conversation.read`（只读 scope）；写 patch 需额外权限（如 `turn.receive.prune`，见 §6）。

### 3.6 `host.lorebook`

| 方法 | 说明 |
|------|------|
| `list()` | `{ id, name, updatedAt }[]` |
| `get(lorebookId)` | 整本 lorebook（含 `entries`） |
| `createEntry(lorebookId, body)` | 新增条目 |
| `patchEntry(lorebookId, entryId, body)` | 更新条目（sidecar 覆盖等） |
| `normalizeEntryRefs(req)` | 校验并清理无效 entry id 映射（服务端读盘） |
| `applyOrder(lorebookId, req)` | 通用：按插件提交的 layout 写回 `group.order` / `entry.order`，**单次读盘 + 单次写盘** |
| `ensure(req?)` | 按模板自动创建 summary 目标书（Historian（剧情纪要） auto 模式）；需 `lorebook.write` |

**`normalizeEntryRefs` 请求**：

```ts
{
  lorebookId: string
  entryIds: Record<string, string>  // 如 sidecar 配置 id → entry id
  validKeys: string[]               // 合法配置键列表
}
// → 返回清理后的 Record<string, string>
```

**`applyOrder` 请求**（`POST …/lorebooks/:lorebookId/apply-order`）：

```ts
{
  scope?: 'full' | 'partial'   // 默认 partial；full 要求 entriesByGroup 覆盖全书每个 group
  groupIds?: string[]          // 可选：组的新顺序（省略则不改 group.order）
  entriesByGroup?: Record<string, string[]>  // 每组完整条目 id 列表（列出某组则必须列全）
}
// → { ok: true, lorebook, changed: number, savedAt }
```

排序算法由插件自行实现（如 Historian 的 `computePlotSummaryApplyOrderLayout`）；宿主只校验并落盘。

**校验失败**（`400`，`error: lorebook_order_invalid`）：`order_empty_request`、`order_unknown_group`、`order_unknown_entry`、`order_entry_group_mismatch`、`order_duplicate_entry`、`order_incomplete` 等（见 `validateApplyLorebookOrderLayout`）。

**`ensure` 请求**（`POST …/lorebooks/ensure`）：

```ts
{
  nameTemplate?: string   // 默认取插件 settings.autoLorebookNameTemplate；支持 {{conversationTitle}}
}
// → { ok: true, lorebook: { id, name, ... } }
```

**权限**：`lorebook.read`（list/get/normalize）；`lorebook.entry.write`（create/patch/applyOrder）；`lorebook.write`（ensure）。

### 3.7 `host.api`

| 方法 | 说明 |
|------|------|
| `listPresets()` | `{ id, alias }[]`（展示 alias，提交用 **id**） |

无需 manifest 权限（走通用 settings 读接口）。

### 3.8 `host.plugin`

| 方法 | 说明 |
|------|------|
| `complete(req)` | 通用出站补全：`messages[]`；`apiConfigId` 可省略，由宿主解析 |
| `prepareContext(req)` | 服务端读 turn + 返回 `systemReferenceContext`（参考块）与 `userContent`（仅 `<history>`） |
| `completeDraft(req)` | 调用插件 `server.mjs` 的 `completeDraft` hook（扩宏 → preflight → complete → 解析） |

**`complete` 请求**：

```ts
{
  apiConfigId?: string      // 省略时：对话 apiPreset.plugins[pluginId] → apiPreset.plugin → 插件 settings
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  modelOverride?: string
  stream?: boolean          // v1 仅非流式可靠
  responseFormat?: 'json_object' | 'text'
}
// → { ok: true, content, usage?, latencyMs }
```

宿主 HTTP 路由另接受 `conversationId`（Web 侧由 `convId()` 自动注入）；服务端实现见 `plugin-api-resolve.ts`。

**`prepareContext` 请求**（`conversationId` 由宿主注入）：

```ts
{
  fromTurn: number
  toTurn: number
  targetLorebookId: string
  includePreviousMemories?: boolean  // 默认 true
  previousMemoriesLimit?: number     // 兼容旧名；默认 8
  previousSummariesLimit?: number    // 同 previousMemoriesLimit
  sidecarEntryIds?: Record<string, string>
  sidecarIds?: string[]              // Sidecar 配置 id 顺序
}
// systemReferenceContext：`<previous-summaries>` → `<sidecars>` → `<context-history>`?（见 DOC/12 §3.3）
// userContent：仅 `<history>`
// → { ok: true, systemReferenceContext, userContent, transcript, turnCount, meta: { userDisplayName, assistantDisplayName } }
```

**`completeDraft` 请求**：

```ts
{
  apiConfigId?: string      // 省略时同上；complete-draft 路由会先解析再调 hook
  kind: 'memory' | 'sidecar'
  systemReferenceContext?: string  // 参考块，与 systemPromptTemplate 拼成 system
  userContent: string              // 仅 <history>
  systemPromptTemplate: string
  fromTurn?: number
  toTurn?: number
  sidecarName?: string
}
// memory 写入标题恒为「模型 title + -fromTurn-toTurn」
// → { ok: true, draft: { title, content, keywords[] }, usage?, latencyMs? }
```

**权限**：`plugin.complete`（complete / preflight / completeDraft）；`prepareContext` 另需 `conversation.read` + `lorebook.read`。

**可中断**：`host.ui.progress({ abortable: true })` 时，`complete` / `prepareContext` / `completeDraft` 等会携带 `AbortSignal`。

### 3.9 `host.token`

| 方法 | 说明 |
|------|------|
| `preflightComplete(req)` | 估算 prompt tokens 与预算；`code: 'context_exceeded'` 等 |

### 3.10 `host.plugins`

| 方法 | 说明 |
|------|------|
| `getUserSettings()` | 读合并后的全局插件 settings（schema 默认值 + 用户文件）。**已加载**则返回 Pinia snapshot（未加载则 `GET` 后写入 cache），与会话 `getPluginSettings` 一致（`DOC/32`） |
| `getUserSettingsSnapshot()` | 同步读 global settings snapshot；未加载返回 `{}`（`DOC/32`） |
| `onUserSettingsChanged(handler)` | 系统设置 → 插件页保存 global settings 后回调；notify 携带已保存 payload，订阅方无需二次 GET（`DOC/32`） |

### 3.11 `host.macros`

| 方法 | 说明 |
|------|------|
| `expand(text, { apiConfigId? })` | 按当前会话展开 `{{user}}`、`{{char}}` 等与主对话一致的宏 |

**权限**：`conversation.read`（需会话上下文时）。

### 3.12 `host.render`

| 方法 | 说明 |
|------|------|
| `richMessageToHtml(text)` | 富文本消息 → HTML |
| `reasoningToHtml(text)` | 思维链 markdown → HTML |

### 3.13 `host.ui`

| 方法 | 说明 |
|------|------|
| `toast(message, opts?)` | 短提示 |
| `notify(title, body?, opts?)` | 通知（当前实现为 toast 合并） |
| `confirm(opts)` | 确认框 → `Promise<boolean>` |
| `openFormDialog(...)` | 同顶层 `openFormDialog` |
| `progress(opts)` | 进度条；`indeterminate`、`abortable` + `abortLabel` |
| `clearProgress()` | 清除进度（预览弹框前应调用，避免遮罩挡住对话框） |

#### 3.13.1 `host.ui.panel`（✅ · **`DOC/30`** 迹录）

| 方法 | 说明 |
|------|------|
| `register(placement, pluginId, opts)` | 注册面板 Tab（如 `leftRail`）；可选 **`routes?: ('home' \| 'chat')[]`**，默认 `['chat']` |
| `setHtml(placement, pluginId, html, opts?)` | 更新消毒后 HTML；`interactive` 允许表单/按钮 + 事件委托 |
| `setHidden(placement, hidden)` | 隐藏/显示指定 rail 的宿主内容（列仍占位） |
| `open(placement, pluginId?)` | 打开（取消 hidden）并可选聚焦 Tab |
| `onPanelEvent(placement, pluginId, handlers)` | 面板内 `data-*` 交互回调 |

宿主：**`PluginRailHost.vue`**（左/右 rail；顶栏 `rgba(var(--v-theme-primary), 0.1)` 浅底；当前路由不可用的 Tab **disabled**；无可用内容时 **`app.pluginRailUnavailable`**）。

**Lifecycle 补充**：`host.lifecycle.onGeneratingChanged` — `loading` / `regeneratingTurnOrdinal` 变化时回调（迹录等待态刷新侧栏）。

### 3.14 `host.regex`（✅ · **`DOC/24`** §2 · 2026-06-10）

> **已实现**。宿主原生正则引擎；**非**插件、**非** `host.capabilities`。规则为用户级 `data/{userId}/regex-rules.json`；Web 侧 `GET /api/regex-rules` 带 **30s 内存缓存**（`plugin-host-regex.ts` · `invalidateRegexHostRulesCache` 在规则 PUT 后失效）。

| 方法 | 说明 |
|------|------|
| `listRules(opts?)` | 读已启用规则摘要；`opts.phases` 过滤 `display` / `outgoing` / `persist` |
| `applyText(text, ruleIds, ctx)` | 内存替换；`ctx` 含 `phase`、`field`、`tailOrdinal`、可选 `turnOrdinal` |
| `applyMessages(messages, ruleIds, ctx)` | 对 `messages[]` 按 `role` 映射 `field` 后 `applyText`；`ctx` 可传 `turnOrdinalByIndex` |

实现：`web/src/plugins/plugin-host-regex.ts` · `web/src/utils/regex-host-apply.ts` · 注入于 `create-plugin-web-host.ts`。

**消费示例**：`conversation-export` 导出前 `applyText`（`display`）；`plot-summary` 清理 sidecar 等（见 **`DOC/24`** §2.6）。

服务端 hook 内对称 API：**`api.regex`**（`listRules` / `applyText` / `applyMessages` · `server/src/plugin-system/host-api.ts`）。

---

## 4. 服务端插件：`dist/server.mjs`

宿主在聊天组装等阶段 `import` 已启用插件的 `server.mjs`（`loadEnabledServerPlugins`）。

### 4.1 已实现 hook

| Hook | 时机 | 典型用途 |
|------|------|----------|
| `afterAssemblePrompts(ctx, api)` | `/api/chat` 组装 messages 之后 | 追加 hidden system（guidance-generate） |
| `resolveAfterAssemblePromptsAddition(ctx, api)` | 同上（推荐） | 返回追加 messages；宿主合并 + token 预算（trace-keeper 等） |
| `resolveTurnPluginEntries(plugins, api)` | 落盘前 | 写入 `turn.plugins[]` 条目（body 侧） |
| `resolveTurnPluginEntriesFromAssistant(plugins, assistantText, api)` | 落盘前 | 从 assistant 解析 → 条目（trace-keeper Together） |
| `regenerateSeparateState(ctx, api)` | `POST …/regenerate-separate` | Separate 补生成（trace-keeper） |
| `completeDraft(ctx, api)` | `POST …/complete-draft` | 插件侧 LLM 草稿（扩宏、重试、JSON 解析） |

在 manifest 声明 `"hooks": ["afterAssemblePrompts"]` 等，设置页会展示。

### 4.2 `PluginServerHostApi`（hook 内 `api`）

| 方法 | 说明 |
|------|------|
| `applyPromptMacroPipeline(text, macroContext)` | 同步展宏（组装管线上下文） |
| `getUserPluginSettings(pluginId)` | 读用户合并 settings |
| `runPluginComplete(req)` | 同 Web `complete` |
| `runPluginCompletePreflight(req)` | 同 Web preflight |
| `runPluginMacroExpand(req)` | 同 Web `macros.expand` |
| **`regex.listRules` / `applyText` / `applyMessages`** | 同 Web `host.regex`（读盘 `regex-rules.json` · `server/src/regex-apply.ts`） |

**`completeDraft` 实现约定**：抛出 `context_exceeded`、`context_length_unconfigured`、`parse_failed` 等 message，宿主路由会映射为对应 HTTP 错误码。

---

## 5. REST 路由与权限

插件作者**一般无需记 URL**（由 `host.*` 封装）。调试或自建非 Web 客户端时可参考：

| 方法 | 路径 | 所需 `permissions` |
|------|------|----------------------|
| GET | `/api/plugins/registry` | 登录即可 |
| GET | `/api/plugins/manage` | 登录即可 |
| PUT | `/api/plugins/registry` | 登录即可 |
| GET/PUT | `/api/plugins/:id/settings` | 登录即可 |
| GET | `/api/plugins/:id/dist/:file` | 登录即可 |
| GET | `/api/plugins/:id/locales/:locale` | 登录即可 |
| GET | `/api/plugins/:id/assets/:name` | 登录即可 |
| GET/POST | `/api/plugins/:id/user-assets/...` | 登录即可 |
| GET | `/api/plugins/:id/lorebooks` | `lorebook.read` |
| GET | `/api/plugins/:id/lorebooks/:lorebookId` | `lorebook.read` |
| POST | `/api/plugins/:id/lorebooks/:lorebookId/entries` | `lorebook.entry.write` |
| PATCH | `/api/plugins/:id/lorebooks/:lorebookId/entries/:entryId` | `lorebook.entry.write` |
| POST | `/api/plugins/:id/lorebooks/normalize-entry-refs` | `lorebook.read` |
| POST | `/api/plugins/:id/lorebooks/ensure` | `lorebook.write` |
| POST | `/api/plugins/:id/lorebooks/:lorebookId/apply-order` | `lorebook.entry.write` |
| POST | `/api/plugins/:id/complete` | `plugin.complete` |
| POST | `/api/plugins/:id/complete/preflight` | `plugin.complete` |
| POST | `/api/plugins/:id/prepare-context` | `conversation.read` + `lorebook.read` |
| POST | `/api/plugins/:id/complete-draft` | `plugin.complete` + 插件实现 `completeDraft` hook |
| POST | `/api/plugins/:id/macros/expand` | `conversation.read` |

**会话 pluginSettings**：经 `host.conversation.get/patchPluginSettings` → `GET/PATCH /api/chat/conversations/:id`（非 `/api/plugins` 前缀，但仍由宿主封装）。

### 5.1 权限字符串一览

| permission | 含义 |
|------------|------|
| `conversation.read` | 读对话 turn / 宏展开 / prepareContext |
| `turn.read` | 读 turn 元数据（服务端 hook 用） |
| `turn.receive.prune` | 裁剪 receives（swipe-cleaner patch） |
| `turn.plugins.write` | 写 `turn.plugins[]` |
| `prompt.inject` | 注入组装 messages（guidance-generate） |
| `lorebook.read` | 读 lorebook |
| `lorebook.entry.write` | 创建/更新 lore 条目 |
| `lorebook.write` | 插件 ensure 自动建 lorebook |
| `plugin.complete` | 出站 LLM 转发 |

未声明权限却调用对应 `host.*` → 服务端返回 **403** `plugin_permission_denied`。

---

## 6. 设置与 manifest

### 6.0 插件展示名（多语言）

- manifest **`name`**：英文回退名（必填）。
- 可选在 `locales/{locale}.json` 提供 **`pluginDisplayName`**；宿主在加载 `fetchPluginsManage` 时 `mergePluginLocales`，设置页与对话插件 Tab 用 `resolvePluginDisplayName(id, manifest.name)` 显示。
- 无 `pluginDisplayName` 时继续显示 manifest `name`。

### 6.0.1 远期记忆剥离标签（可选）

manifest 可选声明 **`memory.stripBlockTags`**：`string[]`，标签名与助手正文中的 XML 块名**完全一致**（如 `ex-trace-keeper` → `<ex-trace-keeper>…</ex-trace-keeper>`）。

- 用户全局 **`memory.stripPluginBlocks=true`** 时，宿主合并所有**已启用**插件的声明与用户「剥离标签」列表（`collectPluginMemoryStripTags`）。
- 用于入库与召回前从 turn 语料中移除插件块，避免向量被大块 JSON 淹没；详见 **`DOC/03` §14.4.4**。
- 提示词里自定义的标签（未必带 `ex-` 前缀）可由用户在设置页手填，或由插件在此声明。

### 6.1 `settingsSchema` 字段类型

| type | 设置页控件 |
|------|------------|
| `boolean` / `integer` / `number` / `string` / `text` / `enum` | 标准控件 |
| `fileAsset` | 用户上传至 `data/plugins/{id}/{userId}/assets/` |
| `apiPreset` | API 预设下拉（存 **id**） |
| `lorebook` | 资料库下拉 |
| `objectList` | 结构化列表（`itemFields` 定义子字段） |

**widget**：`slider`（number）、`promptTemplate`（带恢复默认的 text，配合 `defaultKey` / `required`）。

会话级覆盖：在插件逻辑里 `host.conversation.patchPluginSettings({ ... })`，字段由插件自定（如 `targetLorebookId`、`lastSummarizedEnd`）。

### 6.1.1 `conversationSettingsSchema`（对话齿轮 → 插件 Tab）

- manifest 可选 **`conversationSettingsSchema`**（字段类型与 §6.1 相同）；完整定案见 **`DOC/21`**。
- 对话 **`ConversationContextSettings`** 仅渲染 **enabled** 且含该 schema 的插件；**不得**在其它宿主 Tab 硬编码 `pluginId` 字段。
- 可选字段属性：**`conversationInherit`**、**`inheritFromGlobalKey`**（清空 → PATCH `null` 删键，继承全局 `settings.json`）。

### 6.2 打包与部署

- 源码：`plugins/{id}/`；运行：`data/plugins/{id}/`（`npm run build` 会 sync）。
- Web entry：`export function register(host)`。
- 可选 TypeScript + esbuild 打出 `dist/web.mjs`、`dist/server.mjs`（参考 `plot-summary`）。

---

## 7. 错误处理

Web 侧宿主 API 失败时抛出 **`PluginHostApiError`**：

```ts
import { isPluginHostApiError } from '@/plugins/types' // 插件内可判断 e.code / e.status

class PluginHostApiError {
  code: string      // 服务端 error 字段，如 plugin_complete_failed
  status: number    // HTTP 状态码
  detail?: string
}
```

**常见 code**：`plugin_not_found`、`plugin_disabled`、`plugin_permission_denied`、`plugin_complete_failed`、`plugin_complete_context_exceeded`、`lorebook_not_found`、`conversation_not_found`、`plugin_hook_not_supported`（未实现 `completeDraft` 时）等。

`host.conversation.runScope` 可能抛 **`ConversationHostError`**：`conversation_locked`、`conversation_busy`、`range_too_large`。

---

## 8. 推荐模式

### 8.1 长流程 + 预览确认

1. `setPluginHold(true)` + `ui.progress({ abortable: true })`
2. `prepareContext` → `completeDraft` → `registerFormDialog` 预览
3. 用户确认后 `createEntry` / `patchEntry`，`patchPluginSettings` 更新指针
4. `finally`：`clearProgress()`、`setPluginHold(false)`

参考：`plugins/plot-summary/`。

### 8.2 批量改写对话

1. `runBatch(async (ctx) => { read → 变换 → patchTurns })`
2. 每批 ≤50 轮，跨批进度记入插件 settings 或会话 `pluginSettings`

参考：`swipe-cleaner`、`conversation-export`。

### 8.3 聊天管线注入

1. Web：收集用户输入 → `sendWithPlugins(..., { 'my-plugin': payload })`
2. Server：`afterAssemblePrompts` 读 `ctx.plugins` 改 `messages`

参考：`guidance-generate`。

---

## 9. 禁止事项

- 在 `web.mjs` 中 `fetch('/api/lorebooks')`、`fetch('/api/chat')` 等绕过宿主（权限与演进无法保证）。
- 假设 `prepareContext` / `complete` 会注入角色卡或 lore（不会；仅转发你给的 messages 或服务端按插件规则拼上下文）。
- 在 `register()` 顶层 await 重 API 或阻塞 UI。
- 自动把摘要 lorebook 绑进对话 `lorebookIds`（注入由用户在对话设置勾选，见 `DOC/12` §1.1）。

---

## 10. 规划能力（尚未实现）

| 能力 | 说明 |
|------|------|
| 服务端 `onAssistantReplyPersisted` | 自动触发摘要流水线（当前由 Web lifecycle 负责） |
| 字段级 permissions 与 turn.plugins 写权限细分 | 部分 enforce 仍随路由演进 |

---

## 11. 延伸阅读

| 文档 | 内容 |
|------|------|
| `DOC/09-plugin-system-and-guidance-generate.md` | 插件系统、manifest、懒加载、设置页 |
| `DOC/10-plugin-conversation-host.md` | 对话 DTO、runScope 细节、swipe/export |
| `DOC/11-plugin-host-completion-and-lorebook.md` | 补全与 lorebook 产品设计定案 |
| `DOC/12-plugin-plot-summary.md` | Historian（剧情纪要）完整业务示例 |
| `DOC/24-regex-and-session-audit.md` | 宿主原生正则三阶段、`host.regex` / `api.regex` |
| `DOC/30-plugin-trace-keeper.md` | **迹录** Trace Keeper（✅ v1） |
| `plugins/README.md` | 内置插件列表与打包说明 |

---

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-02 | 首版：合并 DOC/10–11 已实现 API；新增 `prepareContext`、`normalizeEntryRefs`、`completeDraft` |
| 2026-06-02 | 核对 `lorebook.ensure` / `applyOrder` 已实现；补 REST 与 `lorebook.write` 权限说明 |
| 2026-06-08 | `plot-summary` 更名；`reorder-curated` 移除，改为通用 `apply-order`；Historian 排序算法在 `plugins/plot-summary/src/shared/` |
| 2026-06-23 | §3.14 `host.regex` 标为已实现（2026-06-10）；§4.2 补 `api.regex` |
