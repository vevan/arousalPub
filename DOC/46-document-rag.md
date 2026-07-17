# 46 — 独立文档 RAG（M4）

> **状态**：✅ 已落地（2026-07-17）  
> **关联**：[`DOC/20`](20-user-file-library.md) §7 / M4、[`DOC/03`](03-实现细节.md) §14 / §17.7、[`DOC/04`](04-TODO.md) P0

## 1. 目标与边界

**目标**：用户上传的长文档（文件库 `kind=document`）经切片 + embedding，进入**独立 Lance 表**，对话按绑定的知识库 hybrid 召回并注入 prompt。

**明确不做**

| 不做 | 说明 |
|------|------|
| 替代世界书 | 文档 RAG ≠ `lore_entries` / keyword lore |
| 混入 turn memory | 表与 `turn_memory` 分离 |
| 角色 `imageFiles` 主路径 | 文档不进角色绑定表产品路径 |
| memory/lore ANN | 仅知识库 `doc_chunks` 行数门控 IVF_PQ；memory / lore 仍 flat |
| 多跳检索 | 单次 TopK |
| 改写历史 turn URL | 同文件库 M5 |

**与 `rag_generate`**：会话 `apiPreset.rag` / `resolveFeatureApi('rag_generate')` 仅作**审计占位**（是否配置了 RAG 相关 API）。**召回主路径复用用户级 embedding**（与 memory / lore vector 同源），不依赖 chat 完成式。

## 2. 实体：知识库 = 命名集合

```
data/{userId}/knowledgeBases/
  index.json                 # schemaVersion: 1, knowledgeBases: [{ id, name, updatedAt }]
  {kbId}.json                # 全量：id, name, description?, fileIds[], fileAliases?{fileId→别名},
                             #         createdAt, updatedAt, indexStatus?, indexedAt?, chunkCount?
```

- **id**：与世界书同规则 `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`（例 `kb-world-bible`）。
- **fileIds**：有序、去重；仅允许文件库中存在且 `kind=document` 的 id（缺文件 / 非文档在加入时拒绝；索引时跳过并记警告）。
- **fileAliases**：稀疏 `fileId → 展示别名`；注入与命中展示别名优先，无别名回退到去扩展名的文件名；文件移出库时同步清理对应别名。
- **单文档**：建「仅含 1 个 fileId」的库即可。
- **对话**：`chats/{id}/index.json` → `knowledgeBaseIds: string[]`（顺序 = 检索合并顺序）；稀疏 `knowledgeSettings`（TopK 等）可覆盖全局。

权威切片清单（可重建 Lance）：

```
data/{userId}/knowledgeBases/{kbId}/chunks.json
# { schemaVersion, embeddingModel, embeddingDimensions, files: [{ fileId, updatedAt, chunks: [{ chunkId, ordinal, text }] }] }
```

## 3. Lance

| 项 | 值 |
|----|-----|
| URI | `{userId}/memory/knowledge/{kbId}/` |
| 表 | `doc_chunks` |
| 行 | `chunkId`, `kbId`, `fileId`, `ordinal` (int), `text`, `vector` |
| FTS | 列 `text`；分词 = 用户 `hybridFts` |
| 检索 | `runLanceHybridSearch`（与 lore/memory 同）；知识库侧 `refineFactor: KNOWLEDGE_ANN_REFINE_FACTOR = 2`（无 ANN 时 Lance 忽略） |
| Scalar | `chunkId` BTREE、`fileId` BITMAP（懒建） |
| ANN | 行数 ≥ **10_000** 时，重索引写入路径建 **IVF_PQ**（`distanceType: l2`；`numPartitions`/`numSubVectors` 用 Lance 默认；`waitTimeoutSeconds: 600`）；未满 flat；**不**在召回路径懒建。建索在 jieba `LANCE_LANGUAGE_MODEL_HOME` 锁**之外**（ANN 不依赖词典，训练期不得阻塞其他用户 FTS）；**soft 降级**：ANN 失败只告警，索引仍 ready（flat 可搜）。实现：`lance-vector-ann-index.ts`（Lance PQ 训练自身另需 ≥256 行，产品门槛已覆盖） |

**Syncthing**：`memory/` 仍建议忽略；`chunks.json` 为权威。

## 4. 切片

| 项 | 首版定案 |
|----|----------|
| 支持 | `text/plain`、`text/markdown`、`application/json`（及 `.txt` / `.md` / `.json`） |
| PDF | **暂不支持**（加入知识库 / 索引返回 `document_type_unsupported`）；选型后置 |
| 默认 | `chunkSizeChars=1200`，`chunkOverlapChars=200`（按 Unicode **码点**计数与查界，增补平面字符不漂移） |
| 切点 | 三级边界优先，否则硬切：空行 `\n\n`（窗口 ≥40% 处）→ 单换行（≥50%）→ **句末标点**（≥60%；`。！？!?…；;`，西文 `.` 可隔闭合符后跟空白且**排除缩写**——单字母首字母 `J.`、点分缩写 `e.g.`/`U.S.`、常见缩写表 `Mr./Dr./etc.` 等；紧随闭合引号/括号 `」』"'’”)】]》〉` 并入当前片）→ 固定字符硬切 |
| 空文档 | 允许入库，0 chunk，索引成功 |

