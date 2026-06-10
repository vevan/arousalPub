# 正则替换（原生）与会话审计（debug）

> **状态**（2026-06-10）：**§3 会话 debug 审计已实现**（2026-06-09 验收）；**§2 正则替换定案、未实现**。列入 **`DOC/04` P0**（当前仅剩 regex）。  
> **关联**：`DOC/03` §6.8、§审计、`DOC/10`、`DOC/18`、`DOC/02` §4 可观测性。

---

## 1. 背景

- 原规划 **`regex-transform` 插件** + **`host.capabilities`** 试点（`DOC/09` §8.7、`DOC/10` §6.3）**废止**；正则改为**宿主原生能力**。
- 可观测性：`DOC/02` §4 要求 RAG/调用命中明细；定案为 **仅 debug 开启时**写入会话级 **`chat-audit.json`**（合并原 `chat-prompt.json` 职责并扩展），**不**膨胀 chunk。

---

## 2. 正则替换（原生）【定案 · 未实现】

> 列入 P0；实现清单见 §2.8。当前代码库无 `regex-rules.json` / `/api/regex-rules` 等模块。

### 2.1 存储

**作用域**：**用户级** `data/{userId}/regex-rules.json`；**无**会话 `index.json` 字段、**无**对话设置 Tab。enabled 规则对该用户下全部对话生效。

```
data/{userId}/regex-rules.json
```

```json
{
  "schemaVersion": 1,
  "savedAt": "…",
  "rules": [
    {
      "id": "a1b2c3d4",
      "label": "剥 tracker",
      "order": 10,
      "enabled": true,
      "phases": ["outgoing", "persist", "display"],
      "fields": ["system", "assistant"],
      "skipLastNTurns": 3,
      "pattern": "…",
      "flags": "g",
      "replacement": ""
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `order` | 整数，**越小越先执行**；**系统设置**页**拖曳**调整顺序后写回（debounce **1 次**写文件） |
| `enabled` | `false` 时跳过执行，**仍占位**排序 |
| `phases` | `display` \| `outgoing` \| `persist`，可多选 |
| `fields` | `system` \| `user` \| `assistant` \| `reasoning` |
| `skipLastNTurns` | `0` = 凡命中阶段+字段则应用；`N≥1` = **最近 N 轮**（按 `turnOrdinal` 相对 `tailOrdinal`）**不**应用**该条**规则 |

新建规则：`order = max(existing.order) + 10`。

### 2.2 三阶段管线

| 阶段 | 作用对象 | 改磁盘 | 改下次 LLM | 改 UI |
|------|----------|--------|------------|-------|
| **`display`** | 气泡 / 导出 HTML / 预览渲染 | 否 | 否 | 是 |
| **`outgoing`** | 组装后 `messages[]`（含 **system**） | 否 | 是 | 否* |
| **`persist`** | 落盘前 `userText` / `receives[].content` / `reasoning` | 是 | 是（经 memory/history） | 落盘后见 §2.4 |

\* `outgoing` 不直接改 UI；落盘后 UI 以 §2.4 为准。

**`outgoing` 管道顺序**（定案）：

```text
assemble → budget trim → regex(outgoing) → plugin afterAssemblePrompts → upstream
```

**无 `turnOrdinal` 的 system**（恒定 lore / memory / world 等）：不受 `skipLastNTurns` 限制；规则含 `system` + `outgoing` 即应用。

### 2.3 执行引擎

```text
enabled 规则 → 按 order 升序 → 对同一文本/轮次在内存串联 apply
禁止：每条规则单独写盘
```

```ts
applyRule(rule, ctx: {
  phase: 'display' | 'outgoing' | 'persist'
  field: 'system' | 'user' | 'assistant' | 'reasoning'
  turnOrdinal?: number
  tailOrdinal: number
  text: string
}) → string

