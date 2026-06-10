# 性能审计与优化方案

> **状态**：审计结论已归档（2026-06）；**路线图 P0–P3 + M4/M5 已落地**（2026-06）。分支**消息树 UI / 写入**见 **`DOC/23`**（非本文）。  
> **非本文范围**：会话消息 **UI 懒加载 S2–S4**（`tail`/`before`、前端分页）属 **`DOC/15`**，仅复用本文 P1 产出的 `readTurnsTail` 等原语。  
> 旧 `mem_*` 多表不兼容，**需重建远期记忆索引**。  
> **关联**：`DOC/03` §6（分支目录）、§14（memory）、`DOC/08`（chunk 链）、`DOC/15`（懒加载，与 P1 原语重叠）、`DOC/10` §3.3（批量 turn API）。

---

## 1. 背景与目标

在自动摘要进度校正、Historian（剧情纪要）与 swipe 批处理等能力落地后，对服务端 **chunk 读写、memory 召回、组装裁切、资料库与 embedding** 做了一轮性能审计。目标：

1. 降低**热路径**（每次发消息 / assemble）的磁盘 IO 与重复计算；
2. 消除 memory 召回的 **N+1 链式扫盘**；
3. 为**对话分支**（`branch*/` 子树）预留数据结构，避免二次迁移 Lance schema；
4. 在**可重建向量**前提下简化 Lance 存储（单表 v2）。

**原则**：优先改 ROI 高、改动面集中的项；旧版 `mem_*` 多表与 `turn_memory` legacy **不保留兼容**。

---

## 2. 已完成的优化（2026-06）

| 项 | 位置 | 效果 |
|----|------|------|
| Turn **批量写** | `PATCH .../turns/batch`、`batchUpdateConversationTurns` | 多轮 PATCH 按 chunk 合并，每 chunk 至多 1 次写盘 + index 至多 1 次写 |
| Turn **区间读** | `GET .../messages?from=&to=`、`readTurnsInOrdinalRange` | 插件 host / messages API 可按 ordinal 读，避免全链 |
| Lorebook **apply-order** | `runApplyLorebookOrder` | 1 读 1 写，替代逐条 `patchEntry` 改 order |
| 自动摘要 **进度与指针校正** | Web `PlotSummaryAutoSummarizeBlock`、指针 reset API | 修复 `lastSummarizedEnd` 只增不减导致的显示漂移 |
| 插件 host **v1.1** | `DOC/10` §3.3、`conversation-host.ts` | `read`/`patch` 接入区间读与批量写 |
| **Memory v2（P0）** | `chunk-path.ts`、`memory-store.ts`、`memory-hits.ts`、`memory-pipeline.ts` | 单表 `turn_memory`；`branchPath`+`chunkFileName` 拆列；按 chunk 批量解析命中；`markConversationMemoryEmbeddingModel` 仅变化时写盘 |
| **热路径区间读（P1）** | `readTurnsTail`、`memory-pipeline.ts`、`plugin-prepare-context.ts` | assemble 尾部窗口；摘要 prepare 单次 `readTurnsInOrdinalRange`；plan reindex 按链计数 |
| **P2 重建与裁切** | `embedding-batch.ts`、`prompt-budget-trim.ts`、`lorebook-entries.ts`、`lorebook-resolve.ts`、`plot-summary/batch-write.ts` | 批量 embed；增量 budget trim；按 id 加载 lore；批量 entry API；剧情纪要摘要合并落盘 |
| **P3 分支 memory** | `enumerateAllChunkChains`、`collectRegisteredBranchPaths`、`buildAllowedBranchPathsForActive` | 全分支 reindex；assemble 按 activeBranch 过滤向量召回；`deleteTurnMemoryByBranchSubtree` |
| **M4 整包 PUT 护栏** | `lorebook-file.ts`、`lorebooks-bulk-put-limit.ts`、`index.ts` | 64 书 / 3000 条 / 8MB + 2s 防抖；插件条目 API 不受影响 |
| **M5 preferences memo** | `request-preferences-memo.ts`、`user-preferences-file.ts` | 单次请求内 `user-preferences.json` 只读一次盘 |
| **6.1 legacy 提示** | `memory-store.ts` | 仅有 `mem_*` 无 `turn_memory` 时会话级 warn 一次 |

