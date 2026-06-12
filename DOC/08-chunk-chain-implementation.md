# Chunk 链切分 — 实现方案

> **状态**：**已实现**（2026-06）。滚动 tail、全链读、跨块 PATCH、超大单块迁移、**head/tail 索引修复**、**删空 tail 链式回退**、`repair-chunk-index` API、基础单测均已落地。

---

## 1. 目标与范围

### 1.1 本期要做（线性主路径）

| 能力 | 说明 |
|------|------|
| **按轮数切分** | 每块最多 **100 轮**（`turnOrdinal` 闭区间与文件名一致，见 §2） |
| **双向链表** | 块内 `meta.links.previous` / `next` 为权威；`index.json` 的 `headChunkFile` / `tailChunkFile` 为加速索引 |
| **追加时滚动** | 第 101 轮（`turnOrdinal === 100`）起写入新块，并链接旧尾块 |
| **全链读取** | history / memory / 消息列表 / `resolveTurnById` 沿链取 turn，不再假设「全在 tail」 |
| **索引修复** | 启动或写盘后可从 `meta.links` 重建 head/tail（§7.4） |
| **存量迁移** | 已有「单文件 >100 轮」的会话，在首次写操作或显式修复时拆成多块（§6） |

### 1.2 后续迭代（未做）

- 分支子目录 `branch*/` 与 `meta.links.branches` 的产品 UI与写入路径 — **完整参考见 `DOC/23-conversation-branches.md`**（memory 枚举 / 召回过滤等服务端原语已落地）
- `GET .../messages` 分页 / 按 chunk 懒加载 — **方案见 `DOC/15-conversation-messages-lazy-load.md`（P0）**
- 跨 chunk 的「删中间轮」后自动合并块（删轮仍只动 tail；**删空 tail 链式回退已实现**，见 §5.3）

---

## 2. 常量与命名

```ts
/** 每块最多容纳的轮次数（与文件名 000000-000099 一致） */
export const CHUNK_TURNS_PER_FILE = 100

/** 根据 ordinal 闭区间生成磁盘文件名（仅主路径、无分支前缀） */
export function chunkFileNameForRange(start: number, end: number): string {
  const pad = (n: number) => String(n).padStart(6, '0')
  return `turn-${pad(start)}-${pad(end)}.json`
}

/** 第 turnOrdinal 轮所属块的 [start, end]（含端点） */
export function ordinalRangeForTurn(turnOrdinal: number): { start: number; end: number } {
  const start = Math.floor(turnOrdinal / CHUNK_TURNS_PER_FILE) * CHUNK_TURNS_PER_FILE
  return { start, end: start + CHUNK_TURNS_PER_FILE - 1 }
}
```

- 块 0：`turn-000000-000099.json`，`turnOrdinal` 0–99  
- 块 1：`turn-000100-000199.json`，`turnOrdinal` 100–199  
- `meta.chunkId` 与文件名去 `.json` 一致；`meta.ordinalRange` 写**实际** min/max `turnOrdinal`（末块可能未满 100 轮）。

---

## 3. 模块划分（建议新文件）

| 文件 | 职责 |
|------|------|
| `server/src/chunk-chain.ts` | 命名、`readChunkFile`、`readChunkChain`、`readAllTurns`、`rebuildHeadTailFromLinks`、`splitOversizedTailChunk`（迁移） |
| `server/src/chat-storage.ts` | 保留写盘原语；`appendConversationTurn` / `saveFirstTurn` 调用 chain 模块的 `ensureTailHasRoom` + `writeTurn` |
| ~~`turn-resolve.ts`~~（已移除） | memory 命中用 `memory-hits.ts`；按 turnId 全链扫描用 `readAllTurns` |
| `server/src/memory-pipeline.ts` | `allTurns` 来自 `readAllTurns` |
| `server/src/memory-index.ts` | 全量 reindex 遍历全链 |
| `server/src/index.ts` | `GET .../messages` 映射全链 turns |

---

## 4. 核心流程

### 4.1 追加一轮（`appendConversationTurn`）

