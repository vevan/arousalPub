# 插件 — 策展式记忆（Curated Memory）设计指南

> **状态**：**v1.1 已落地联调中**（手动摘要、预览确认、Memorybook 自动块待续测）。  
> **关联**：`DOC/11` 宿主 API、`DOC/09` 插件系统、`DOC/10` 对话 read、`DOC/03` §13 世界书。  
> **排期**：Sidecar 结构化设置 UI → **`DOC/04` P0**。

---

## 1. 产品语义

将一段对话 **策展** 为资料库中的一条（或更新一条）**可检索记忆**：

| 概念 | 说明 |
|------|------|
| **摘要记忆** | 每 N 轮（或可配置）触发；模型返回 `{ title, content, keywords }` → **新增** lore 条目 |
| **Sidecar / Tracker** | 固定一条 lore 条目；每次触发 **覆盖** 同一 `entryId` 的 `content`（及可选 `keys`） |
| **摘要** | **插件能力**（prompt、解析、触发计数） |
| **Lorebook 读写** | **宿主能力**（`DOC/11`） |

与本体 **turn 向量记忆**（`memory-pipeline`）互补：向量记忆自动召回历史 turn；策展记忆由用户/插件决定「必须进资料库的事实」。

### 1.1 写入 vs 注入（定案）

| 阶段 | 负责方 | 说明 |
|------|--------|------|
| **写入** | 插件 | 仅向 `pluginSettings.targetLorebookId`（或自动 ensure 的书）`createEntry` / `patchEntry` |
| **注入** | **Prompt 管线** | 用户把资料库勾进对话 **`lorebookIds`** 后，由 `resolveLorebookInjectionText` → `ctx.world` 发给 LLM；插件**不**改 `lorebookIds`、不自行插 messages |

插件**不得**默认把摘要书绑进 `lorebookIds`；用户若要把摘要当设定用，须在对话设置里**显式**勾选该本（可与 `targetLorebookId` 为同一 id）。

---

## 2. 配置分层

### 2.1 全局（`settings.json` + `settingsSchema`）

| 字段（示例） | 说明 |
|--------------|------|
| `apiConfigId` | 默认 API 预设 id（设置页用 **alias** 展示，存 **id**） |
| `systemPromptTemplate` | 摘要 system 模板（可多行 text，默认带「返回 JSON：title, content, keywords」） |
| `triggerEveryNTurns` | 默认每 N 个 **turn** 触发（实现时定义：通常按 `turnOrdinal` 增量或 assistant 落盘次数） |
| `defaultTargetLorebookId` | 未配置会话覆盖时的目标书 |
| `titleFormat` | `plain` \| `range-suffix`（见 §4） |
| `sidecarEnabled` | 是否启用 Tracker 模式 |
| `sidecarSystemPromptTemplate` | Tracker 用 system（输出仍为 JSON 或纯文本，实现时定案） |
| `historyTurnCount` | 单次摘要纳入的最近 turn 数（≤50，与 `read` 批上限对齐） |
| `targetLorebookMode` | `manual` \| `auto`：手动选已有书 / 按模板自动 ensure（见 §2.3） |
| `autoLorebookNameTemplate` | 自动模式书名模板，默认 `{{conversationTitle}}-summary` |
| `defaultEntryTriggerMode` | 新建条目默认触发：`constant` \| `keyword` \| `vector`（推荐 **`constant`**：绑定注入后每轮可见） |
| `defaultEntryKeysFromModel` | `defaultEntryTriggerMode === 'keyword'` 时，是否用模型 JSON 的 `keywords` 填 `keys`（默认 `true`） |

### 2.2 会话级（`index.json` → `pluginSettings[pluginId]`）

见 **`DOC/11` §4**。推荐字段：

| 字段 | 说明 |
|------|------|
| `targetLorebookId` | **本对话**写入目标（避免污染其它会话） |
| `triggerEveryNTurns` | 覆盖全局 N |
| `lastTriggeredTurnOrdinal` | 上次成功触发的 turnOrdinal（插件维护） |
| `sidecarEntryId` | Tracker 固定条目 id（首次创建后写入） |
| `titleFormat` | 覆盖全局标题格式 |
| `targetLorebookMode` | 可选，覆盖全局 `manual` / `auto` |
| `autoCreateSummaryBook` | 可选，本会话是否允许自动 ensure（覆盖全局自动模式） |

### 2.3 目标资料库：手动 / 自动

