# 插件宿主 API — 出站补全、资料库与会话设置

> **状态**：**已定案且大部分已落地**（2026-06-02）。  
> **读者**：**第三方插件作者请优先阅读 [`DOC/18-plugin-host-developer-api.md`](18-plugin-host-developer-api.md)**（宿主 API 单一入口）；本文保留产品与边界定案。  
> **关联**：`DOC/03` §1.3、`DOC/09` §5、`DOC/10`、`DOC/12`（策展记忆插件示例）。

---

## 0. Web `PluginWebHost` 速查（作者入口）

在 `register(host)` 中通过 **`createScopedPluginHost` 注入的 `host`** 调用（`pluginKey` 已带命名空间）。**禁止**绕过 host 访问下表以外的本体 URL。

### 0.1 已有（今日即可用，见 `DOC/10` / `DOC/09`）

| 命名空间 | 方法 | 说明 |
|----------|------|------|
| `host.conversation` | `getId()` | 当前对话 id |
| | `getMeta()` | 标题、角色名等 |
| | `runScope(opts, fn)` / `runBatch(fn)` | 批处理 read/patch，≤50 轮/批 |
| | `refresh()` | 写盘后刷新 UI |
| `host.lifecycle` | `onAssistantReplyPersisted` / `onAssistantReplyComplete` | 落盘 / 流程结束 |
| `host.chat` | `sendWithPlugins` / `regenerateWithPlugins` | **正常聊天**（含组装），**不是**摘要 |
| `host.ui` | `toast` / `confirm` / `progress` / … | |
| `host.render` | `richMessageToHtml` / `reasoningToHtml` | |
| 注册 | `registerSlotButton` / `registerFormDialog` / `registerStyles` | 见 `DOC/09` §8、`DOC/18` §3.1 |

### 0.2 扩展 API（`DOC/11` 规划项 + 2026-06-02 落地）

| 命名空间 | 方法 | 状态 | 宿主背后 |
|----------|------|------|----------|
| **`host.lorebook`** | `list()` / `get()` / `createEntry()` / `patchEntry()` | ✅ | `GET/POST/PATCH /api/plugins/:id/lorebooks/…` |
| | `normalizeEntryRefs(req)` | ✅ | `POST …/lorebooks/normalize-entry-refs` |
| | `reorderCurated(lorebookId, req?)` | ✅ | `POST …/lorebooks/:id/reorder-curated`，单次读+写重排 order（`DOC/12` §4.2） |
| | `ensure(req?)` | ✅ | `POST …/lorebooks/ensure`，自动建 summary 书，见 `DOC/12` §2.3 |
| **`host.api`** | `listPresets()` | ✅ | `GET /api/settings` |
| **`host.plugin`** | `complete(req)` | ✅ | `POST …/complete` |
| | `prepareContext(req)` | ✅ | `POST …/prepare-context`（读 turn + 拼 `<history>` / `<previous-memories>`） |
| | `completeDraft(req)` | ✅ | `POST …/complete-draft`（插件 `server.mjs` 的 `completeDraft` hook） |
| **`host.conversation`** | `getPluginSettings()` / `patchPluginSettings()` | ✅ | `GET/PATCH …/conversations/:id` |
| **`host.plugins`** | `getUserSettings()` | ✅ | `GET /api/plugins/:pluginId/settings` |

类型契约（实现时写入 `web/src/plugins/types.ts`）：

```ts
host.lorebook.list(): Promise<{ id: string; name: string; updatedAt: string }[]>
host.lorebook.get(id: string): Promise<Lorebook>
host.lorebook.createEntry(id, body): Promise<LorebookEntry>
host.lorebook.patchEntry(id, entryId, body): Promise<LorebookEntry>

host.api.listPresets(): Promise<{ id: string; alias: string }[]>

host.plugin.complete(req: {
  apiConfigId: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  modelOverride?: string
  stream?: boolean
  responseFormat?: 'json_object' | 'text'
}): Promise<{ content: string; usage?: …; latencyMs?: number }>

host.conversation.getPluginSettings(): Promise<Record<string, unknown>>
host.conversation.patchPluginSettings(partial): Promise<Record<string, unknown>>
```

---

## 1. 原则

| 项 | 定案 |
|----|------|
| 摘要 / Tracker | **插件业务**；宿主**不**提供 `summarize`、不内置摘要 prompt |
| 出站模型调用 | 宿主提供 **通用「按已登记 API 预设转发 messages」**；插件提交 `apiConfigId` + `messages[]` |
| 资料库 | 宿主提供 **Lorebook 条目级读写**（insert / patch）；**不**要求插件整本 `PUT /api/lorebooks` |
| 会话差异 | 宿主在 **`index.json`** 存 **会话级插件设置**（如目标 lorebook）；与全局 `settings.json`、对话 `lorebookIds`（注入用）分离 |
| 密钥 | 仅服务端查 `api-settings` 出站；浏览器插件**不**持明文 key |

与正常聊天的区别：