文件 `PUT …/content` 或从库移除 fileId → 触发该 kb 重索引（或摘除该 file 的行）。

**索引完整性**：重索引若产出切片但 embedding 返回向量数 < 切片数，视为失败（`embedding_incomplete`），`indexStatus` 落 `error` 而非假 `ready`，避免「就绪但召回缺片」；重试即重新 `reindex`。重索引经 keyed coalesce 调度器串行合并，key 以**用户 + kbId** 隔离，任务在调度者的用户上下文中执行（多用户并发不串号）。

## 5. 召回与组装

1. `runMemoryPipeline` 之后、lore 匹配可用同一 `scanCorpus`（`userText + memory + history`）。
2. 召回前先校验绑定的知识库仍存在（`readKnowledgeBasesByIds`）；全部无效直接返回空，**不发** embedding 请求。对每个有效 `kbId` hybrid TopK（全局/会话 `knowledgeTopK`，默认 **4**）；多库结果按分合并截断总 TopK。
3. 注入 XML（独立槽，**不**并入 `<lores>` / `<memory>`）：

```xml
<knowledge>
  <chunk collection="知识库名" book="文档展示名" chapter="0">…</chunk>
</knowledge>
```

`book` = 文档展示名：kb 的 `fileAliases[fileId]` 别名优先，否则文件名**去扩展名**（`knowledgeDocumentDisplayName`）。命中测试与组装审计展示同一名字。

4. 预设绑定槽 **`boundKnowledge`**（world 组可放；无槽时 fallback 在 world 组末追加，对齐 `boundMemory`）。
5. 预算裁切：新槽 **`knowledge`**；默认 `trimOrder`: `['knowledge','lore','memory','history']`；旧会话仅 3 槽时自动在队首补 `knowledge`（`minRetain.knowledge` 默认 1，与其余槽一致，避免召回内容被裁空）。

## 6. 删除与引用（扩 M5）

| 引用 kind | 扫描 | 强删行为 |
|-----------|------|----------|
| `knowledge_base_document` | 各 kb 的 `fileIds` | 从该 kb 移除 fileId 并调度重索引 |

对话仅绑 `knowledgeBaseIds`（绑的是库，不是文件）；删库时从各会话 `knowledgeBaseIds` 剪除。

## 7. HTTP（摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/knowledge-bases` | 列表摘要 / 整包少用 |
| POST | `/api/knowledge-bases` | 创建 `{ name, fileIds? }` |
| GET/PATCH/DELETE | `/api/knowledge-bases/:id` | 读 / 改名·改 fileIds·改 `fileAliases`（fileId → 别名，空串删除）/ 删 |
| POST | `/api/knowledge-bases/:id/reindex` | 重建索引；`?stream=1` 时 SSE 推送进度（extracting → embedding → writing） |
| PATCH | `/api/chat/conversations/:id` | `knowledgeBaseIds`、`knowledgeSettings` |

## 8. 设置

- **全局** `user-preferences.json` → `knowledge`：`enabled`（默认 true）、`topK`、`chunkSizeChars`、`chunkOverlapChars`
- **会话** `knowledgeSettings` 稀疏覆盖 `enabled` / `topK`
- UI：设置 → **向量召回** →「知识库（文档 RAG）」；对话设置绑定多选 + TopK；文件库文档可「加入知识库」
- **入口（2026-07-17）**：知识库管理并入「文件」模态——主导航仅一个「文件」菜单项，打开 `LibraryHubView` 单一模态，内部 tab 切换「资产库」（原文件库 `FilesView`，界面更名）/「知识库」（`KnowledgeBasesView`）；`?panel=files` / `?panel=knowledge` 直达对应 tab；两个子视图以 `chromeless` 嵌入，页头由 hub 提供
- **命中测试**：`POST .../context/recall-test` 含 `knowledge`（与组装同 `scanCorpus`；请求 `topK` 可覆盖会话设置）

## 9. 分期对照

| 计划 | 内容 |
|------|------|
| R0 | 本文 + DOC/20·04·03·README |
| R1 | 存储 + REST + 对话绑定 + 引用扩展 |
| R2 | 抽取/切片 + Lance + reindex |
| R3 | 召回 + `boundKnowledge` + trim + 审计 |
| R4 | UI + i18n |
| R5 | 单测；配额后置 |
| R6 | 行数门控 IVF_PQ ANN（≥10k，2026-07-17） |

## 10. 开放问题（关闭）

| # | 原开放 | 定案 |
|---|--------|------|
| 3 | 知识库实体 | 命名集合 + `fileIds[]`（§2） |
| 4 | PDF | 首版不支持；后置选型 |
| — | 注入槽 | `boundKnowledge` + `<knowledge>` |
| — | 删文件 | `knowledge_base_document` 引用（§6） |