---

## 3. 审计发现（待优化）

### 3.1 高优先级

| # | 问题 | 现状 | 影响 | 建议 |
|---|------|------|------|------|
| H1 | **Memory 召回 N+1** | ~~`resolveTurnById` 循环~~ → `loadTurnsForMemoryHits` | — | ✅ P0 已落地 |
| H2 | **Memory 多表检索** | ~~多表 search~~ → 单表 `turn_memory` | — | ✅ P0 已落地 |
| H3 | **全量 `readAllTurns` 热路径** | ~~assemble / 摘要准备全链读~~ | — | ✅ P1：`readTurnsTail` + `loadTurnsForMemoryPipeline`；`plugin-prepare-context` 区间读 |
| H4 | **`syncChunkIndexIfDrifted` 扫全目录** | ~~每次读 turn 前全目录扫~~ | — | ✅ P1：热路径移除 sync；`CHUNK_INDEX_SYNC_TTL_MS` 节流；repair API `force` |
| H5 | **预算裁切重算** | ~~每删一条全量 assemble+tiktoken~~ | — | ✅ P2：`estimateTrimTokenDelta` + 周期性校准 |
| H6 | **Embedding 串行** | ~~逐条 createEmbedding~~ | — | ✅ P2：`embedTextsInBatches`（批量 API + 并发批 + 回退） |
| H7 | **plot-summary 资料库 N+1** | ~~每 task 单条 create~~ | sidecar patch 仍逐条 | ✅ P2：宿主 `entries/batch` + 插件 `flushPendingLorebookCreates` 本轮新建合并落盘 |

### 3.2 中优先级

| # | 问题 | 现状 | 建议 |
|---|------|------|------|
| M1 | ~~`readLorebooksDocument` 全库加载~~ | `lorebook-resolve` | ✅ P2：`readLorebooksByIds` |
| M2 | ~~create/patch 后再 `readLorebookById` 取向量重建~~ | 插件 entry API | ✅ P2：返回 `lorebook` 快照直接 `scheduleLorebookVectorReindex` |
| M3 | ~~`markConversationMemoryEmbeddingModel` 每次 upsert 写 index~~ | `memory-index.ts` | ✅ 仅 model/dims **变化**时写 |
| M4 | ~~`PUT /api/lorebooks` 整包~~ | Web 编辑器仍用整包 | ✅ 64 书 / 3000 条 / 8MB + 2s 限流；`lorebooks_bulk_put_*` 错误码 |
| M5 | ~~preferences 重复读文件~~ | assemble 多次 `readGlobal*` | ✅ `runRequestUser` 内 `request-preferences-memo` |

### 3.3 低优先级 / 已记录

| # | 项 | 说明 |
|---|-----|------|
| L1 | `GET .../messages` 全量（聊天 UI） | **产品项** `DOC/15` S2–S4；assemble 热路径已用 `readTurnsTail`（P1），与 UI 懒加载无关 |
| L2 | 删中间轮后 chunk 合并 | `DOC/08` §1.2 未做 |
| L3 | 调用日志 / debug 审计 | 会话 **debug 审计** ✅（`DOC/24` §3）；全库 `jsonl` 运维台账仍 P1/P2 可选 |

---

## 4. Memory v2 大改方案

> **前提**：不考虑旧 Lance 兼容；部署后用户对受影响会话执行 **重建远期记忆索引** 即可。

### 4.1 存储形态

| 现网 | v2 |
|------|-----|
| 每 chunk 一张 Lance 表 `mem_{chunkId}` + 可选 legacy `turn_memory` | 每会话 **一张表** `turn_memory` |
| 行：`turnId, conversationId, turnOrdinal, vector` | 行：`turnId, turnOrdinal, branchPath, chunkFileName, vector` |
| 删向量：`readChunkContainingTurnId` 定位表 | `DELETE WHERE turnId = ?` 直接删 |
| 检索：N 表 search + merge | 单表 `vectorSearch` + 内存过滤 |

Lance 路径不变：`{DATA_DIR}/{userId}/memory/conversations/{conversationId}/`。

### 4.2 Schema（Arrow / Lance）

