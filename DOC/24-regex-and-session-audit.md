# 正则替换（原生）与会话审计（debug）

> **状态**（2026-06-12）：**§3 会话 debug 审计已实现**（含 **schema v3 性能** Tab）；**§2 正则替换 Phase 0–5 已落地**（含 **memory 块逐轮 outgoing**、**对话页批量 apply UI** · `ConversationRegexApplyPanel`）。  
> **关联**：`DOC/03` §6.8、§审计、`DOC/10`、`DOC/18`、`DOC/02` §4 可观测性。

---

## 1. 背景

- 原规划 **`regex-transform` 插件** + **`host.capabilities`** 试点（`DOC/09` §8.7、`DOC/10` §6.3）**废止**；正则改为**宿主原生能力**。
- 可观测性：`DOC/02` §4 要求 RAG/调用命中明细；定案为 **仅 debug 开启时**写入会话级 **`chat-audit.json`**（合并原 `chat-prompt.json` 职责并扩展），**不**膨胀 chunk。

---

## 2. 正则替换（原生）【定案 · Phase 0–5 已落地 · 2026-06-10】

> 列入 P0（**批量 apply UI 已于 2026-06-12 验收**）；实现清单见 §2.8。后端引擎、`GET/PUT /api/regex-rules`、三阶段挂钩、系统设置 UI、对话设置「正则批量」、`host.regex` 已落地；**未做**：`conversation-export` 导出勾选。

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
      "phases": ["display"],
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
| `replacement` | 传入 `String.prototype.replace` 第二参数；**真实换行**有效；字面量 `\n` **不**作 C 转义；支持 `$&` / `$1` / `$$` 等 JS 替换语法 |

新建规则：`order = max(existing.order) + 10`；**默认 `phases: ['display']` only**（Web `createDefaultRegexRule` + 种子「规范省略号」），避免新建即影响 outgoing/persist。

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

**无 `turnOrdinal` 的整段 system**（恒定 lore / world 等单条 system 消息）：不受 `skipLastNTurns` 限制；规则含 `system` + `outgoing` 即作用于整条 `content`。

**`<memory>` 块（向量召回）**（2026-06-10 增补）：

- 注入形态为 **一条** `role: system`，正文为 `<memory>…</memory>`（见 `turn-memory-xml.ts`）。
- **不得**把整段 memory XML 当作无 ordinal 的 system 处理 `skipLastNTurns`；须在 outgoing 前对块内各 `<turn ordinal="N">` 的 **`<user>` / `<assistant>` 正文**按 `turnOrdinal` 分别应用规则（与 history 中 user/assistant 同语义）。
- 实现：`regex-outgoing.ts` — `applyOutgoingRegexToMemoryItems` ← `chat-assemble` 传入 budget trim 后的 `memoryItems` → `formatMemoryXml` → 替换 messages 中 `<memory>` system 消息 → 再走整包 `applyRegexRulesToMessages`（history / 尾部 user 等）。
- 正文写入 XML 前经 `prepareXmlElementText` 转义；outgoing 正则前对 turn 正文做 `normalizeXmlTextBeforeProcessing`（与 `prompt-xml.ts` 一致，最多 3 轮实体还原），避免磁盘误存 `&lt;tag&gt;` 时 pattern 匹配失败。
- **审计展示**：memory 段内 tracker 等标签在 `messages` 中常以 `&lt;…&gt;` 显示，为 **合法 XML 转义**；skip 窗口外老轮剥除成功后应无 `ex-tracker`（实体或明文均无）。history 近 N 轮 assistant 在 skip 窗口内可仍保留明文 `<ex-tracker>`。

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
| `outgoing` | 可归属 `turnOrdinal` 的片段：`ordinal ≤ skipTail − N`（`skipTail = tailOrdinal − 1`；尾部待生成轮次的 assistant 不在 prompt 中，不占 skip 窗口） |
| `persist` | 当前落盘轮：`currentOrdinal ≤ tailOrdinal − N` |
| `persist`（落盘回溯） | 主落盘成功后，对 `tail − N` 等 retro 轮批量写盘；失败写入 `index.retroPersistPending` 下次重试，**不阻塞**主落盘 |
| `display` | 渲染轮：`turnOrdinal ≤ tailOrdinal − N` |

典型 **tracker**（如 **迹录** `<ex-trace-keeper>`，见 **`DOC/30`**）：`phases: ["outgoing","persist"]`，`skipLastNTurns: 3` — 近 3 轮保留跟踪标记给模型与磁盘，更早轮在 outgoing/persist 剥除。

### 2.4 流式与落盘后 UI

```text
流式中     → UI 显示上游原文
落盘完成   → 服务端 persist 阶段处理 → 写入 chunk
           → retro：对刚出 skip 窗口的历史轮回溯 persist（batch 写盘）
persist 事件 → 前端用服务端返回的最终正文更新该轮（含 retro[] 历史轮 patch）
之后渲染   → 以磁盘为底；再叠 display 阶段（含 skipLastNTurns）
```