| | `/api/chat` | 插件补全转发（本节） |
|--|-------------|-------------------|
| 组装 | 角色卡、预设、history、memory、lore 扫描 | **仅**插件提交的 `messages[]` |
| 落盘 | 追加 turn / 流式 assistant | **无**（除非插件另调 conversation patch） |
| 用途 | 用户对话 | 插件摘要、Tracker、sidecar 刷新等 |

---

## 2. 插件出站补全（Completion Forward）

### 2.1 端点（规划）

```http
POST /api/plugins/:pluginId/complete
Authorization: Bearer …
Content-Type: application/json
```

**请求体**：

```ts
interface PluginCompleteRequest {
  /** 指向 api-settings 中已登记预设的 id（UI 可用 alias 展示，提交用 id） */
  apiConfigId: string
  /** OpenAI Chat Completions 形；由插件拼好，宿主不再注入角色/世界书 */
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  /** 可选覆盖预设内 model */
  modelOverride?: string
  /** 默认 false；摘要任务建议非流式 */
  stream?: boolean
  /** 可选；若底层支持且插件开启 JSON 模式 */
  responseFormat?: 'json_object' | 'text'
}
```

**响应（非流式）**：

```ts
interface PluginCompleteResponse {
  ok: true
  content: string
  /** 可选审计 */
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
}
```

**错误**：`plugin_not_found`、`plugin_disabled`、`api_config_not_found`、`upstream_error`（透传或摘要）、`messages_empty` 等。

### 2.1.1 服务端行为

1. 校验 JWT、`pluginId` 与 registry **enabled**。  
2. 校验 manifest **`permissions`** 含 `plugin.complete`（实现后 enforce）。  
3. 用 `apiConfigId` 读用户 `api-settings.json`，拼 URL / Header / Body，**服务端 `fetch`** 上游。  
4. 返回 assistant 正文（或流式 SSE，v1 可仅非流式）。  
5. **不**写 turn、**不**改 `index.json`（除非插件另调 PATCH）。

### 2.2 与 `apiPreset.plugins[pluginId]` 的关系

- 对话级 **`index.json` → `apiPreset.plugins[pluginId]`** 仍可表示「本对话默认用哪条 API」（见 `DOC/03` §1.2.1）。  
- 本节 **`complete` 请求体显式带 `apiConfigId`**，以插件 settings / 会话覆盖为准；若请求省略，实现时可回退 `resolvedPlugin(pluginId)`（实现时写死一种优先级）。

### 2.3 Web 侧

插件只调 **`host.plugin.complete`**（见 **§0.2**）；宿主内部 `POST /api/plugins/{scopedPluginId}/complete`。**不是** `host.ai.*`，**不是** `/api/chat`。

---

## 3. 资料库条目 API（Lorebook Entry CRUD）

### 3.1 现状与目标

| 能力 | 插件作者入口 | 服务端 |
|------|--------------|--------|
| 列表 / 读单本 | **`host.lorebook.list` / `get`**（规划） | 已有 `GET` |
| 追加条目 | **`host.lorebook.createEntry`** | 规划 `POST …/entries` |
| 更新条目 | **`host.lorebook.patchEntry`** | 规划 `PATCH …/entries/:id` |
| 整库替换 | **禁止插件使用** | 现有 `PUT /api/lorebooks` 仅本体 UI |

### 3.2 追加条目（规划）

```http
POST /api/lorebooks/:lorebookId/entries
```

```ts
interface LorebookEntryCreateBody {
  groupId?: string          // 缺省：该书默认组或插件约定组
  title: string
  content: string
  keys?: string[]
  comment?: string
  enabled?: boolean         // 默认 true
  constant?: boolean
  triggerMode?: 'keyword' | 'constant' | 'vector'
  priority?: number         // 默认 100
  order?: number
}

interface LorebookEntryCreateResponse {
  ok: true
  entry: LorebookEntry     // 含服务端生成的 id、createdAt、updatedAt
  savedAt: string
}
```

写盘后：按现有逻辑 **schedule lorebook 向量 reindex**（若该书/条目启用 vector）。

### 3.3 更新条目（规划）

```http
PATCH /api/lorebooks/:lorebookId/entries/:entryId
```

```ts
interface LorebookEntryPatchBody {
  title?: string
  content?: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  priority?: number
  order?: number
  groupId?: string
}
```

用于 **Sidecar / Tracker**：固定 `entryId`，每次触发 **覆盖** `content`（及可选 `keys` / `title`），**不** delete + insert。

### 3.4 权限（规划）

| manifest permission | 说明 |
|-------------------|------|
| `lorebook.read` | 允许 `host.lorebook.list` / `get` |
| `lorebook.entry.write` | `POST` / `PATCH` 条目 |

插件 **不得** `PUT` 整库替换他人条目（v1 可禁止插件角色调用 `PUT /api/lorebooks`）。

---

## 4. 会话级插件设置（Conversation Plugin Settings）

### 4.1 动机

