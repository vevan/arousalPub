# 插件二次 LLM：上下文块与 Prompt 组装 — 设计定案

> **状态**：**Phase 1–2 已落地**（2026-07）；Historian 已迁单一路径；Phase 3（trace-keeper）待做。  
> **关联**：`DOC/11` 出站补全 · `DOC/12` Historian · `DOC/18` §3.8 · `DOC/38`（沙箱 / chat 注入为**另一条管线**）

---

## 1. 问题

插件二次模型调用（摘要、Separate 补生成、sidecar 刷新等）需要：

1. **向宿主索取上下文**（对话 transcript、已有摘要、sidecar、显示名…）
2. **提交本插件的 prompt 模板**
3. **由宿主拼成 `messages[]`** → 展宏 → token preflight → `complete`

### 1.1 Historian 已落地路径

| 步骤 | 实现 | 说明 |
|------|------|------|
| 选条 + 声明 blocks | 插件 `prepare-context.ts` / `plot-summary-context-blocks.ts` | 插件算 `entryIds`、拼 `ContextBlockSpec[]` |
| 读盘取块 | 宿主 `plugin-context-blocks-resolve.ts` | transcript + `lorebook.entries`；统一 outgoing regex |
| 格式化为 layout 块 | 插件 hook `formatPluginContextBlocks` | XML：`<previous-summaries>` / `<sidecars>` / `<history>` |
| 拼 messages | 宿主 `plugin-assemble-prompt.ts` | `PLOT_SUMMARY_COMPLETE_LAYOUT` + 展宏 + preflight |
| 出站 + 解析 draft | 宿主 `plugin-complete-with-context.ts` + hook `parseCompleteDraftContent` | JSON → `[MEMO-n]` 标题等 normalize |

**已移除 legacy**：Historian 专用 `plugin-prepare-context.ts`、`POST …/complete-draft`、`host.plugin.prepareContext`（旧字段）、`host.plugin.completeDraft`、`completeDraft` server hook、`buildSummaryCompleteMessages`。

其它插件（如 trace-keeper Separate）仍自读 tail + 自拼 messages，**Phase 3** 迁 shared layout。

### 1.2 目标（仍有效）

**声明式**：插件说明「要什么块 + 怎么排进 messages」；宿主读盘、拼 prompt、出站。与 `DOC/38` §3（`/api/chat` outgoing 注入）**正交**。

**管线定案**：**强制两步** — 取块 → 拼 prompt；Web 插件**只**经 Server 代理，不直读盘。Worker 可只调 **`completeWithContext`** 一键入口。

---

## 2. 与已有 API 的关系

```text
/api/chat 主对话
  assemble → trim → regex → afterAssemblePrompts（DOC/38）
  → upstream

插件二次 LLM（本节 · 已落地）
  prepareContextBlocks（步骤 1 · blocks[]）
    → assemblePluginPrompt（步骤 2 · layout）
    → macro → preflight → complete
  → 无 turn 落盘（除非插件另调 lorebook / patch）

沙箱 / 便捷路径
  completeWithContext（单入口 · 内部 resolve API → assemble → complete）
  dryRun: true → 仅拼 messages + 可选 preflight，不出站
```

| API | 管线 | 说明 |
|-----|------|------|
| `host.chat.sendWithPlugins` | 主对话 | 走完整 assemble |
| `host.plugin.complete` | 二次 LLM | 仅转发已有 `messages[]` |
| **`host.plugin.prepareContextBlocks`** | 步骤 1 | 提交 `ContextBlockSpec[]` → `blocks` / `entriesByBlock` / `meta` |
| **`host.plugin.assemblePluginPrompt`** | 步骤 2 | blocks + layout → `messages[]`；须显式 `anchorToTurn` |
| **`host.plugin.completeWithContext`** | 二次 LLM **主入口** | resolve API → 步骤 1+2 → complete；可选 `draft` 由插件 hook 解析 |
| `host.token.preflightComplete` | 辅助 | 预览等场景单独估算 token |

> Web 侧：`prepareContextBlocks` / `assemblePluginPrompt` / `completeWithContext` **均 proxy 至 Server**（`DOC/18`）。  
> HTTP 路由 **`POST …/prepare-context`** 与步骤 1 同名；**仅接受 `blocks[]`**（无 blocks 返回 400）。

---

## 3. 规划模型（两层 + 一键封装）

### 3.1 层 A — `prepareContextBlocks`（取块 · 步骤 1）

```ts
// 请求
{ conversationId: string; blocks: ContextBlockSpec[] }

// 响应
{
  ok: true
  blocks: Record<string, string>
  entriesByBlock: Record<string, LorebookEntrySlice[]>
  meta: { userDisplayName, assistantDisplayName, turnCount? }
}
```

**块过大（D2）**：宿主**不裁切**；preflight 超限 **fail + 明确错误码**（含 `promptTokens` / `budget`）。

**块来源 catalog**：

| `source` | 说明 | 权限 |
|----------|------|------|
| `conversation.transcript` | 轮次区间；宿主统一 outgoing regex | `conversation.read` |
| `conversation.transcript.tail` | 最近 N 轮 | 同上 |
| `lorebook.entries` | `lorebookId` + `entryIds[]` | `lorebook.read` |

**lore 读盘降级**：`lorebook.entries` 在资料库缺失时返回**空块**（不阻断同次请求中的 transcript 块），与旧 Historian prepare 行为一致。

**宏锚点（D3）**：`assemblePluginPrompt` / `completeWithContext` 须显式 **`anchorToTurn`**；宿主不设默认。

Historian 块组合（插件侧 `buildPlotSummaryContextBlockSpecs`）：