- 仅 **persist**、无 **display**：落盘后 UI 仍立刻变干净（显示 persist 后磁盘内容）。
- 仅 **display**：落盘后磁盘可为原文，UI **立刻**跑 display 管道。
- 再生 / PATCH 写盘：同链路。

### 2.5 写盘粒度（硬性验收）

| 场景 | 定案 |
|------|------|
| 单轮聊天 `persist` | 全部命中规则内存串联后 **`persistTurnAfterModelReply` 写 1 次** |
| 历史批量 | `read` → `applyRulesToTurns(全部 ruleIds)` → **`batchUpdateConversationTurns` 一次提交**；**每个 chunk 文件至多 1 读 1 写** |
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

> **产品定案（2026-06-10，批量 UI 2026-06-12）**：正则**仅系统设置**入口**编辑**规则；会话 `index.json` **不存** regex 开关/规则子集。对话设置内提供 **「正则批量」** Tab（`ConversationRegexApplyPanel`）：只读勾选 Persist 规则、轮次区间、dry-run / apply，**非**规则 CRUD。所有 enabled 规则对用户下**全部对话**生效；`skipLastNTurns` 等按轮次语义在引擎内处理。

| 位置 | 内容 | 是否「设置」 |
|------|------|-------------|
| **系统设置** `/settings` | 规则 CRUD、拖曳 `order`、测试串、enabled 开关 | ✅ **唯一规则管理入口** |
| **对话设置** →「正则批量」 | 历史批量 apply（区间、规则只读勾选、dry-run / apply） | 否（动作入口） |
| **导出**（`conversation-export`） | 导出对话框勾选**全局**规则子集（display/outgoing 只读链） | 否（一次性导出选项） |

- **系统设置**：Tab「正则替换」— 规则列表 + 编辑器 + 测试串；**`mdi-drag-vertical` 拖曳排序**；debounce **1 次** PUT；**replacement** 为多行 **textarea**。
- **对话设置**：Tab「正则批量」— 不提供规则编辑；仅批量 apply（`POST .../regex/apply`）。
- **废止**：`regex-transform` 插件、`DOC/09` §8.7 以 regex 为 capabilities 试点。

### 2.8 实现清单

