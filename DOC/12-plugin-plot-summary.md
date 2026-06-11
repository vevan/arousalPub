# Historian（plot-summary）

> **状态**：v1.6+ 可验收。插件 id **`plot-summary`**；展示名 Historian / 剧情纪要。旧 id `curated-memory` 启动迁移。  
> **关联**：`DOC/11` lorebook API、`DOC/09` 插件、`DOC/10` 对话 read、`DOC/24` 正则（摘要 outgoing）。

## 1. 语义

- **剧情纪要**：每块 N 轮 → 模型 `{ title, content, keywords }` → lore **新条目**（标题 + `-from-to` 后缀）。
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
- **首次开启**（对话较短）：直接 `nextBlockStart: 0`；较长则弹窗区间 `[T-buffer-blockTurns, T-buffer]` 并可选立即摘要。

## 4. 手动摘要

- 菜单「手动摘要」；区间 picker 两键选 start/end 优先。
- **默认预填**（无 picker）：`start = T - bufferTurns - blockTurns`，`end = T - bufferTurns`（T = 当前最大 turnOrdinal）。
- 写盘：开关与指针分次 patch；摘要成功后再更新 `lastSummarizedEnd` / `nextBlockStart`。
- **Prompt 预览**：debug 审计开启时对话框第四按钮（`prepare-context` 干跑）。

## 5. prepare-context（摘要）

- XML：`<user userName="…">` / `<assistant charName="…">`；`<context-history>` / `<history>`。
- 勾选 `regexRuleIds` 时对摘要 outgoing 应用原生正则；`regexApplyAllTurns` 控制 skip。
- 服务端：`plugin-prepare-context.ts`、`plugin-summarize-format.ts`。

## 6. 代码

| 区域 | 路径 |
|------|------|
| 插件 | `plugins/plot-summary/src/`（`pipeline.ts`、`dialogs.ts`、`settings.ts`） |
| 服务端 prepare | `server/src/plugin-prepare-context.ts` |
| 自动摘要 UI 状态 | `web/src/utils/plot-summary-auto-summarize-status.ts` |
| 条目排序 | `server/src/plot-summary/` |

## 7. 验收要点

- [ ] 手动/自动摘要 → 预览 → 确认写入 lore  
- [ ] 关再开自动摘要：指针不漂移（91+ 续接）  
- [ ] 手动预填不超出当前可摘要尾部  
- [ ] `regexApplyAllTurns` 对摘要 history 全区间生效  
