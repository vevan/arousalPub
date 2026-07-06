# 插件二次 LLM：上下文块与 Prompt 组装 — 设计定案（规划）

> **状态**：**规划 · 细节待讨论补充**（2026-07）。  
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
| 读 turn / lore、拼 XML 块 | 宿主 `prepareContext`（`plugin-prepare-context.ts`） | **Historian 专用**，逻辑 import `plot-summary/prepare-context-blocks.ts` |
| 拼 messages 布局 | 插件 `buildSummaryCompleteMessages` | 每插件重复；沙箱内插件需自己持整段文本 |
| 展宏 / preflight / complete | 插件 `completeDraft` hook | 可下沉宿主统一 pipeline |
| 裸 `complete` | 宿主转发 | 灵活但**不帮取数、不帮拼** |

其它插件（如 trace-keeper Separate）自行 `readConversationTurnsTail` + 插件内拼 messages，**未复用** prepareContext 能力。

### 1.2 目标

**声明式**：插件说明「要什么块 + 怎么排进 messages」；宿主读盘、拼 prompt、出站。与 `DOC/38` §3（`/api/chat` outgoing 注入）**正交**。

---

## 2. 与已有 API 的关系

```text
/api/chat 主对话
  assemble → trim → regex → afterAssemblePrompts（DOC/38）
  → upstream

插件二次 LLM（本节）
  resolveContextBlocks? → assemblePluginPrompt? → macro → preflight → complete
  → 无 turn 落盘（除非插件另调 lorebook / patch）
```

| API | 管线 | 说明 |
|-----|------|------|
| `host.chat.sendWithPlugins` | 主对话 | 走完整 assemble |
| `host.plugin.complete` | 二次 LLM | 仅转发已有 `messages[]` |
| `host.plugin.prepareContext` | 二次 LLM（Historian） | 返回两大字符串；**待泛化** |
| `host.plugin.completeDraft` | 二次 LLM（Historian） | hook 内拼 messages + complete + 解析 JSON |
| **规划** `resolveContextBlocks` | 二次 LLM | 按 spec 取命名块 |
| **规划** `assemblePluginPrompt` / `completeWithContext` | 二次 LLM | 块 + layout → messages → complete |

---

## 3. 规划模型（两层）

### 3.1 层 A — `resolveContextBlocks`（取数）

插件（或 Web）提交 **context spec**，宿主返回 **命名文本块** + 元数据：

```ts
// 请求（示意 · 字段待细化）
{
  conversationId: string
  blocks: ContextBlockSpec[]
}

// 响应
{
  ok: true
  blocks: Record<string, string>   // blockId → 已格式化正文
  meta: {
    turnCount?: number
    userDisplayName?: string
    assistantDisplayName?: string
    trimmed?: Record<string, boolean>  // 可选：某块是否被裁切
  }
}
```

**块来源 catalog（初稿 · 可扩展）**：

| `source` | 说明 | 权限 |
|----------|------|------|
| `conversation.transcript` | 轮次区间 user/assistant 明文（可 outgoing regex） | `conversation.read` |
| `conversation.transcript.tail` | 最近 N 轮（Separate 类） | 同上 |
| `lorebook.entries.summaries-before` | 目标 lore 内、某 turn 之前的摘要条目 | `lorebook.read` |
| `lorebook.entries.sidecars` | 指定 sidecar 条目 | 同上 |
| `lorebook.entries.by-ids` | 显式 entry id 列表 | 同上 |

Historian 今日 `prepareContext` 等价于固定组合：

- `prevSummaries` ← summaries-before  
- `sidecars` ← sidecars  
- `contextHistory` ← transcript（from 前窗口）  
- `history` ← transcript（摘要区间）

### 3.2 层 B — `assemblePluginPrompt`（拼接）

插件提交 **prompt layout**（messages 模板），占位引用块与插件 settings：

```ts
// 示意
{
  messages: [
    {
      role: 'system',
      content:
        '{{blocks.prevSummaries}}{{blocks.sidecars}}{{blocks.contextHistory}}',
    },
    { role: 'user', content: '{{blocks.history}}' },
    { role: 'system', content: '{{plugin.systemPromptTemplate}}' },
  ]
}
```

宿主 pipeline：