- `prevSummaries` / `sidecars` ← 插件选 id → `lorebook.entries`
- `historyRaw` ← `conversation.transcript` → format 为 `<history>`

### 3.2 层 B — `assemblePluginPrompt`（拼接 · 步骤 2）

```ts
{
  conversationId: string
  blocks: Record<string, string>
  layout: PromptLayout
  pluginSettings?: Record<string, unknown>
  anchorToTurn: number
  apiConfigId?: string
  dryRun?: boolean
}
```

**layout**：插件 **shared 常量**（Historian：`PLOT_SUMMARY_COMPLETE_LAYOUT`）或请求体覆盖。

宿主 pipeline：填占位 → 跳过空 content 槽位 → 展宏 → preflight（有 `apiConfigId` 时）→ `messages[]`。

**Historian layout**：

```text
system: {{blocks.reference}}   // previous-summaries + sidecars
user:   {{blocks.history}}
system: {{plugin.systemPromptTemplate}}
```

### 3.3 层 C — `completeWithContext`（主入口 · D7）

```ts
host.plugin.completeWithContext({
  apiConfigId?,
  blocks: ContextBlockSpec[],
  layout: PromptLayout,
  pluginSettings?,
  anchorToTurn,
  responseFormat?: 'json_object' | 'text',
  dryRun?: boolean,
  draft?: { kind, fromTurn?, toTurn?, blockTurns?, sidecarName? },
})
```

- 宿主顺序：**resolve API** → `formatPluginContextBlocks` hook → assemble（含 preflight）→ complete → `parseCompleteDraftContent` hook（若传 `draft`）。
- **无 preset**（D5）。
- **Prompt 预览**（D8）：Historian `prompt-preview.ts` 调 `completeWithContext({ dryRun: true })`；不进 `chat-audit.json`。

---

## 4. 与 Historian / trace-keeper 映射

| 插件 | 步骤 1 | 步骤 2 | 出站 |
|------|--------|--------|------|
| **plot-summary** | ✅ 插件选条 + `prepareContextBlocks` | ✅ `PLOT_SUMMARY_COMPLETE_LAYOUT` | ✅ `completeWithContext` |
| **trace-keeper** Separate | 规划：`transcript.tail` | 规划：shared layout | 仍 `regenerateSeparateState` |

---

## 5. 设计定案（D1–D9）

| # | 主题 | 定案 |
|---|------|------|
| D1 | layout 存放 | shared 常量 + 请求体可覆盖 |
| D2 | 块过大 | 仅提示并中断；宿主不裁切 |
| D3 | 宏锚点 | `anchorToTurn` 无默认 |
| D4 | regex | `conversation.transcript*` 由宿主统一应用 |
| D5 | preset | 不要 preset |
| D6 | API 形态 | `prepareContextBlocks` + `assemblePluginPrompt`；强制两步 RPC |
| D7 | 沙箱 | `completeWithContext` 单入口 |
| D8 | 审计 | 插件二次 LLM 不进 chat-audit；dry run 预览 |
| D9 | lore 块形态 | `entriesByBlock` 含 title；XML 在插件 shared |

---

## 6. 实现分期

### Phase 1 — 抽块 ✅

- [x] `shared/plugin-context-blocks.ts` 契约
- [x] `plugin-context-blocks-resolve.ts` + `POST …/prepare-context`（仅 `blocks[]`）
- [x] Historian：`prepare-context.ts` + `plot-summary-context-blocks.ts`
- [x] 移除 Historian 专用 `plugin-prepare-context.ts` 与旧 prepare 请求体

### Phase 2 — 拼 prompt + 出站 ✅

- [x] `plugin-assemble-prompt.ts` + `POST …/assemble-plugin-prompt`
- [x] `plugin-complete-with-context.ts` + `POST …/complete-with-context`
- [x] Historian `review.ts` → `completeWithContext`；`prompt-preview.ts` → `dryRun`
- [x] Server hooks：`formatPluginContextBlocks` / `parseCompleteDraftContent`（`complete-context-hooks.ts`）
- [x] 移除 `complete-draft` 路由与 `completeDraft` hook

### Phase 3 — 其它消费者

- [ ] trace-keeper Separate 迁 `transcript.tail` + shared layout

---

## 7. 代码索引

| 路径 | 说明 |
|------|------|
| `shared/plugin-context-blocks.ts` | 契约（同步至 server/web `src/shared/`） |
| `server/src/plugin-context-blocks-resolve.ts` | 步骤 1 宿主实现 |
| `server/src/plugin-assemble-prompt.ts` | 步骤 2 |
| `server/src/plugin-complete-with-context.ts` | 一键管线 |
| `server/src/plugin-summarize-format.ts` | transcript + outgoing regex |
| `plugins/plot-summary/src/prepare-context.ts` | Historian 步骤 1 编排 |
| `plugins/plot-summary/src/shared/plot-summary-context-blocks.ts` | 选条 + XML format |
| `plugins/plot-summary/src/shared/summary-prompt-layout.ts` | `PLOT_SUMMARY_COMPLETE_LAYOUT` |
| `plugins/plot-summary/src/server/complete-context-hooks.ts` | format / parse hooks |
| `plugins/trace-keeper/src/server/separate-regenerate.ts` | 仍自拼 messages（Phase 3） |
| `DOC/12` §5 | Historian 摘要上下文行为 |
| `DOC/18` §3.8 | Web 宿主 API |

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：问题、两层模型、Historian/trace 映射、D1–D9、分期 |
| 2026-07-07 | lore catalog、`entriesByBlock`、两步 API、completeWithContext 定案 |
| 2026-07-07 | **Phase 1–2 落地**；Historian 迁单路径；移除 legacy prepareContext/completeDraft；更新代码索引 |