```ts
/** Memory v2 行；conversationId 由库路径隐含，不再冗余存储 */
interface TurnMemoryRowV2 {
  turnId: string           // PK，mergeInsert key
  turnOrdinal: int32       // 当前线性路径上的轮次（分支内独立，见 §5）
  branchPath: string       // 主路径 ""；分支 "branch1" 或 "branch1/branch1"（会话根相对，无尾斜杠）
  chunkFileName: string    // 仅 basename，如 turn-000100-000199.json
  vector: float32[dim]
}
```

**为何拆两列**（`branchPath` + `chunkFileName`）：

- 读盘：`path.join(conversationDir(id), branchPath, chunkFileName)`，与 `DOC/03` §6.1 目录布局一致；
- 过滤：召回时可按 `activeBranchPath` 只保留**当前分支及其祖先路径**上的行，无需解析合并字符串；
- 避免 Lance 表名含 `/`（现 `memoryTableNameForChunkFile` 对分支路径不可用）；
- `inferTurnsPerFileFromFileName` 已对 basename 友好，无需改动语义。

### 4.3 路径规范化（共享工具）

建议新增 `server/src/chunk-path.ts`（或置于 `chunk-chain.ts`）：

```ts
/** 规范化 branchPath："" | "branch1" | "branch1/nested"，禁止 .. 与绝对路径 */
export function normalizeBranchPath(raw: string): string

/** 规范化 chunk 文件名：仅 turn-XXXXXX-XXXXXX.json */
export function normalizeChunkBasename(raw: string): string

/** 会话根相对路径，用于日志 / 调试 */
export function chunkStorageRelativePath(branchPath: string, chunkFileName: string): string
```

写入 chunk / 写入 memory 索引时**统一**调用，防止 `branch1/` vs `branch1` 不一致。

### 4.4 召回管线（替换 `resolveTurnById` 循环）

```
createEmbedding(query)
  → searchTurnMemoryVectorsV2(conversationId, vector, topK, filters)
      filters: excludeTurnIds, maxOrdinalExclusive（当前 active 路径语义）, optional branchScope
  → hits: { turnId, turnOrdinal, branchPath, chunkFileName, score }[]

loadTurnsForMemoryHits(conversationId, hits):
  groupBy(branchPath + '\0' + chunkFileName)  // 或嵌套 Map
  for each group:
    readChunkFileAt(conversationId, branchPath, chunkFileName)  // 一次 IO
    pick turns by turnId from chunk.turns
  → formatMemoryXml
```

**复杂度**：K 个命中分布在 C 个 chunk → **C 次读盘**（C ≤ K），替代 K 次链式扫描。

### 4.5 写入与删除

| 事件 | v2 动作 |
|------|---------|
| 新轮 / PATCH / swipe | `mergeInsert` 单行；`branchPath` 来自当前 active 分支上下文，`chunkFileName` 为 tail 块 basename |
| 尾块 buffer flush | 仍 debounce 批量 `mergeInsert`，目标改为单表 |
| 删 turn | `delete WHERE turnId = ?`；同时 `removeBufferedTurnMemory` |
| 删会话 / 弃用分支子树 | `dropTable('turn_memory')` 或 `delete WHERE branchPath LIKE 'branch1%'`（分支删除策略见 §5.3） |
| 全量重建 | `wipe` → 枚举所有路径上的 chunk（§5.2）→ 批量 embed → 单表 bulk insert → 一次 `optimize` |

### 4.6 删除的代码路径（v2 落地时）

- `LEGACY_TABLE_NAME`、`openLegacyTable`、nullable migrate
- `CHUNK_TABLE_PREFIX`、`memoryTableNameForChunkFile`、多表 search 循环
- `deleteTurnMemoryVector` 内 `readChunkContainingTurnId`
- `memory-pipeline` 内 `resolveTurnById` 循环
- 行字段 `conversationId`（可选：读旧表迁移工具若不做则直接 wipe）

### 4.7 与 `DOC/03` §14 索引字段对齐

文档 §907 已列出 `branch_path`；v2 定案为：

- Lance 列名：`branchPath`（camelCase，与 Arrow 惯例一致）
- `chunkFileName` 单独列，**不**使用 `branch/chunk.json` 合并列

---

## 5. 对话分支预留