- [x] `regex-rules.json` + `GET/PUT /api/regex-rules`
- [x] `server/src/regex-apply.ts` 引擎 + `skipLastNTurns` / `order`（Phase 0 · 2026-06-10）
- [x] `POST /api/regex/apply-text`（无写盘预览 / `host.regex` 前置）
- [x] `/api/chat` **outgoing** 挂钩（`chat-assemble.ts` · Phase 1 · 2026-06-10）
- [x] **memory 块逐轮 outgoing** + XML 实体还原（`regex-outgoing.ts` · 2026-06-10）
- [x] `/api/chat` **persist** 挂钩 + SSE `final*`（Phase 2 · 2026-06-10）
- [x] `POST /api/chat/conversations/:id/regex/apply`（dry-run / batchUpdateConversationTurns · Phase 3 · 2026-06-10）
- [x] Web 设置页（Tab「正则替换」、拖曳 order、单条测试串、管线测试 · Phase 4 · 2026-06-10）
- [x] 对话页批量 apply UI（`ConversationRegexApplyPanel` · `POST .../regex/apply` dry-run / apply）
- [x] `conversation-export` 导出勾选全局规则（Phase 5 · 2026-06-10）
- [x] `host.regex` + server hook `api.regex`（Phase 5 · 2026-06-10）
- [x] 写盘合并单测（`regex-persist*.test.ts`、`regex-batch-apply.test.ts` 等）
- [ ] 流式落盘后 UI E2E（可选）

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
  "schemaVersion": 3,
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
        "budgetTrim": { "maxTokens": 8192 },
        "plugins": {
          "tokenReserve": 512,
          "items": [{ "pluginId": "trace-keeper", "tokens": 384 }]
        }
      },
      "calls": [
        { "kind": "chat", "apiConfigId": "…", "model": "…", "latencyMs": 1200, "usage": {} },
        { "kind": "embedding", "purpose": "memory_recall", "latencyMs": 45 }
      ],
      "performance": {
        "assemblyMs": {
          "total": 120,
          "memory": 40,
          "characters": 5,
          "lore": 30,
          "assembleAndTrim": 35,
          "regexOutgoing": 2,
          "pluginsAfterAssemble": 1
        },
        "preUpstreamMs": 3,
        "upstreamMs": {
          "toResponseHeaders": 800,
          "toFirstToken": 850,
          "firstTokenToLastToken": 12000,
          "total": 12850,
          "tps": 42,
          "tpsTokenSource": "upstream",
          "tpsTokenCount": 504
        },
        "persistMs": { "regex": 1, "diskAndAudit": 8, "total": 12 },
        "stream": {
          "contentChars": 1200,
          "reasoningChars": 0,
          "completionTokensUpstream": 504
        }
      }
    }
  ]
}
```

- **`messages`**：outgoing 最终态（**regex outgoing 之后**、`afterAssemblePrompts` 之后、upstream 之前）；**服务端自写**，不再依赖前端 `debugPrompt`。
- **`assembly` / `calls` / `performance`**：仅 **`auditDebug.enabled`** 时计算并写入；**不进** chunk `turn.send` / `receive.runtime`（`runtime` 仍保留轻量 model/duration/tokens）。
- **`performance`**（schema **v3**）：`assemblyMs` 分段（memory / characters / lore / assembleAndTrim / regexOutgoing / pluginsAfterAssemble）、`preUpstreamMs`、流式 `upstreamMs`（TTFB、首→末 token TPS）、`persistMs`、`stream` 字符/ token 统计；**debug 关闭时零开销**（不跑计时、不落盘该字段）。
- **`assembly.plugins`**（2026-06）：`afterAssemblePrompts` / `resolveAfterAssemblePromptsAddition` 注入的 **不可 trim** token 预留与各插件分项；`ChatTurnPromptDialog` 组装 Tab 展示。与 audit 顶层预留的 `entries[].plugins[]`（出站元数据）**不同**。
- **`calls[].plugin.complete` / `entries[].plugins[]`**：schema **预留**（见 §3.6）；Separate 等异步 `plugin.complete` **当前不写入** audit。

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
- [x] 轮次审计 UI 四 Tab（提示词 / 组装 / 调用 / **性能** · `ChatTurnPromptDialog`）
- [x] **`performance` 审计**（schema v3 · `chat-audit-performance.ts` · 2026-06-10）
- [x] **`assembly.plugins`** 插件注入 token 审计（`build-assembly-audit.ts` · 2026-06）
- [ ] 客户端「按下发送」计时（`clientTimings`，可选）

### 3.6 插件与审计范围（2026-06-08 定案）

**P0 结论**：当前**没有**必须在 `chat-audit.json` 每轮条目里记录的插件出站 LLM。

| 插件 | 与本轮 audit 的关系 |
|------|---------------------|
| **guidance-generate** | 组装阶段注入 system；已体现在 **`messages`** + 主 **`chat`** `calls[]` |
| **trace-keeper** | 组装阶段注入 tracker system；token 计入 **`assembly.plugins`**；Together 落盘在 **`turn.plugins[]`**（非 audit `plugins[]`）；Separate 为独立 API，不进本轮 sync audit |
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

#### Phase 2 · persist + SSE（~1.5–2d）【已落地 · 2026-06-10】

- `persistTurnAfterModelReply` 写盘前 `loadAndApplyRegexPersistForTurn`
- `ChatPersistResult` / `ChatPersistPayload` 扩展 `finalUserText` / `finalAssistantContent` / `finalAssistantReasoning`
- 流式与非流式 `arousal.persist` / JSON `persist` 均回传 final
- Web：`persist-display.ts`；有 final 时跳过 `loadMessages()`（fallback 仍保留）

#### Phase 3 · 历史批量（~1.5d）【已落地 · 2026-06-10】

```text
POST /api/chat/conversations/:id/regex/apply
  { dryRun, fromOrdinal?, toOrdinal?, ruleIds?: 'all' | string[] }
```

- `readTurnsInOrdinalRange` → persist apply → `batchUpdateConversationTurns`
- 维护写锁由全局 `maintenance-guard` 覆盖（backup 等 503）
- 单测：多规则仅产出按轮 patch 列表（写盘次数 ∝ chunk 数，由 `batchUpdateConversationTurns` 保证）
- Memory：批量写盘成功且会话 memory 开启 + Embeddings 已配置时，对可 embed 轮 `scheduleMemoryIndexUpsert`；响应 `memoryEmbedsQueued`
- Regex 执行：服务端 VM 250ms，超时/错误**整条链回退原文**（persist/outgoing）；**display** 仅跳过失败规则（不落盘，可部分展示）
- Regex 编译：`replaceRegexWithTimeout` 主线程编译一次后传入 VM 执行

#### Phase 4 · 系统设置 UI（~2d）✅ 2026-06-10

- `RegexRulesSettingsPanel.vue`（拖曳对齐 `PluginSettingsPanel`；管线纯文本测试）
- `SettingsView` **新增 Tab「正则替换」**
- `web/src/stores/regex-rules.ts`；locales
- **不做**：`ConversationContextSettings` / 会话 `index.json` regex 字段

#### Phase 5 · display + 宿主 API（~1.5–2d）✅ 主体 2026-06-10

- display：`use-regex-display-text` + `regex-rules-display` 缓存（Phase 2 起）
- `host.regex` / `api.regex`（`listRules` / `applyText` / `applyMessages`）
- [x] `conversation-export` 导出勾选全局规则（2026-06-10）

#### Phase 6 · 文档收尾（~0.5d）✅ 2026-06-10

- 更新 §2.8 勾选、`DOC/04`、`DOC/03` §16、`cursor.md`

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