applyRules(text | messages, ruleIds?, ctx)  // 过滤 enabled + phase + skipLastNTurns
```

**`skipLastNTurns` 与阶段**（单条规则）：

| 阶段 | 应用条件 |
|------|----------|
| `outgoing` | 可归属 `turnOrdinal` 的片段：`ordinal ≤ tailOrdinal − N` |
| `persist` | 当前落盘轮：`currentOrdinal ≤ tailOrdinal − N` |
| `display` | 渲染轮：`turnOrdinal ≤ tailOrdinal − N` |

典型 **tracker**：`phases: ["outgoing","persist"]`，`skipLastNTurns: 3` — 近 3 轮保留跟踪标记给模型与磁盘，更早轮在 outgoing/persist 剥除。

### 2.4 流式与落盘后 UI

```text
流式中     → UI 显示上游原文
落盘完成   → 服务端 persist 阶段处理 → 写入 chunk
persist 事件 → 前端用服务端返回的最终正文更新该轮（立刻，不等全量 reload）
之后渲染   → 以磁盘为底；再叠 display 阶段（含 skipLastNTurns）
```

- 仅 **persist**、无 **display**：落盘后 UI 仍立刻变干净（显示 persist 后磁盘内容）。
- 仅 **display**：落盘后磁盘可为原文，UI **立刻**跑 display 管道。
- 再生 / PATCH 写盘：同链路。

### 2.5 写盘粒度（硬性验收）

| 场景 | 定案 |
|------|------|
| 单轮聊天 `persist` | 全部命中规则内存串联后 **`persistTurnAfterModelReply` 写 1 次** |
| 历史批量 | `read` → `applyRulesToTurns(全部 ruleIds)` → **`batchUpdateConversationTurns` 一次提交**；**每个 chunk 文件至多 1 读 1 写**（`DOC/22`） |
| 跨多 chunk | 写盘次数 ∝ **chunk 数**，**不** ∝ **规则条数** |
| 规则 CRUD / 拖曳排序 | `regex-rules.json` **1 次写** / debounce 保存 |

```text
POST /api/chat/conversations/:id/regex/apply
  dryRun: true  → 0 写盘
  apply        → 写锁内 read → 内存 apply → batchUpdateConversationTurns