> **分支完整实现参考（产品语义、已实现原语、待办清单）**：**`DOC/23-conversation-branches.md`**。  
> 分支产品 UI 与 chunk 写入逻辑见 `DOC/08` §1.2（**未做**）、`DOC/03` §6.3 / §7.3。本节说明 **memory v2 与 P3 服务端分支能力**。

### 5.1 主路径（当前实现）

| 字段 | 值 |
|------|-----|
| `branchPath` | `""` |
| `chunkFileName` | `turn-000000-000099.json`（与现网一致） |
| `index.json` `headChunkFile` / `tailChunkFile` | 仍为**主路径**加速索引；值为 basename 或将来可改为相对路径，与 v2 列一致即可 |

### 5.2 分支上线后的索引枚举

`listChunkFileNames` 仅沿主路径 `tailChunkFile` → `previous`，**不会**扫 `branch1/`。重建索引需：

```text
enumerateAllChunkChains(conversationId):
  1. 主路径：现有 listChunkFileNames
  2. 对每个分支子目录（会话根 branches[] + 递归 branch*/index.json）：
     读该 index 的 tailChunkFile，沿 previous 收集
     每条记录附带 branchPath = 子目录相对会话根的路径
  3. 对每个 (branchPath, chunkFileName) 读 chunk → embed → 写入 v2 行
```

### 5.3 召回范围（产品策略）

| 模式 | 行为 |
|------|------|
| **默认（推荐）** | 仅当前 `activeBranchPath` 及其**祖先**上的 turn；向量检索后 filter，或 Lance 标量过滤 `branchPath IN (...)` |
| 全库召回 | 不过滤 `branchPath`；靠 `turnId` 全局唯一区分 |
| 弃用分支 | 删除子树 JSON 后，`delete WHERE branchPath = 'branch1' OR branchPath LIKE 'branch1/%'` |

### 5.4 `turnOrdinal` 语义（重要）

`turnOrdinal` 仅在**同一条从根到叶的线性路径**上有「第 N 轮」含义（`DOC/03` §6.4）。分支内可与主路径**同名 chunk 文件**但 ordinal 不同。

因此：

- `maxOrdinalExclusive`（排除近期 history）必须基于 **active 路径** 计算，不能跨分支比较 ordinal；
- memory 行必须带 `branchPath`，否则无法在同名 `chunkFileName` 下消歧。

### 5.5 chunk 写入配套（分支功能开发时）

| 项 | 说明 |
|----|------|
| `writeChunkFile` | 写入 `branchPath/xxx.json` 前 `mkdir(dirname, { recursive: true })` |
| `readChunkFileAt(convId, branchPath, basename)` | 薄封装，替代裸 `readChunkFile(convId, combined)` |
| `rebuildHeadTailFromLinks` | 按路径作用域扫描（主路径仅根目录 `turn-*.json`；分支仅对应子目录） |
| `syncChunkIndexIfDrifted` | 见 H4：避免每次读都全目录扫 |

**结论**：v2 拆列后，**memory 层无需再改 schema** 即可支持分支；分支功能本身仍需 chunk 链与 index 改造，但与 memory 方案解耦。

---

## 6. 实施路线图

建议顺序（依赖少的在前）：

| 阶段 | 内容 | 依赖 | 预估收益 |
|------|------|------|----------|
| **P0-a** | `chunk-path` 规范化 + `readChunkFileAt` | 无 | 分支与 v2 共用 |
| **P0-b** | Memory v2 schema + `memory-store` 单表 CRUD/search | P0-a | H1、H2 |
| **P0-c** | `loadTurnsForMemoryHits` + `memory-pipeline` 接入 | P0-b | H1 |
| **P0-d** | `memory-index` reindex / upsert 写入 `branchPath`+`chunkFileName`；wipe 旧 `mem_*` | P0-b | 可重建 |
| **P1-a** | `plugin-prepare-context` → `readTurnsInOrdinalRange` | 已有区间读 | H3 一部分 |
| **P1-b** | `memory-pipeline` 近期 history tail 读 + query 构建瘦身 | P1-a | H3 |
| **P1-c** | `syncChunkIndexIfDrifted` 节流 / 跳过全扫 | 无 | H4 |
| **P2-a** | Embedding 批量/并发 reindex | 无 | H6 |
| **P2-b** | 预算裁切增量 token | 无 | H5 |
| **P2-c** | Lorebook 按 id 加载 + plot-summary 批量写 | 无 | H7、M1 |
| **P3** | 分支 chunk 链 + `enumerateAllChunkChains` + activeBranch 过滤 | — | ✅ §5 memory 闭环（UI/写入仍待 `DOC/08` §1.2） |