| 模式 | 行为 |
|------|------|
| **manual** | 用户在设置或侧栏选定 `targetLorebookId`；插件只写入，**不** `create` 新书 |
| **auto** | 首次需写入且无有效 `targetLorebookId` 时，宿主 `host.lorebook.create` / `ensure` 按 `autoLorebookNameTemplate` 建书（如 `我的冒险-summary`），写回 `pluginSettings.targetLorebookId` |

自动建书**不**修改 `lorebookIds`。重名策略（实现时二选一写死）：同名书已存在且本会话已指向 → 复用；否则在模板后加短 id 后缀。

**查询 lorebook**：`await host.lorebook.list()` / `host.lorebook.get(id)` 填设置与会话表单（**勿** `fetch /api/lorebooks`）。**API 预设下拉**：`await host.api.listPresets()`（展示 `alias`，提交 `id`）。

---

## 3. 运行时流程

### 3.1 触发（插件自维护）

1. 订阅 `host.lifecycle.onAssistantReplyPersisted`（或 `onAssistantReplyComplete`，实现时优选 **persist**，更早、不等待 `loadMessages`）。  
2. 读会话 `pluginSettings` + 全局 settings，计算是否达到 **每 N 轮**。  
3. 若 `host.conversation` 处于 busy / 写锁，**跳过或延后**（与 `DOC/10` 门禁一致）。  
4. 更新计数前应先确认本次任务能完成，避免「记了 lastTriggered 但未写入 lore」。

### 3.2 读取历史

```text
host.conversation.runScope({ writeLock: false, requireIdle: true }, async (ctx) => {
  const turns = await ctx.read({ from, to })  // to - from + 1 ≤ 50
})
```

将 `from..to` 内 turn 格式化为 transcript，例如：

```text
{{userName}}: …
{{assistantName}}: …
```

（插件 `complete` 的 user 消息内也可用 `<history>…</history>` 包裹上述 transcript，**仅属插件 prompt**，与宿主聊天组装里的 **`ctx.history` user/assistant 链** 无关，见 `DOC/03` §14。）

宏可用 `host.conversation.getMeta()` 中的显示名；**不**依赖 ST 的 `{{user}}` 管线。

### 3.3 组装摘要提示词（插件逻辑）

插件构造 **OpenAI messages**（宿主不修改）：

```json
{
  "messages": [
    {
      "role": "system",
      "content": "你是一个专业的摘要编写者……返回格式必须为 JSON 对象，且仅包含键：title、content、keywords（keywords 为字符串数组）……"
    },
    {
      "role": "user",
      "content": "<history>\n用户: …\n助手: …\n</history>"
    }
  ]
}
```

- `system` 来自 `systemPromptTemplate`（用户可改，settings 默认值）。  
- `user` 内 `<history>…</history>` 由插件拼接；可加 `<previous-memories readonly>…</previous-memories>`（可选，读目标 lorebook 最近条目标题列表）。

### 3.4 调用模型（经宿主）

```ts
await host.plugin.complete({
  apiConfigId,
  messages: [ { role: 'system', content: '…' }, { role: 'user', content: '<history>…</history>' } ],
  stream: false,
  responseFormat: 'json_object',
})
```

（`DOC/11` §0.2；**勿**直调 REST。）

**禁止**：`host.chat.sendWithPlugins`（会走完整聊天组装并产生新 turn）。

### 3.5 解析与写入 Lorebook

1. 插件解析 `content` 为 JSON：`{ title, content, keywords }`（可用 `dirty-json` 等，容错策略插件自定）。  
2. 失败 → `host.ui.toast`，**不**推进 `lastTriggeredTurnOrdinal`。  
3. 成功 → 按模式写入：

| 模式 | Host API |
|------|----------|
| 摘要记忆 | `host.lorebook.createEntry(targetLorebookId, { title, content, keys, triggerMode, … })` |
| Sidecar | `host.lorebook.patchEntry(…, sidecarEntryId, …)`；若无 id 则先 `createEntry` 再 `host.conversation.patchPluginSettings({ sidecarEntryId })` |

4. `keys` ← `keywords`（当 `defaultEntryKeysFromModel`）；`triggerMode` ← **`defaultEntryTriggerMode`**（`constant` 时勿依赖 keys）；`priority` / `groupId` 用插件默认或 settings。  
5. 可选：`PATCH` 会话 `pluginSettings` 更新 `lastTriggeredTurnOrdinal`、`sidecarEntryId`。

---

## 4. 标题格式

插件生成写入条目的 `title` 时支持可配置 **`titleFormat`**：

