# Historian（plot-summary）

> **状态**：v1.6+ 可验收。插件 id **`plot-summary`**；展示名 Historian / 剧情纪要。旧 id `curated-memory` 启动迁移。  
> **关联**：`DOC/11` lorebook API、`DOC/09` 插件、`DOC/10` 对话 read、`DOC/24` 正则（摘要 outgoing）。

## 1. 语义

- **剧情纪要**：每块 N 轮 → 模型 `{ title, content, keywords }` → lore **新条目**；标题格式 **`[MEMO-n]-TITLE-[from-to]`**（`formatEntryTitle`，`plugins/plot-summary/src/shared/summarize.ts`）。
- **Sidecar**：固定条目，每次 **覆盖** content。
- **写入**：插件写 `targetLorebookId`；**注入**靠用户勾选对话 `lorebookIds`（插件不改绑定）。
- 与 **turn 向量 memory**（§14）互补。

## 2. 配置

**全局** `settings.json`：`blockTurns`（设置页 `triggerEveryNTurns`）、`bufferTurns`、`systemPromptTemplate`、`sidecars`、`targetLorebookMode`（manual|auto）、`autoLorebookNameTemplate`、`previousSummariesLimit`、`regexRuleIds`、`regexApplyAllTurns` 等。

**会话** `pluginSettings.plot-summary`：

| 字段 | 说明 |
|------|------|
| `autoSummarizeEnabled` | 自动块开关 |
| `nextBlockStart` / `lastSummarizedEnd` | 块指针（`nextBlockStart ≥ lastSummarizedEnd + 1`） |
| `targetLorebookId` | 写入目标书 |
| `blockTurns` / `bufferTurns` | 可覆盖全局 |
| `manualSummarizeTasks` / `autoSidecarIds` | 任务勾选 |
| `regexRuleIds` | 摘要前 outgoing 规则 id 列表 |
| `regexApplyAllTurns` | 为 true 时摘要区间**忽略**规则 `skipLastNTurns` |

## 3. 自动块

- 触发：`turnOrdinal >= nextBlockStart + blockTurns - 1 + bufferTurns`（`shouldAutoTrigger`）。
- 块区间：`[nextBlockStart, nextBlockStart + blockTurns - 1]`。
- 手动与自动共用 **预览确认**（`promptReview`）；跳过/中止 **不** 推进指针。
- **重新开启**（已有 `lastSummarizedEnd`）：静默续接，校正 `nextBlockStart`，不弹「按尾部重算区间」。
- **首次开启**（对话较短）：直接 `nextBlockStart: 0`；较长则弹窗区间 `[end-(blockTurns-1), end]`（`end = T - buffer`，与 §4 手动预填一致）并可选立即摘要。

## 4. 手动摘要

- 菜单「手动摘要」；区间 picker 两键选 start/end 优先。
- **默认预填**（无 picker）：`end = T - bufferTurns`，`start = max(0, end - (blockTurns - 1))`（T = 当前最大 turnOrdinal；与自动块等长）。
- 写盘：开关与指针分次 patch；摘要成功后再更新 `lastSummarizedEnd` / `nextBlockStart`。
- **Prompt 预览**：debug 审计开启时对话框第四按钮（`completeWithContext` · `dryRun: true`）。

### 4.2 条目标题与排序

**写入标题**（剧情纪要 lore 条目）：

```text
[MEMO-n]-TITLE-[from-to]
```

示例：`[MEMO-1]-冒险-[0-15]`。

| 段 | 规则 |
|----|------|
| `TITLE` | 模型 JSON `title`（重摘要时会剥掉旧格式后缀） |
| `[from-to]` | 摘要区间起止轮（0 起、含 end） |
| `MEMO-n` | 标题已是新格式则**保留**原 `n`；否则 `n = floor(fromTurn / blockTurns) + 1`（`completeWithContext` 的 `draft.blockTurns`，默认 15） |

**自动排序**（`entrySortMode: auto-turn-suffix`，批次结束后 `applyPlotSummaryEntrySort`）：

1. 组内：**other** → **sidecar**（配置顺序）→ **summary**
2. summary：按轮次后缀 **`[from-to]`** 升序（`start`，再 `end`）；同区间再比 **MEMO-n**
3. **兼容**：仍识别旧版 `TITLE-from-to` 后缀（无 `[MEMO-]` 前缀）

实现：`plugins/plot-summary/src/shared/lorebook-sort.ts`（插件侧选 `<previous-summaries>` 条）。

## 5. 二次 LLM 上下文（摘要）

> **已定案**：通用 **上下文块 + prompt 组装**（**`DOC/39`**）；Historian 经 `prepareContextBlocks` → `completeWithContext`。

- XML：`<previous-summaries>` / `<sidecars>`（system reference）；待摘要 `<history>`（user）。
- 勾选 `regexRuleIds` 时对 `conversation.transcript` 块应用 outgoing 正则；`regexApplyAllTurns` 控制 skip。
- **宏引擎**：assemble / complete 经 `runPluginMacroExpand`；须传 **`anchorToTurn`**（Historian 用 `toTurn`）。
- **区间建议**：手动/自动摘要 UI 限制 **≤512 轮**；超出禁用提交并 toast。
- 服务端：`plugin-context-blocks-resolve.ts`、`plugin-assemble-prompt.ts`、`plugin-complete-with-context.ts`、`plugin-summarize-format.ts`、`plugin-macro-expand.ts`。
- 插件：`prepare-context.ts`、`plot-summary-context-blocks.ts`、`summary-prompt-layout.ts`、`server/complete-context-hooks.ts`。

## 6. 代码

| 区域 | 路径 |
|------|------|
| 插件 Web | `plugins/plot-summary/src/`（`pipeline.ts`、`review.ts`、`prepare-context.ts`、`prompt-preview.ts`） |
| 插件 Server hooks | `plugins/plot-summary/src/server/complete-context-hooks.ts` |
| 宿主管线 | `server/src/plugin-context-blocks-resolve.ts`、`plugin-assemble-prompt.ts`、`plugin-complete-with-context.ts` |
| 自动摘要 UI | `web/src/utils/plot-summary-auto-summarize-status.ts`、`PlotSummaryAutoSummarizeBlock.vue` |
| 条目排序 / 标题 | `plugins/plot-summary/src/shared/lorebook-sort.ts`、`shared/summarize.ts` |

## 7. 验收要点

- [ ] 手动/自动摘要 → 预览 → 确认写入 lore  
- [ ] 关再开自动摘要：指针不漂移（91+ 续接）  
- [ ] 手动预填区间与自动块等长（`end = T - buffer`，`start = end - (blockTurns - 1)`）  
- [ ] 写入 lore 条目标题为 `[MEMO-n]-TITLE-[from-to]`；旧条目 `-from-to` 仍可排序  
- [ ] `regexApplyAllTurns` 对摘要 history 全区间生效  