```
1. 读 idx.tailChunkFile → 加载 tail ChunkFile
2. nextOrd = max(turnOrdinal)+1 或 0
3. 若 tail 已满本区间（见下）→ rotateTailChunk：
   a. 关闭旧 tail：meta.links.next = null（保持），ordinalRange.end 校正
   b. 新块名 = chunkFileNameForRange(ordinalRangeForTurn(nextOrd).start, ...)
   c. 新块 meta.links.previous = 旧 tail 文件名
   d. 旧 tail meta.links.next = 新块文件名；写回旧 tail
   e. idx.tailChunkFile = 新块名；写 index
4. 向（可能新的）tail push turn；更新 meta.ordinalRange.end
5. scheduleMemoryIndexUpsert(turn)  // 不变
```

**「tail 已满」判定**（二选一，实现时固定一种并单测）：

- **推荐 A**：`chunk.turns.length >= CHUNK_TURNS_PER_FILE`  
- **备选 B**：`nextOrd > chunk.meta.ordinalRange.end`（需保证 range 与命名一致）

### 4.2 读全链 turn（`readAllTurns(conversationId)`）

```
1. idx = readConversationIndex
2. 从 tail 文件名开始，循环：
   - 读 chunk JSON
   - turns 追加到数组（或 unshift 若从 head 走）
   - 若 meta.links.previous 为 null → 结束
   - 否则 previous 文件名继续
3. 按 turnOrdinal 排序返回（去重：同 turnId 以先见为准，防损坏数据）
```

可选优化：仅 tail 块且 `links.previous === null` 时走现有快路径。

### 4.3 `resolveTurnById`

- 从 **tail** 向 **previous** 线性扫描各块 `turns[]`（turn 总数通常 ≪ 块数×100，可接受）。
- 命中后返回；未命中返回 `null`（Lance 向量可能指向已删 turn，保持现有跳过逻辑）。

### 4.4 `GET /api/chat/conversations/:id/messages`

- 数据源改为 `readAllTurns`（或 `readChunkChain` 后 flatMap），DTO 映射逻辑不变。
- 超长会话注意响应体体积；本期不加分页，在 §8 风险中记录。

### 4.5 History / Memory（`memory-pipeline`）

- `allTurns = readAllTurns(conversationId)` 替代 `sortedTurnsFromChunk(readTailChunk(...))`。
- `selectRecentTurns` / `buildMemoryRecallQuery` 行为不变，仅数据源变全链。

### 4.6 索引一致性（`rebuildHeadTailFromLinks`）

在以下时机调用（幂等）：

- `readConversationIndex` 后发现 `headChunkFile`/`tailChunkFile` 与链不一致  
- 或提供 `POST /api/chat/conversations/:id/repair-chunk-index`（调试用，**已实现**）

算法：

1. 扫描会话目录下 `turn-*.json`（不含 `branch/` 子目录，本期仅主路径）。  
2. 以 `meta.links` 建图，找入度 0 为 head、出度 0 为 tail。  
3. 写回 `index.json` 的 `headChunkFile` / `tailChunkFile`。  
4. 若多块但链断裂 → 打日志，不自动删数据。

---

## 5. 边界与兼容

### 5.1 首块 / 开场白

- `saveFirstTurn` / `saveOpeningTurn`：仍创建 `turn-000000-000099.json`（或 `chunkFileNameForRange(0, 99)`），`ordinalRange: { start: 0, end: 0 }`，`links: { previous: null, next: null }`。

### 5.2 `chat-prompt.json` / `chat-audit.json`

- **当前实现（2026-06-09）**：**`chat-audit.json`**（`schemaVersion: 2`），条目含 `messages` + `assembly` + `calls`；`auditDebug.enabled` + `maxStored` 双开关；`/api/chat` 落盘成功后服务端自写。读盘兼容旧 **`chat-prompt.json`**；**不再新写** `chat-prompt`。滚动 tail 后新轮用**新块文件名**，无需迁移旧 audit 条目。
- 定案与验收：**`DOC/24` §3**、**`DOC/03`** 审计段落。

### 5.3 删除整轮（`deleteConversationTurn`）

- 仍只操作 **tail** 块（与现实现一致）。  
- 若删空 tail 且 `meta.links.previous` 非空：  
  - 删除 tail 文件；  
  - `idx.tailChunkFile = previous`；  
  - 将 previous 块的 `meta.links.next` 置 `null`；  
  - **不**自动删除 previous 内 turn（用户删的是「最后一轮」语义）。