| 值 | 规则 | 示例 |
|----|------|------|
| `plain` | 仅用模型返回的 `title` | `酒馆相遇` |
| `range-suffix` | 在模型 `title` 后追加 `-{startTurnNum}-{endTurnNum}` | `酒馆相遇-8-11` |

约定：

- **`startTurnNum` / `endTurnNum`** 为本次纳入 `<history>` 的 **turnOrdinal** 闭区间端点（与 UI「第 n 回」一致，**从 0 起**）。  
- 分隔符为 **单个连字符** `-`；若模型 `title` 已含尾部 `-数字-数字`，插件可实现去重或一律覆盖为规范后缀（实现时写死一种）。  
- **Sidecar** 条目：`title` 可固定为 settings 中的 `sidecarTitle`（如 `Tracker`），**不**强制 range-suffix；`content` 每次覆盖。

---

## 5. Sidecar（Tracker）与摘要记忆

| | 摘要记忆 | Sidecar |
|--|----------|---------|
| Lorebook 操作 | **insert** 新 entry | **patch** 固定 entry |
| 条目 id | 每次新建 | `pluginSettings.sidecarEntryId` 持久化 |
| 典型用途 | 场景快照、章节摘要 | 人物状态、好感、当前目标等 **随对话更新** |
| 触发 | 每 N 轮 | 可同 N 轮或每轮 persist 后（settings） |

同一插件可同时：摘要 → insert；Tracker → patch 同一本书的不同条目。

---

## 6. manifest 与权限（规划）

```json
{
  "id": "curated-memory",
  "name": "策展记忆",
  "version": "1.0.0",
  "permissions": [
    "plugin.complete",
    "lorebook.read",
    "lorebook.entry.write",
    "conversation.read"
  ],
  "settingsSchema": { "version": 1, "fields": [ "…" ] },
  "ui": {
    "slots": [
      { "name": "composer-toolbar", "entry": "./dist/web.mjs" },
      { "name": "assistant-turn-footer", "entry": "./dist/web.mjs" }
    ]
  }
}
```

- **无** `afterAssemblePrompts` 亦可（纯 Web + 宿主 REST）。  
- 若需落盘 `turn.plugins[]` 记录某次摘要元数据，可再加 server hook `resolveTurnPluginEntries`（可选）。

---

## 7. UI 建议（插件实现）

| 入口 | 行为 |
|------|------|
| 设置页 schema | API 预设、目标书模式（手动/自动）、默认 `triggerMode`、prompt 模板、N、titleFormat |
| 对话侧栏 / composer 按钮 | 编辑 **本会话** `targetLorebookId`、N（写 `pluginSettings`） |
| 手动「立即摘要」 | 忽略 N，跑 §3 一次 |
| `assistant-turn-footer` | 可选：仅最后一轮显示「摘要本段」 |

进度：`host.ui.progress` + `clearProgress`（长对话分批 read 时）。

---

## 8. 与 STMB 的差异（概念借鉴）

| STMB | 本插件（arousalPub） |
|------|----------------------|
| ST `world-info.js` | `DOC/11` lorebook entry API |
| ST `chat[]` 消息下标 | **turnOrdinal** + `conversation.read` |
| 扩展内直连 OpenAI | `POST …/complete` 转发 |
| `chat_metadata` 场景标记 | `pluginSettings` + 可选 turn 范围 |
| Slash / Job 队列 | 不做 v1 |

---

## 9. 实现清单（插件包）

- [x] `plugins/curated-memory/` manifest、locales、settings 模板  
- [x] `src/` → esbuild → `dist/web.mjs` + `dist/server.mjs`（`completeDraft` hook）  
- [x] `web.mjs`：lifecycle 触发（Web）、手动摘要、会话设置 PATCH、预览确认  
- [x] 解析 JSON + `titleFormat` range-suffix（服务端 `completeDraft`）  
- [x] insert / patch lorebook；`prepareContext` + `normalizeEntryRefs` 宿主 API  
- [x] 注册 `BUNDLED_PLUGIN_IDS` + sync  
- [ ] **P0**：`host.lorebook.create/ensure` 自动建目标书（见 `DOC/04`）  

---

## 10. 参考

- 宿主能力：`DOC/11-plugin-host-completion-and-lorebook.md`  
- 对话 read：`DOC/10-plugin-conversation-host.md`  
- 世界书条目结构：`server/src/lorebook-types.ts`  
- 概念参考：`.tmp/SillyTavern-MemoryBooks`（**不**移植其代码）