- 全局 `data/plugins/{pluginId}/{userId}/settings.json`：默认 API、默认 prompt 模板、默认触发间隔等。  
- **同插件不同会话**需不同 **目标 lorebook**、sidecar `entryId`、触发计数，避免摘要写入错误的书。

### 4.2 存储位置

`chats/{conversationId}/index.json` 扩展字段（与 `lorebookIds`、`apiPreset` 并列）：

```ts
interface ConversationIndex {
  // …既有字段…
  /**
   * 会话级插件配置。键为 pluginId，值为插件自定义 JSON；
   * 宿主只做 JSON 对象校验与 PATCH 合并，不解释业务字段。
   */
  pluginSettings?: Record<string, Record<string, unknown>>
}
```

示例（策展记忆类插件 `curated-memory`，id 实现时确定）：

```json
{
  "pluginSettings": {
    "curated-memory": {
      "targetLorebookId": "lore-mem-main",
      "triggerEveryNTurns": 4,
      "lastTriggeredTurnOrdinal": 12,
      "sidecarEntryIds": { "tracker": "entry-tracker-01" },
      "entrySortMode": "auto-turn-suffix"
    }
  }
}
```

### 4.3 与 `lorebookIds` 的边界

| 字段 | 用途 |
|------|------|
| `lorebookIds` | **聊天组装**时扫描 / 注入世界书 |
| `pluginSettings.{id}.targetLorebookId` | 插件 **仅向该书写入**摘要条目 |

两字段 **可指向同一本书，也可分离**（例如 RP 用 A 书注入，摘要只写 B 书「会话记忆」）。

**注入路径（定案）**：用户勾选进 `lorebookIds` 后，**仅**由聊天组装管线 `resolveLorebookInjectionText` → `assemblePrompts` 的 `ctx.world` 注入 LLM；插件只维护 `targetLorebookId` 上的条目，**不得**默认 PATCH `lorebookIds`。

**多书绑定 XML（已实现，见 `DOC/03` §13.2）**：`lorebookIds.length > 1` 时，命中条目按 **资料库 `name`** 分组为 `<lorebook name="…">` 子块；单本仍用扁平 `<lores><lore>…</lore></lores>` 以兼容旧 prompt。

**插件新建条目**：`createEntry` 的 `triggerMode` / `keys` 由插件 settings 默认（策展记忆见 `DOC/12` `defaultEntryTriggerMode`）；与注入扫描规则一致。

### 4.4 HTTP（规划）

```http
PATCH /api/chat/conversations/:id
```

请求体增加：

```json
{
  "pluginSettings": {
    "curated-memory": { "targetLorebookId": "lore-abc", "triggerEveryNTurns": 3 }
  }
}
```

- **浅合并**：`pluginSettings[pluginId]` 与磁盘已有对象 merge（实现时写死 deep 或 one-level merge）。  
- 插件只调 **`host.conversation.getPluginSettings` / `patchPluginSettings`**（§0.2）。  
- 插件 **不得** 直接改 `apiPreset` / `feature_bindings`（`DOC/03` §1.3）。

### 4.5 触发状态

`lastTriggeredTurnOrdinal`、`sidecarEntryId` 等可由：

- 插件在每次成功摘要后 **PATCH** `pluginSettings`；或  
- 插件私有 `settings.json` 内 `progressByConversation`（`DOC/10` §5 模式），会话字段优先。

实现时二选一并写入插件文档。

---

## 5. 与 `DOC/10` 的关系

| 场景 | 用哪个文档 |
|------|------------|
| 读改对话 turn | **`DOC/10`** — `host.conversation.runScope` |
| 资料库 / 补全 / 会话 pluginSettings | **本文 §0.2** |
| Slot / lifecycle / 性能约定 | **`DOC/09`** §8 |

---

## 6. 实现清单

**服务端**

- [ ] `POST /api/plugins/:pluginId/complete` + `plugin.complete`
- [ ] `POST /api/lorebooks/:id/entries`
- [ ] `PATCH /api/lorebooks/:id/entries/:entryId`
- [ ] `ConversationIndex.pluginSettings` + `PATCH /api/chat/conversations/:id`
- [ ] manifest `permissions` enforce

**Web 宿主（`web/src/plugins/plugin-host-api.ts` 或等价模块，统一 fetch）**

- [ ] `host.lorebook.*` 四个方法
- [ ] `host.api.listPresets`
- [ ] `host.plugin.complete`（`scopedPluginId` 来自 `createScopedPluginHost`）
- [ ] `host.conversation.getPluginSettings` / `patchPluginSettings`
- [ ] `host.plugins.getUserSettings`（可选，替代插件直 fetch settings）
- [ ] `PluginWebHost` 类型与 `createPluginWebHost` 接线

---

## 7. 参考（当前代码）

- API 预设：`server/src/api-settings-file.ts`（`ApiPreset.id`、`alias`）
- 资料库：`server/src/lorebook-file.ts`、`server/src/index.ts` `/api/lorebooks*`
- 会话索引：`server/src/chat-storage.ts` `ConversationIndex`
- 插件出站原则：`DOC/03` §1.3