```

**单测**：2+ chunk、3+ 规则 fixture，断言写盘次数 = 涉及 chunk 数（+ index 至多 1 次），与规则条数无关。

### 2.6 宿主 API（供插件）

与 `host.lorebook` 同级，**不**依赖 `host.capabilities`：

**Web `host.regex`**

```ts
listRules(opts?: { phases?: string[] }): Promise<RegexRuleSummary[]>
applyText(text: string, ruleIds: string[] | 'all', ctx: RegexApplyContext): Promise<string>
applyMessages(messages: ChatMessage[], ruleIds, ctx): Promise<ChatMessage[]>
```

**Server `PluginServerHostApi.regex`**（hook / 服务端插件）

```ts
applyText / applyMessages  // 同语义
```

**消费示例**：`conversation-export` 导出前对正文 `applyText`（`phase: 'display'` 或专用 export 相位）；`plot-summary` 清理 sidecar 文本等。

### 2.7 UI

> **产品定案（2026-06-10）**：正则**仅系统设置**入口管理规则；**无对话级设置**（会话 `index.json` 不存 regex 开关/规则子集；对话齿轮内**无**正则 Tab）。所有 enabled 规则对用户下**全部对话**生效；`skipLastNTurns` 等按轮次语义在引擎内处理，非 per-conversation 配置。

| 位置 | 内容 | 是否「设置」 |
|------|------|-------------|
| **系统设置** `/settings` | 规则 CRUD、拖曳 `order`、测试串、enabled 开关 | ✅ **唯一规则管理入口** |
| **对话页** composer 工具栏 | 历史批量 apply（区间、dry-run、写锁）— **操作**，非规则编辑 | 否（动作入口） |
| **导出**（`conversation-export`） | 导出对话框勾选**全局**规则子集（display/outgoing 只读链） | 否（一次性导出选项） |

- **系统设置**：新增 Tab「正则替换」— 规则列表 + 编辑器 + 测试串；**`mdi-drag-vertical` 拖曳排序**（对齐 `BudgetTrimSettingsPanel` / `PluginSettingsPanel` 原生 drag）；debounce **1 次** PUT。
- **对话页**：不提供规则编辑；仅批量 apply 与写锁提示。
- **废止**：`regex-transform` 插件、`DOC/09` §8.7 以 regex 为 capabilities 试点。

### 2.8 实现清单

- [x] `regex-rules.json` + `GET/PUT /api/regex-rules`
- [x] `server/src/regex-apply.ts` 引擎 + `skipLastNTurns` / `order`（Phase 0 · 2026-06-10）
- [x] `POST /api/regex/apply-text`（无写盘预览 / `host.regex` 前置）
- [ ] `/api/chat` outgoing + persist 挂钩；SSE persist  payload 含最终正文
- [ ] `POST .../regex/apply`（dry-run / batchUpdateConversationTurns）
- [ ] Web 设置页拖曳 + 对话批量 UI；export 联动
- [ ] `host.regex` + server hook `api.regex`
- [ ] 写盘合并单测；流式落盘后 UI 单测/E2E

---

## 3. 会话审计（debug only）【已实现 · 2026-06-09】

> 实现：`server/src/chat-audit-file.ts`、`build-assembly-audit.ts`、`chat-persist-after-chat.ts`；Web `ChatTurnPromptDialog` 三 Tab。细则与验收见 **`DOC/03`** 审计段落、**`DOC/04`** §会话 debug 审计。

### 3.1 开关与条数

**会话** `index.json`（替代 `promptDebug` 命名）：

```json
{
  "auditDebug": {
    "enabled": false,
    "maxStored": 10
  }
}
```

**全局默认**（设置页 Debug Tab）：`auditDebugEnabled`、`auditDebugMaxStored`（默认 `false` / `10`）。新建会话继承全局，可 PATCH 覆盖。

| enabled | maxStored | 行为 |
|---------|-----------|------|
| `false` | 任意 | **不写**、轮次「查看审计」隐藏或提示未开启 |
| `true` | `0` | 不写（UI 校验建议 `maxStored ≥ 1` 才允许启用写入） |
| `true` | `1～200` | 写入 `chat-audit.json`，按 `turnId` 覆盖，保留最近 N 条 |

### 3.2 文件：`chat-audit.json`

路径：`chats/{conversationId}/chat-audit.json`（与 chunk 并列）。**废止**独立维护 `chat-prompt.json`；读盘可一期兼容：仅有 `chat-prompt.json` 时迁移为 `entries[].messages`。

```json
{
  "schemaVersion": 2,
  "entries": [
    {
      "turnId": "a1b2c3d4",
      "turnOrdinal": 12,
      "savedAt": "…",
      "chunkName": "turn-….json",
      "messages": [{ "role": "system", "content": "…" }],
      "assembly": {
        "estimatedTokens": 4096,
        "tokenModel": "…",
        "memory": {
          "hits": [{ "turnId": "…", "turnOrdinal": 3, "score": 0.82, "included": true }],
          "droppedCount": 0
        },
        "lore": {
          "matched": [{ "lorebookId": "…", "entryId": "…", "mode": "keyword", "included": true }],
          "droppedCount": 1
        },
        "history": { "turnOrdinals": [8, 9, 10, 11], "droppedCount": 0 },
        "budgetTrim": { "maxTokens": 8192 }
      },
      "calls": [
        { "kind": "chat", "apiConfigId": "…", "model": "…", "latencyMs": 1200, "usage": {} },
        { "kind": "embedding", "purpose": "memory_recall", "latencyMs": 45 }
      ]
    }
  ]
}
```

- **`messages`**：outgoing 最终态（**regex outgoing 之后**、upstream 之前）；**服务端自写**，不再依赖前端 `debugPrompt`。
- **`assembly` / `calls`**：仅 debug 开启时写入；**不进** chunk `turn.send` / `receive.runtime`（`runtime` 仍保留轻量 model/duration/tokens）。
- **`calls[].plugin.complete` / `plugins[]`**：schema **预留**（见 §3.6）；**P0 不写入**。

### 3.3 写入时机

```text
auditDebug.enabled && maxStored >= 1 && 落盘成功（/api/chat persist）
  → buildConversationOutboundMessages 得 assembly
  → 聚合本轮同步出站：chat + embedding（memory 召回）
  → appendChatAuditEntry（按 turnId 覆盖，slice -maxStored）
