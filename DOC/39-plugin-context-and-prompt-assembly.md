# 插件二次 LLM：上下文块与 Prompt 组装 — 设计定案（规划）

> **状态**：**规划 · §5 定案已闭合**（2026-07）；实现待 Phase 1–3。  
> **关联**：`DOC/11` 出站补全 · `DOC/12` Historian · `DOC/18` §3.8 · `DOC/38`（沙箱 / chat 注入为**另一条管线**）· `server/src/plugin-prepare-context.ts`

---

## 1. 问题

插件二次模型调用（摘要、Separate 补生成、sidecar 刷新等）需要：

1. **向宿主索取上下文**（对话 transcript、已有摘要、sidecar、显示名…）
2. **提交本插件的 prompt 模板**
3. **由宿主拼成 `messages[]`** → 展宏 → token preflight → `complete`

### 1.1 现状（Historian 为例）

| 步骤 | 今天谁做 | 问题 |
|------|----------|------|
| 读 turn、拼 transcript | 宿主 `prepareContext`（`plugin-prepare-context.ts`） | transcript 可进 catalog；**lore 选条不应绑在宿主** |
| 读 lore、选条、拼 XML 块 | 同上（import `plot-summary/prepare-context-blocks.ts`） | **Historian 专用**；`pickRecentSummaryEntriesBeforeTurn` 等应回插件 shared |
| 拼 messages 布局 | 插件 `buildSummaryCompleteMessages` | 每插件重复；沙箱内插件需自己持整段文本 |
| 展宏 / preflight / complete | 插件 `completeDraft` hook | 可下沉宿主统一 pipeline |
| 裸 `complete` | 宿主转发 | 灵活但**不帮取数、不帮拼** |

其它插件（如 trace-keeper Separate）自行 `readConversationTurnsTail` + 插件内拼 messages，**未复用** prepareContext 能力。

### 1.2 目标

**声明式**：插件说明「要什么块 + 怎么排进 messages」；宿主读盘、拼 prompt、出站。与 `DOC/38` §3（`/api/chat` outgoing 注入）**正交**。

**管线定案**：**强制两步** — `prepareContext`（取块）→ `assemblePluginPrompt`（拼 messages）；Web 插件**只**经 Server 代理，不直读盘。

---

## 2. 与已有 API 的关系

```text
/api/chat 主对话
  assemble → trim → regex → afterAssemblePrompts（DOC/38）
  → upstream

插件二次 LLM（本节 · 定案）
  prepareContext（扩展 · 取块）
    → assemblePluginPrompt（拼 layout）
    → macro → preflight → complete
  → 无 turn 落盘（除非插件另调 lorebook / patch）

沙箱 / 便捷路径
  completeWithContext（单入口 · 内部两步 + complete；Worker 无感）
```

| API | 管线 | 说明 |
|-----|------|------|
| `host.chat.sendWithPlugins` | 主对话 | 走完整 assemble |
| `host.plugin.complete` | 二次 LLM | 仅转发已有 `messages[]` |
| **`host.plugin.prepareContext`（扩展）** | 二次 LLM **步骤 1** | 提交 `ContextBlockSpec[]` → 返回 blocks / entriesByBlock；Historian 旧请求体迁移期兼容 |
| **`host.plugin.assemblePluginPrompt`** | 二次 LLM **步骤 2** | blocks + layout → messages[]；**不可与步骤 1 合并为单次 RPC** |
| `host.plugin.completeDraft` | 二次 LLM（Historian） | 迁移后瘦化；现 hook 内拼 messages + complete |
| **`host.plugin.completeWithContext`** | 二次 LLM **沙箱主入口** | 宿主内串联 prepareContext + assemble + macro + preflight + complete；Worker 只调此 API |

> Web 侧：`prepareContext` / `assemblePluginPrompt` / `completeWithContext` **均 proxy 至 Server**（`DOC/18` 禁止浏览器直 fetch 读盘路由）。

---

## 3. 规划模型（两层 + 沙箱封装）

### 3.1 层 A — `prepareContext` 扩展（取块 · 步骤 1）

插件（Server / Worker 经 proxy）提交 **context spec**；宿主读盘并返回命名块：

```ts
// 请求（扩展 · Historian 旧字段迁移期仍接受）
{
  conversationId: string
  blocks: ContextBlockSpec[]
}

// 响应
{
  ok: true
  blocks: Record<string, string>                         // transcript 等已格式化正文
  entriesByBlock?: Record<string, LorebookEntrySlice[]>  // lorebook.entries；含 title + content
  meta: {
    turnCount?: number
    userDisplayName?: string
    assistantDisplayName?: string
  }
}
```