### 6.1 迁移与运维

1. 合并 v2 代码并发布；
2. 会话设置中执行 **重建远期记忆索引**（现有 SSE `memory/rebuild?stream=1` 可复用，内部改 v2）；
3. ✅ 首次打开 memory 表时：存在 `mem_*` 且无 `turn_memory` → 会话级 `console.warn` 提示重建（**不**自动迁移）；
4. 更新 `DOC/03` §14.5 字段说明指向本文 §4。

### 6.2 验收标准

| 场景 | 标准 |
|------|------|
| 主路径会话 assemble | 无 `resolveTurnById`；memory 命中 5 条、2 chunk → ≤2 次 chunk 读 |
| 向量检索 | 单表 1 次 `vectorSearch`（主路径） |
| 全量重建 500 轮 | 较现网串行 embed **显著缩短**（P2-a 后） |
| 分支（P3 后） | `branch1/turn-*.json` 行 `branchPath='branch1'`；仅 active 分支召回 |
| 回归 | `chunk-chain.test.ts`、`turn-patch-body.test.ts`、memory 单测覆盖 v2 schema |

---

## 7. 相关文件速查

| 区域 | 路径 |
|------|------|
| Chunk 路径规范化 | `server/src/chunk-path.ts` |
| Memory 命中批量解析 | `server/src/memory-hits.ts` |
| Memory schema（v2） | `server/src/turn-memory-arrow.ts` |
| Memory 存储/检索 | `server/src/memory-store.ts` |
| Memory 管线 | `server/src/memory-pipeline.ts` |
| 索引 upsert/reindex | `server/src/memory-index.ts` |
| ~~Turn 链式解析~~（已移除） | 召回用 `memory-hits.ts`；全量 turn 用 `readAllTurns` |
| Chunk 链 / 分支枚举 | `server/src/chunk-chain.ts`（`enumerateAllChunkChains`、`collectRegisteredBranchPaths`） |
| 分支路径 / 召回过滤 | `server/src/chunk-path.ts`（`buildAllowedBranchPathsForActive`） |
| 区间读 | `server/src/chunk-chain.ts` `readTurnsInOrdinalRange` |
| 预算裁切 | `server/src/prompt-budget-trim.ts` |
| Preferences 请求 memo | `server/src/request-preferences-memo.ts` |
| Lorebook 整包 PUT 限流 | `server/src/lorebooks-bulk-put-limit.ts`、`lorebook-file.ts` 常量 |
| 摘要 prepare | `server/src/plugin-prepare-context.ts` |
| 分支文档 | `DOC/03` §6.1–§6.4、§7.3 |
| **懒加载（独立产品项，非 P0–P3）** | `DOC/15`（S2–S4 待做）；§0 列 P1 已交付、可供复用的读盘原语 |
| **分支实现参考** | **`DOC/23-conversation-branches.md`** |

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06 | 初版：合并性能审计 + Memory v2（`branchPath` + `chunkFileName` 拆列）+ 分支预留 |
| 2026-06 | P0 代码落地：`chunk-path`、`memory-store` 单表、`memory-hits`、`memory-pipeline`；`chunk-path.test.ts` |
| 2026-06 | P1：`readTurnsTail`、`loadTurnsForMemoryPipeline`、prepare 区间读、sync TTL、plan 按链计数 |
| 2026-06 | P2：`embedding-batch`、`embedTextsInBatches`、budget trim 增量、`readLorebooksByIds`、`entries/batch` |
| 2026-06 | P2 收尾：`plot-summary` `flushPendingLorebookCreates`；`isEmbeddingBatchOk` 类型收窄 |
| 2026-06 | P3：`enumerateAllChunkChains`、`activeBranchPath` 召回过滤、分支 reindex、`deleteTurnMemoryByBranchSubtree` |
| 2026-06 | M4/M5：整包 PUT 上限与限流、preferences 请求 memo、legacy `mem_*` warn |