```

**不含**：落盘后异步触发的插件 LLM（如 `plot-summary` 自动摘要）；若需观测见 §3.6。

### 3.4 API / UI

| 旧 | 新 |
|----|-----|
| `GET .../chat-prompt` | `GET .../chat-audit`（可保留旧路由只读别名一期） |
| `promptDebug.maxStored` | `auditDebug.enabled` + `auditDebug.maxStored` |
| `ChatTurnPromptDialog` | 审计 Tab：提示词 / 组装命中 / 出站调用（已实现） |

### 3.5 实现清单

- [x] `CHAT_AUDIT_FILE`、`appendChatAuditEntry`；`chat-prompt` 读盘兼容
- [x] `buildAssemblyAudit` + `/api/chat` 落盘写入
- [x] embedding 写入 `calls[]`
- [x] 全局 + 会话 `auditDebug` 设置 UI；关闭时不写
- [x] 轮次审计 UI 三 Tab（`ChatTurnPromptDialog`）

### 3.6 插件与审计范围（2026-06-08 定案）

**P0 结论**：当前**没有**必须在 `chat-audit.json` 每轮条目里记录的插件出站 LLM。

| 插件 | 与本轮 audit 的关系 |
|------|---------------------|
| **guidance-generate** | 组装阶段注入 system；已体现在 **`messages`** + 主 **`chat`** `calls[]` |
| **plot-summary** | 唯一声明 `plugin.complete`；`prepareContext` / `completeDraft` 在 **落盘成功后**由前端 lifecycle 异步调用，**不在** `/api/chat` persist 同步链路 |
| **reply-complete-sound** / **swipe-cleaner** / **conversation-export** | 无出站 LLM，不参与本轮 audit |

**预留字段**：`calls[].kind: "plugin.complete"`、`plugins[]` 保留于 schema，供未来「插件出站与 chat 同请求」或「落盘后补写 audit」扩展；**未排期**，不挡 P0 验收。

**`turn.plugins[]`**（chunk 内，如 guidance 载荷）与 audit 的 `plugins[]` **不同**；前者已随轮次落盘，后者为 debug 出站元数据，当前未使用。

---

## 4. 与 P2 项关系

- **`host.capabilities`**（`DOC/09` §8.7）：仍为通用规划，**不以 regex 为试点**。
- **全量调用日志**（`DOC/04` 原 RAG/审计 TODO）：本定案覆盖 **debug 会话审计**；全库 `jsonl` 运维台账仍属 P1/P2 可选。

---

## 5. 参考实现路径

| 模块 | 参考 |
|------|------|
| 批量写盘 | `batchUpdateConversationTurns`（`swipe-cleaner`） |
| 拖曳 UI | `BudgetTrimSettingsPanel.vue`、`PluginSettingsPanel.vue` |
| 写锁 | `host.conversation.runBatch`（`DOC/10` §4） |
| 调试文件 | `appendChatPromptDebugEntry` → 演进为 `appendChatAuditEntry` |

---

## 6. 实施计划（参考 · 2026-06-10）

> **用途**：开发排期与验收对照；状态随实现更新。**UI 定案**：规则管理**仅**系统设置 `/settings`；**无对话级设置**（见 §2.7）。

### 6.1 目标与 P0 验收

| # | 验收项 | 可观测标准 |
|---|--------|-----------|
| A | 规则 CRUD + 拖曳 | `data/{userId}/regex-rules.json`；**系统设置** Tab debounce 1 次 PUT |
| B | outgoing | `assemble → trim → regex → afterAssemblePrompts → upstream` |
| C | persist | 落盘前改 `userText` / `receives` / `reasoning`；单轮 **1 次写盘** |
| D | 流式 UI | 流式显示上游原文；`arousal.persist` 含最终正文，前端立刻更新 |
| E | 历史批量 | `POST .../regex/apply` dry-run / apply；写盘次数 = chunk 数，≠ 规则数 |
| F | 宿主 API | `host.regex` + server `api.regex` |
| G | 审计 | `chat-audit.json` 的 `messages` = outgoing 最终态（regex 之后、upstream 之前） |

**不在 P0**：`conversation-export` 导出勾选（可 Phase 5 末班车）；对话级 regex 开关/规则子集（**明确不做**）。

### 6.2 架构与代码挂钩

```text
单轮 /api/chat:
  assemble → budget trim → regex(outgoing) → afterAssemblePrompts → upstream SSE
  → regex(persist) → persistTurnAfterModelReply（1×写盘）→ SSE arousal.persist（含 final*）

UI 渲染:
  磁盘原文 → regex(display) → renderRichMessage

历史批量:
  read 区间 → 内存 apply 全规则(persist) → batchUpdateConversationTurns
