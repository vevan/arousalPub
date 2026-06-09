# 正则替换（原生）与会话审计（debug）

> **状态**：**定案，未实现**（2026-06-08）。列入 **`DOC/04` P0**。  
> **关联**：`DOC/03` §6.8、`DOC/10`、`DOC/18`、`DOC/02` §4 可观测性。

---

## 1. 背景

- 原规划 **`regex-transform` 插件** + **`host.capabilities`** 试点（`DOC/09` §8.7、`DOC/10` §6.3）**废止**；正则改为**宿主原生能力**。
- 可观测性：`DOC/02` §4 要求 RAG/调用命中明细；定案为 **仅 debug 开启时**写入会话级 **`chat-audit.json`**（合并原 `chat-prompt.json` 职责并扩展），**不**膨胀 chunk。

---

## 2. 正则替换（原生）

### 2.1 存储

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
| `order` | 整数，**越小越先执行**；设置页**拖曳**调整顺序后写回（debounce **1 次**写文件） |
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

- **系统设置**：规则列表 + 编辑器 + 测试串；**`mdi-drag-vertical` 拖曳排序**（对齐 `BudgetTrimSettingsPanel` / `PluginSettingsPanel` 原生 drag）。
- **对话页**：composer 工具栏 — 历史批量 apply（区间、dry-run、写锁）；导出对话框可选规则（display/outgoing 只读链）。
- **废止**：`regex-transform` 插件、`DOC/09` §8.7 以 regex 为 capabilities 试点。

### 2.8 实现清单

- [ ] `regex-rules.json` + `GET/PUT /api/regex-rules`
- [ ] `server/src/regex-apply.ts` 引擎 + `skipLastNTurns` / `order`
- [ ] `/api/chat` outgoing + persist 挂钩；SSE persist  payload 含最终正文
- [ ] `POST .../regex/apply`（dry-run / batchUpdateConversationTurns）
- [ ] Web 设置页拖曳 + 对话批量 UI；export 联动
- [ ] `host.regex` + server hook `api.regex`
- [ ] 写盘合并单测；流式落盘后 UI 单测/E2E

---

## 3. 会话审计（debug only）

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