**块过大（D2 定案）**：宿主**不裁切**。preflight / token 超限时 **提示并中断**（明确错误码与文案），由用户缩小 interval、调 settings 或减 lore 条目。**不提供** per-block `maxTokens` 自动 trim。

**块来源 catalog（可扩展）**：

| `source` | 说明 | 权限 |
|----------|------|------|
| `conversation.transcript` | 轮次区间 user/assistant 明文；**宿主统一**应用 outgoing regex（见 §3.1.2） | `conversation.read` |
| `conversation.transcript.tail` | 最近 N 轮（Separate 类） | 同上 |
| `lorebook.entries` | 按 `lorebookId` + `entryIds[]` 读 **`id` / `title` / `content`**；见 §3.1.1 | `lorebook.read` |

> catalog **不含** Historian 语义块（summaries-before / sidecars 等）。选条、排序、XML 包裹均属**插件业务**。

#### 3.1.1 `lorebook.entries` — 取数 vs 选条

宿主只做**受权限保护的读盘与切片**；插件自行决定 `entryIds`：

```ts
{
  source: 'lorebook.entries'
  blockId: string
  lorebookId: string
  entryIds: string[]
  order?: 'as-listed' | 'lorebook-file'
  format?: 'plain' | 'title-content-lines'
}

type LorebookEntrySlice = { id: string; title: string; content: string }
```

**响应（D9 定案）**：默认返回 **`entriesByBlock[blockId]`**（含 `title`）；可选并行 `blocks[blockId]` 字符串。XML / 业务 format（`<previous-summaries>` 等）一律在**插件 shared** 完成。

#### 3.1.2 `conversation.transcript` — 正则（D4 定案）

对 `conversation.transcript` / `.tail` 块，**宿主统一**在 format 阶段应用 outgoing 正则：

- spec 可选 `regexRuleIds`、`regexApplyAllTurns`（与 Historian settings 字段对齐）
- 复用 `plugin-summarize-format.ts` / `loadSummarizeOutgoingRegexRules`
- 未传 `regexRuleIds` 的块：**不**应用 regex

#### 3.1.3 宏锚点（D3 定案）

- 调用方显式传 **`anchorToTurn`**（如 Historian 传 `toTurn`）；**宿主不设默认值**。
- **群聊**：同一 `turnOrdinal` 下多 bot 多 segment **仍计为一 turn**；不为 segment 单独扩展 spec / 默认锚点。宏与 transcript 按 turn 区间聚合即可。

Historian 迁移后等价块组合：

- `prevSummaries` / `sidecars` ← 插件算 id → `lorebook.entries`
- `contextHistory` / `history` ← `conversation.transcript`×2

### 3.2 层 B — `assemblePluginPrompt`（拼接 · 步骤 2）

插件提交 **prompt layout**（messages 模板），占位引用块与 settings：

```ts
{
  blocks: Record<string, string>       // 步骤 1 产出（含插件 format 后的 lore 块）
  layout: PromptLayout                 // 见 D1
  pluginSettings?: Record<string, unknown>
  anchorToTurn?: number                // 显式传入；无默认
}
```

**layout 存放（D1 定案）**：

- **默认**：插件 **shared 常量**（如 `buildSummaryCompleteMessages` / layout 对象）
- **可覆盖**：步骤 2 请求体传入完整 `layout`
- **不在** manifest 声明 `promptLayout`

宿主 pipeline：

1. 解析 layout → 填入 blocks / settings
2. `applyPromptMacroPipeline`（须传 `anchorToTurn`）
3. `runPluginCompletePreflight` — 超限则 **fail + 用户可见提示**
4. 输出 `messages[]`

**Historian 定案布局**（shared 常量，与现有一致）：

```text
system（previous-summaries + sidecars + context-history）
→ user（<history>）
→ system（摘要指令模板 · 最后）
```

### 3.3 层 C — `completeWithContext`（沙箱主入口 · D7 定案）

```ts
host.plugin.completeWithContext({
  apiConfigId?,
  blocks: ContextBlockSpec[],           // 步骤 1 spec
  layout: PromptLayout,                 // 步骤 2 layout（shared 或请求体）
  pluginSettings?,
  anchorToTurn?,                        // 显式；无默认
  responseFormat?: 'json_object' | 'text',
})
```

- **无 preset**（D5 定案）：不提供 `'plot-summary.default'` 等命名 bundle；调用方始终传完整 spec + layout。
- 宿主内部：prepareContext → assemblePluginPrompt → complete；**Worker 不感知**两步细节。
- **选条**可在 Worker（插件 shared）；**读盘**仅在 Host。
- Server：`completeDraft` hook **瘦化**为 JSON 解析 + 业务 normalize（`[MEMO-n]` 等）。