```

| 模块 | 文件 | 动作 |
|------|------|------|
| outgoing | `server/src/chat-assemble.ts` | trim 后、`applyPluginsAfterAssemblePrompts` **前**插入 regex |
| persist | `server/src/chat-persist-after-chat.ts` | 写盘前 apply persist 阶段 |
| SSE | `server/src/sse-assistant.ts`、`ChatPersistResult` | 扩展 `finalUserText` / `finalAssistantContent` / `finalAssistantReasoning` |
| 前端落盘 | `web/.../completion.ts`、`use-chat-outbound.ts` | persist.ok 时用 final* 更新 turn |
| display | `ChatTurnAssistant.vue`、`ChatTurnUser.vue` | `renderRichMessage` 前套 display |
| 批量 | `server/src/chat-storage.ts` | 复用 `batchUpdateConversationTurns` |
| 规则 UI | `SettingsView` 新 Tab | **唯一**规则管理入口；对话页无 regex 设置 Tab |
| 审计 | 已有 `assembledMessages` | outgoing 插入 regex 后自动对齐 |

### 6.3 分期（Phase 0–6）

#### Phase 0 · 类型与存储（~1d）【已落地 · 2026-06-10】

**交付**：规则存读 + 引擎单测；尚无聊天挂钩。

**新增**：

- `server/src/regex-rules-types.ts`
- `server/src/regex-rules-file.ts`
- `server/src/regex-apply.ts`
- `server/src/regex-apply.test.ts`

**API**：

- `GET /api/regex-rules`
- `PUT /api/regex-rules`（整包校验写盘）
- `POST /api/regex/apply-text`（无写盘；测试串 / display / `host.regex` 预览）

**PUT 校验**：`pattern` 非空；`new RegExp(pattern, flags)`；枚举合法；新建 `id` + `order = max + 10`。

#### Phase 1 · outgoing（~1–1.5d）【已落地 · 2026-06-10】

- `buildConversationOutboundMessages`：trim 后 `loadAndApplyRegexOutgoing`（`regex-outgoing.ts`）
- `assemble-messages` 经同一函数受益；无 enabled outgoing 规则时 fast path
- regex 后重算 `estimatedTokens`；顺序在 `afterAssemblePrompts` 之前

#### Phase 2 · persist + SSE（~1.5–2d）

- `persistTurnAfterModelReply` 入口 apply persist
- 扩展 `ChatPersistResult` / `ChatPersistPayload` 的 `final*` 字段
- 流式与非流式 persist 均回传 final；前端 finalize 优先用 final*

#### Phase 3 · 历史批量（~1.5d）

```text
POST /api/chat/conversations/:id/regex/apply
  { dryRun, fromOrdinal?, toOrdinal?, ruleIds?: 'all' | string[] }
```

- `readTurnsInOrdinalRange` → apply → `batchUpdateConversationTurns`
- 写锁（与 backup 等维护锁互斥）
- **单测**：2 chunk × 3 规则 → 写盘次数 = chunk 数
- Memory：v1 批量后**不**自动 re-embed（Toast 提示可选手动重建）

#### Phase 4 · 系统设置 UI（~2d）

- `RegexRulesSettingsPanel.vue`（拖曳参考 `BudgetTrimSettingsPanel.vue`）
- `SettingsView` **新增 Tab「正则替换」**（非对话设置侧栏）
- `web/src/stores/regex-rules.ts`；locales
- **不做**：`ConversationContextSettings` / 会话 `index.json` regex 字段

#### Phase 5 · display + 宿主 API（~1.5–2d）

- display：`POST /api/regex/apply-text` 或 composable + 规则缓存
- `host.regex` / `api.regex`（`listRules` / `applyText` / `applyMessages`）
- `conversation-export` 导出勾选全局规则（可选同期）

#### Phase 6 · 文档收尾（~0.5d）

- 更新 §2.8 勾选、`DOC/04`、`DOC/03` §16、`data/README.md` 路径

### 6.4 依赖顺序

```text
Phase 0 → 1 → 2 → 3
              ↘
         Phase 4（可与 1–2 并行 UI 壳，联调需 0–2）
              → 5 → 6
```

**最小演示 slice**：0 → 1 → 2 → 4（一条 tracker 规则端到端）。

### 6.5 风险与决策

| 项 | 定案 |
|----|------|
| 无效正则 | PUT 硬校验；runtime 单条 skip + warn |
| ReDoS | P0：pattern 长度上限；timeout 可 P1+ |
| 对话级配置 | **不做**；全局 `regex-rules.json` + enabled 即全对话生效 |
| 规则管理入口 | **仅**系统设置 Tab；对话页仅批量 **操作** |
| Memory  stale | 批量 persist 后 v1 手动重建索引 |
| audit `messages` | = regex + `afterAssemblePrompts` 后、upstream 前（当前 `built.messages` 语义） |

### 6.6 工作量粗估

| Phase | 人天 |
|-------|------|
| 0 | 1 |
| 1 | 1–1.5 |
| 2 | 1.5–2 |
| 3 | 1.5 |
| 4 | 2 |
| 5 | 1.5–2 |
| 6 | 0.5 |
| **合计** | **~9–10.5** |