### 5.4 再生 / PATCH turn

- 再生追加 `receives`：turn 必在 tail，逻辑不变。  
- PATCH 按 `turnOrdinal`：若目标不在 tail，需 **按 ordinal 定位块**（`ordinalRangeForTurn` → 文件名 → 读块 → 改 → 写回）。本期必须实现，否则第 50 轮无法编辑。

**建议辅助函数**：

```ts
export async function readChunkContainingOrdinal(
  conversationId: string,
  turnOrdinal: number,
): Promise<{ chunk: ChunkFile; fileName: string } | null>
```

### 5.5 存量「超大单块」迁移

触发时机（任选其一，推荐 **首次 append 前**）：

```ts
async function splitOversizedTailChunkIfNeeded(conversationId: string): Promise<void>
```

- 若 `tail.turns.length <= CHUNK_TURNS_PER_FILE` → 无操作。  
- 否则按 `turnOrdinal` 每 100 条切为多文件，重写 `meta.links` 链，更新 head/tail。  
- **原子性**：先写新文件，再改旧 tail 为链中节点，最后删多余 turn 或整文件替换；失败时保留原单文件（写临时 `.part` 后缀，成功后再 rename）。

---

## 6. 实现顺序（建议明天按此排期）

| 步骤 | 内容 | 验收 |
|------|------|------|
| **S1** | `chunk-chain.ts`：常量、命名、`readChunkFile`、`readAllTurns` | 单测：2 块 JSON fixture 拼出有序 turns |
| **S2** | `appendConversationTurn` 滚动 tail + 链接 previous/next | 手动：发 101 轮后磁盘出现 `turn-000100-000199.json` |
| **S3** | `GET .../messages` + Web 聊天列表显示全历史 | 刷新后可见第 1–101 轮 |
| **S4** | `memory-pipeline` / `resolveTurnById` 走全链 | memory 召回 ordinal&lt;100 的 turn；`resolveTurnById` 命中旧块 |
| **S5** | PATCH/删轮跨块、`readChunkContainingOrdinal` | 编辑第 10 轮成功；删最后一轮后 tail 回退 |
| **S6** | `splitOversizedTailChunkIfNeeded` + `rebuildHeadTailFromLinks` | 把现有 150 轮单文件会话打开并发送一条消息后拆成 2 块 |
| **S7** | 文档：`DOC/03` §6 增「实现状态」、`DOC/06` 摘要 | — |

---

## 7. 测试清单

**自动化（`server`：`npm test`）**

- [x] `computeHeadTailFromLinks`：线性链 head/tail、单块、断链检测 — `chunk-chain.test.ts`
- [x] `chunkFileNameForRange` / `ordinalRangeForNewChunk` / `inferTurnsPerFileFromFileName`

**手动回归（发版前建议跑一遍）**

- [ ] 0→99 轮全在 `turn-000000-000099.json`，`links.next === null`  
- [ ] 第 100 轮（`turnOrdinal` 100）落入 `turn-000100-000199.json`，旧块 `next` 指向新块  
- [ ] `GET messages` 返回 101 条 turn，ordinal 连续  
- [ ] `history maxTurns=20` 仍能拿到全链中最近 20 轮  
- [ ] memory 向量能召回仅存在于块 0 的 `turnId`  
- [ ] 编辑 `turnOrdinal=5` 的 user 文本落盘到块 0  
- [ ] 删除最后一轮后 tail 文件名回退到上一块（若新块已空）  
- [ ] 迁移：单文件 150 轮 → 发送新消息后 2 个 chunk 文件且链完整  
- [ ] `POST .../repair-chunk-index`：手动改坏 index 后修复成功  

---

## 8. 风险与 Syncthing

- **大 JSON 同步**：单块 100 轮仍可能很大；切分后单次同步增量更小。  
- **半写文件**：写盘继续「整文件 `writeFile`」，避免 Syncthing 读到半截；滚动时先写新块再改旧块 `next`。  
- **响应体**：`GET messages` 一次拉全链；数百轮分页与 UI 懒加载见 **`DOC/15`**（P0）。  

---

## 9. 与 `DOC/04` 的对应

- [x] `DOC/04-TODO.md` → **「Chunk 链按轮数切分与全链读取」**
- [x] `DOC/03` §6 实现状态指向本文