**Prompt 预览 / dry run（D8 定案）**：可调用步骤 1+2 **不写 audit、不出站**（Historian 现有 prepare-context 干跑延续）。插件二次 LLM **不写入** `chat-audit.json`；需要排查时靠预览即可。

---

## 4. 与 Historian / trace-keeper 映射

| 插件 | 步骤 1 blocks | 步骤 2 layout |
|------|---------------|---------------|
| **plot-summary** | 插件选条 → `lorebook.entries` + transcript×2 | shared 常量 · system → user → system |
| **trace-keeper** Separate | `transcript.tail` | shared 常量 · separate system + 窗口 |

Historian 旧 `prepareContext` 请求/响应 **迁移期兼容**；新实现走 spec + 两步 API。

---

## 5. 设计定案（D1–D9）

| # | 主题 | 定案 |
|---|------|------|
| D1 | layout 存放 | **shared 常量 + 请求体可覆盖**；manifest 不声明 |
| D2 | 块过大 | **仅提示并中断**；宿主不裁切；用户调 settings / 缩区间 |
| D3 | 宏锚点 | **`anchorToTurn` 无默认**；群聊多 bot 同一 turnOrdinal **仍算 1 turn**，不单独 segment spec |
| D4 | regex | **`conversation.transcript*` 由宿主统一应用** outgoing regex（spec 带 `regexRuleIds`） |
| D5 | preset | **不要 preset**；无 `'plot-summary.default'` 类命名 bundle |
| D6 | API 形态 | **扩展现有 `prepareContext`**（步骤 1）+ **`assemblePluginPrompt`**（步骤 2）；**强制两步**；Web 只走 Server |
| D7 | 沙箱 | **`completeWithContext` 单入口**；两步对 Worker 透明；选条在 Worker、读盘在 Host |
| D8 | 审计 | **插件二次 LLM 不进 chat-audit**；需要时用 dry run 预览 prompt |
| D9 | lore 块形态 | 默认 **`entriesByBlock`（含 title）**；XML format 在插件 shared |

---

## 6. 实现分期（规划）

### Phase 1 — 抽块（P0 · 与 [`DOC/04`](04-TODO.md) 对齐）

- [ ] 定义 `ContextBlockSpec` 与 catalog 枚举
- [ ] 扩展 `prepareContext` 路由 + 宿主实现（transcript + `lorebook.entries` + 统一 regex）
- [ ] 选条逻辑留在 plot-summary shared；从 `plugin-prepare-context.ts` 移出 Historian 专用 lore 逻辑
- [ ] Historian 旧 `prepareContext` 行为不变（内部转 spec 或兼容层）

### Phase 2 — 拼 prompt（P0）

- [ ] `assemblePluginPrompt` 路由 + 宿主 pipeline（macro · preflight · fail on exceed）
- [ ] `completeWithContext` 串联两步 + complete
- [ ] Historian `completeDraft` 迁 shared layout + 两步 / 或 `completeWithContext`；删 duplicate 拼 message

### Phase 3 — 其它消费者（P1/P2）

- [ ] trace-keeper Separate 迁 `transcript.tail` + shared layout
- [ ] dry run 预览 API 与 Historian Prompt 预览对齐（不进 audit）

---

## 7. 代码索引（现状）

| 路径 | 说明 |
|------|------|
| `server/src/plugin-prepare-context.ts` | Historian 专用 prepare（**待拆**：transcript 进 catalog，lore 选条回插件） |
| `server/src/plot-summary/prepare-context-blocks.ts` | XML 块格式化（**迁回**插件 shared） |
| `plugins/plot-summary/src/shared/lorebook-sort.ts` | 选条 / 排序（插件自管） |
| `server/src/plugin-summarize-format.ts` | transcript + outgoing regex（**统一**用于 transcript 块） |
| `plugins/plot-summary/src/shared/build-summary-messages.ts` | layout shared 常量 |
| `plugins/plot-summary/src/server/complete-draft.ts` | 展宏 + complete + 解析 |
| `plugins/trace-keeper/src/server/separate-regenerate.ts` | 自读 tail + 自拼 messages |
| `DOC/11` §0.2 | `prepareContext` / `completeDraft` 产品定案 |
| `DOC/12` §5 | prepare-context 行为说明 |

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：问题、两层模型、Historian/trace 映射、待讨论 D1–D8、分期 |
| 2026-07-07 | lore catalog 改为通用 `lorebook.entries`；选条归插件 |
| 2026-07-07 | `lorebook.entries` 含 `title` + `content` |
| 2026-07-07 | **D1–D9 定案闭合**：两步 API、无 preset、无 trim、无 audit、沙箱 completeWithContext |
| 2026-07-07 | §6 分期优先级与 **`DOC/04` P0** 对齐（Phase 1–2 → P0） |