1. 解析 layout → 填入 blocks / settings 字段  
2. `applyPromptMacroPipeline`（`anchorToTurn` 等待定）  
3. `runPluginCompletePreflight`  
4. 可选：对 transcript 块应用 outgoing regex（Historian 已有 `regexRuleIds`）  
5. 输出 `messages[]`

**Historian 定案布局**（与现 `buildSummaryCompleteMessages` 一致）：

```text
system（参考：previous-summaries + sidecars + context-history）
→ user（<history> 待摘要区间）
→ system（摘要指令模板，置于最后）
```

### 3.3 层 C — 一键封装（可选）

```ts
host.plugin.completeWithContext({
  apiConfigId?,
  context: ContextBlockSpec[] | 'plot-summary.default',  // preset 名待定
  prompt: PromptLayout | 'plot-summary.default',
  responseFormat?: 'json_object' | 'text',
  anchorToTurn?: number,
})
```

Server：`completeDraft` hook **瘦化**为 JSON 解析 + 业务 normalize（标题 `[MEMO-n]` 等），**不再**自拼 messages。

---

## 4. 与 Historian / trace-keeper 映射

| 插件 | 规划 blocks | 规划 layout |
|------|-------------|-------------|
| **plot-summary** | summaries-before + sidecars + contextHistory + history | 参考 system → user history → 指令 system |
| **trace-keeper** Separate | transcript.tail（N 轮） | 插件 bundle 内 separate system + user/assistant 窗口（**待讨论**是否 manifest 声明） |

`prepareContext` / `completeDraft` **保留兼容**；实现时内部转 blocks + layout，文档标 deprecated。

---

## 5. 待讨论项（TODO · 文档）

| # | 主题 | 选项 / 备注 |
|---|------|-------------|
| D1 | layout 存放位置 | manifest `promptLayout` vs 插件 shared 常量 vs 仅请求体 |
| D2 | 块过大时的 trim | 宿主按 block 裁切策略；是否暴露 `maxTokens` per block |
| D3 | 宏锚点 | `anchorToTurn` 默认 `toTurn`；群聊 segment 是否单独 spec |
| D4 | regex | transcript 块是否统一走 `regexRuleIds`（Historian 已有） |
| D5 | preset 名 | `plot-summary.default` 是否硬编码在宿主 vs manifest 声明 |
| D6 | Web / Server 对称 | `host.plugin.resolveContextBlocks` + 路由命名 |
| D7 | 与沙箱 | Worker 只发 spec + layout；读盘仅在宿主（**`DOC/38`** Phase B 依赖本能力） |
| D8 | 审计 | 二次 LLM 是否写入 `chat-audit` / 插件专用 debug（Historian prompt 预览已有干跑） |

---

## 6. 实现分期（规划）

### Phase 1 — 抽块（P2）

- [ ] 定义 `ContextBlockSpec` 类型与 catalog 枚举  
- [ ] `resolveContextBlocks` 路由 + 宿主实现（从 `plugin-prepare-context.ts`  refactor）  
- [ ] `prepareContext` 改为调用 resolve；对外行为不变  

### Phase 2 — 拼 prompt（P2）

- [ ] `assemblePluginPrompt`（layout 模板 + 占位）  
- [ ] `completeWithContext` 或扩展 `complete` 请求体  
- [ ] Historian `completeDraft` 迁 layout；删插件内 duplicate 拼 message（保留 shared 测试）  

### Phase 3 — 其它消费者（P2/P3）

- [ ] trace-keeper Separate 迁 `transcript.tail` block  
- [ ] manifest 可选声明默认 `contextPreset` / `promptLayout`  

---

## 7. 代码索引（现状）

| 路径 | 说明 |
|------|------|
| `server/src/plugin-prepare-context.ts` | Historian 专用 prepare（**待泛化**） |
| `server/src/plot-summary/prepare-context-blocks.ts` | XML 块格式化 |
| `server/src/plugin-summarize-format.ts` | transcript + outgoing regex |
| `plugins/plot-summary/src/shared/build-summary-messages.ts` | messages 布局 |
| `plugins/plot-summary/src/server/complete-draft.ts` | 展宏 + complete + 解析 |
| `plugins/trace-keeper/src/server/separate-regenerate.ts` | 自读 tail + 自拼 messages |
| `DOC/11` §0.2 | `prepareContext` / `completeDraft` 产品定案 |
| `DOC/12` §5 | prepare-context 行为说明 |

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：问题、两层模型、Historian/trace 映射、待讨论 D1–D8、分期 |
