# 会话消息分页与前端懒加载 — 实现方案

> **状态**：**部分已落地**（2026-06）— 服务端 chunk 原语、区间 GET、`assemble` 热路径已就绪；**UI 懒加载与 `tail`/`before` query 仍待做**（见 §5 待办）。  
> **定位**：**会话消息产品能力**（打开对话默认尾部 N 轮、上滚加载更早消息），**不是** `DOC/22` 性能审计路线图中的 P0–P3 项。  
> **前置**：Chunk 链（`DOC/08`）。`DOC/22` P1 已交付的 `readTurnsTail` / 区间读等原语供本文 **S1 / S1b** 复用；**S2–S4**（`tail`/`before` API、Web 分页、上滚锚点）仍属本文待办。  
> **关联**：`DOC/03` §6.8、`DOC/08`、`DOC/10` §3.3、`DOC/22`、`web/src/composables/chat-session/use-turn-list.ts`。

---

## 0. 已完成能力（供 lazy load 实施时直接复用）

> 下列能力**已实现**，实施本文 §4 前端分页时**无需再改**底层读盘；仅需在 `GET .../messages` 上挂 query 分支并改 Web 调用方。

### 0.1 Chunk 读原语（`server/src/chunk-chain.ts`）

| 函数 | 状态 | 行为摘要 |
|------|------|----------|
| `readTurnsInOrdinalRange(convId, from, to)` | ✅ | 闭区间 `[from, to]`；从 `index.tailChunkFile` 沿 `previous` 只读**相交** chunk；**不**调用 `syncChunkIndexIfDrifted` |
| `readTurnsTail(convId, limit)` | ✅ | 读 tail 块得 `maxOrdinal` → `readTurnsInOrdinalRange(from, to)`；返回 `{ turns, hasMoreBefore, minOrdinal, maxOrdinal }` |
| `computeTailOrdinalReadRange(maxOrdinal, limit)` | ✅ | 纯函数；单测见 `chunk-chain.test.ts` |
| `readAllTurns(convId)` | ✅ 保留 | **运维/兼容**；无参 `GET .../messages` 仍用；热路径（assemble / 摘要）**已迁出** |
| `syncChunkIndexIfDrifted` | ✅ 节流 | 热路径**不调用**；`CHUNK_INDEX_SYNC_TTL_MS = 5min`；`repairConversationChunkIndex` 强制全扫 |

**`hasMoreBefore` 语义（当前实现）**：`computeTailOrdinalReadRange` 下为 `from > 0`（即最小 ordinal 仍大于 0 时认为前面还有）。lazy load 挂 API 时可原样透出，或结合 `messages/meta` 再精确化。

**未做**：按文件名推算相交块、不沿链 walk 的进一步优化（现实现已够用，长对话通常只读 1～2 块）。

### 0.2 HTTP：`GET .../messages` 区间读（`server/src/index.ts`）

| Query | 状态 | 实现 |
|-------|------|------|
| `from` + `to` | ✅ | `readTurnsInOrdinalRange`；`to - from + 1 > 50` → `400 range_too_large`（`CONVERSATION_BATCH_MAX_TURNS`） |
| （无参） | ✅ 仍全量 | `readAllTurns` |
| `tail` / `before` / `limit` / `full=1` | ⏳ | 见 §2.2 定案，路由**未接** |
| 响应 `range` / `page.hasMoreBefore` | ⏳ | 见 §2.2，**未接** |

错误码（已有）：`messages_range_incomplete`、`messages_range_invalid`、`range_too_large`（`api-error-codes.ts`）。

### 0.3 Web 客户端（`web/src/utils/chat-messages.ts`）

| 函数 | 状态 | 行为 |
|------|------|------|
| `fetchConversationTurnsRange(id, from, to)` | ✅ | `GET .../messages?from=&to=`，解析为 `ChatTurnItem[]` |
| `fetchConversationTurns(id)` | ✅ 全量 | 无参 GET；**聊天页仍用此路径** → lazy load 待改 |
| `fetchConversationTurnsPage` / `tail` | ⏳ | 见 §4.3 |

### 0.4 插件宿主（`web/src/plugins/conversation-host.ts`）

| API | 状态 | 行为 |
|-----|------|------|
| `readConversationTurnsRange` | ✅ | 内部 `fetchConversationTurnsRange`，**真区间读**，不再全量 filter |
| `patchTurns` / batch | ✅ | `DOC/10` §3.3；`CONVERSATION_BATCH_MAX_TURNS = 50` |

### 0.5 其它服务端热路径（与 UI 分页独立，但共用原语）

| 调用方 | 读法 | 文件 |
|--------|------|------|
| `runMemoryPipeline` / assemble | `loadTurnsForMemoryPipeline` → `readTurnsTail` 或区间读（再生） | `memory-pipeline.ts` |
| `runPluginPrepareContext`（剧情纪要） | `readTurnsInOrdinalRange(rangeFrom, toTurn)` 单次 | `plugin-prepare-context.ts` |
| Memory 向量命中正文 | `loadTurnsForMemoryHits`（按 `branchPath`+`chunkFileName` 批量读 chunk） | `memory-hits.ts` |
| `planConversationMemoryReindex` 计数 | 沿 `listChunkFileNames` 按块计数，非 `readAllTurns` | `memory-index.ts` |

**与 lazy load 关系**：发给模型的 history/memory **不依赖** UI 已加载的 turns；两者读盘可并行演进，**无冲突**（见 `DOC/22` §5 lazy load 说明）。

### 0.6 常量（当前代码）

```ts
// server/src/turn-patch-body.ts
export const CONVERSATION_BATCH_MAX_TURNS = 50  // PATCH batch + GET from/to 上限

// server/src/chunk-chain.ts
export const CHUNK_INDEX_SYNC_TTL_MS = 5 * 60 * 1000
```

`MESSAGES_DEFAULT_TAIL` / `MESSAGES_READ_MAX_SPAN`（§2.3）**尚未**抽到 `messages-page.ts`；实施 S2 时建议新建并与 Web 镜像。

### 0.7 分支对话

Memory v2 已在 Lance 行预留 `branchPath` + `chunkFileName`（`DOC/22`）；枚举与召回过滤见 **`DOC/23-conversation-branches.md`**。**messages 区间读仍仅主路径**（`index.tailChunkFile` 链）。分支 lazy load 须在 `readTurnsTail` / `readTurnsInOrdinalRange` 分支化后实施（`DOC/23` §6.2）。

---

## 1. 背景与问题

### 1.1 现状（2026-06 更新）

| 层 | 行为 |
|----|------|
| **服务端读盘** | ✅ 区间原语 + `from/to` GET 已就绪；⏳ `tail`/`before` query 与分页响应字段未接 |
| **服务端无参 GET** | 仍 `readAllTurns` 全量（兼容） |
| **前端聊天区** | `fetchConversationTurns` 全量；`ChatMessageList` 渲染全部 `ChatTurnBlock` |
| **插件批读** | ✅ `readConversationTurnsRange` 真区间 HTTP |
| **发给模型** | ✅ `assemble` 经 `memory-pipeline` 尾部/区间读，不扫全链 |

### 1.2 超长会话（如 1000+ 轮）的影响

- **网络（UI）**：打开对话仍一次拉全量 → **待 §4 前端 lazy load**。
- **服务端 assemble**：已改为尾部窗口，**不再**随总轮次线性扫全链。
- **前端 DOM**：仍随全量 turns 增长 → **待 §4**。

### 1.3 目标

1. **打开对话**：默认只加载**尾部最近 N 轮**（用户立即可见区域）。
2. **上滚加载更早**：按批追加，不重复请求已加载区间。
3. **服务端区间读**：按 `turnOrdinal` 范围只读相交 chunk — **原语已完成**，挂到默认 GET 即可。
4. **与插件批读对齐**：同一套 `from/to` 语义；插件侧 **已对齐**。
5. **向后兼容**：迁移期保留无参全量（或 `?full=1`）。

### 1.4 非目标（本期不做）

- 首页 **`/api/chat/index` 对话列表**分页。
- 虚拟列表完整方案（**Phase 2**）。
- 改变 chunk **存储格式**或 `index.json` 字段语义。

---

## 2. API 定案

### 2.1 元数据（可选，建议 Phase 1 一并做）— ⏳

```http
GET /api/chat/conversations/:id/messages/meta
```

```ts
interface MessagesMetaResponse {
  turnCount: number
  minOrdinal: number | null
  maxOrdinal: number | null
  turnsPerFile: number
}
```

实现建议：读 tail 块 `meta.ordinalRange` + 沿链累加 `turns.length`（与 `planConversationMemoryReindex` 计数类似），**避免** `readAllTurns`。

### 2.2 区间读取（主接口扩展）

在现有路由上增加 **query**，不新增路径：

```http
GET /api/chat/conversations/:id/messages?from=0&to=49          # ✅ 已实现
GET /api/chat/conversations/:id/messages?before=100&limit=50   # ⏳
GET /api/chat/conversations/:id/messages?tail=80               # ⏳
GET /api/chat/conversations/:id/messages?full=1                  # ⏳
```

| 参数 | 含义 | 状态 |
|------|------|------|
| `from` + `to` | 闭区间 `[from, to]` | ✅ |
| `tail=N` | 最近 N 轮 | ⏳ 实现时调用 **`readTurnsTail`** |
| `before=K&limit=L` | `turnOrdinal < K` 的最近 L 轮 | ⏳ 可用 `readTurnsInOrdinalRange(K-L, K-1)` 或 tail 推导 |
| `full=1` | 等价无参全量 | ⏳ |
| （无参） | Phase 3 前仍全量 | ✅ 当前行为 |

响应体扩展（⏳）：

```ts
interface MessagesPageResponse {
  turns: MessagesTurnDto[]
  range: { from: number | null; to: number | null }
  page: {
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    totalCount?: number
  }
}
```

### 2.3 常量（建议 `server/src/messages-page.ts` + `web` 镜像）— ⏳

```ts
export const MESSAGES_DEFAULT_TAIL = 80
export const MESSAGES_LOAD_MORE = 50
export const MESSAGES_READ_MAX_SPAN = 100   // 可大于插件写批 50
export const CONVERSATION_BATCH_MAX_TURNS = 50  // ✅ 已有
```

### 2.4 错误码

已有：`messages_range_incomplete`、`messages_range_invalid`、`range_too_large`。  
待增（可选）：`messages_invalid_query`（`tail` 与 `from` 互斥等）。

---

## 3. 服务端实现

### 3.1 区间读原语 — ✅ 见 §0.1

实施 S2 时 `?tail=N` 分支示例：

```ts
const { turns, hasMoreBefore, minOrdinal, maxOrdinal } =
  await readTurnsTail(conversationId, tailN)
// mapTurnRecordsToMessagesDto(turns) + page.hasMoreBefore = hasMoreBefore
```

`?before=K&limit=L` 示例：

```ts
const end = K - 1
if (end < 0) return empty
const from = Math.max(0, end - L + 1)
const turns = await readTurnsInOrdinalRange(conversationId, from, end)
// hasMoreBefore: from > 0
```

### 3.2 组装与 memory — ✅ 已落地（`DOC/22` P1）

`memory-pipeline.ts` 使用 `loadTurnsForMemoryPipeline`：

- 正常发消息 → `readTurnsTail(window)`，`window = max(historyCount, 2) + 1`
- 再生（`historyBeforeTurnOrdinalExclusive`）→ `readTurnsInOrdinalRange(from, end)`

向量命中正文走 `loadTurnsForMemoryHits`，**不再** `resolveTurnById` 链式扫盘。

### 3.3 路由改造 — 部分 ✅

`server/src/index.ts` `GET .../messages`：

| 项 | 状态 |
|----|------|
| `from/to` → `readTurnsInOrdinalRange` | ✅ |
| `tail` / `before` / `full=1` 分支 | ⏳ |
| `mapTurnRecordsToMessagesDto` 抽取 | ⏳ |
| 响应 `range` + `page` | ⏳ |

### 3.4 插件宿主 — ✅ 见 §0.4

服务端插件若走内部 TS，可直接 `readTurnsInOrdinalRange`，不必 HTTP。

---

## 4. 前端实现 — ⏳ 待做

### 4.1 数据模型（`use-turn-list` 扩展或 `use-turn-page.ts`）

```ts
interface TurnPageState {
  turns: ChatTurnItem[]
  loadedMin: number | null
  loadedMax: number | null
  hasMoreBefore: boolean
  loadingInitial: boolean
  loadingOlder: boolean
}
```

### 4.2 加载流程

```
打开对话
  → GET ?tail=MESSAGES_DEFAULT_TAIL     // 待 S2+S3
  → 渲染 + scrollChatToBottom

上滚
  → GET ?before={loadedMin}&limit=MESSAGES_LOAD_MORE

refreshConversation / 写锁释放后
  → 比对 maxOrdinal，必要时 reload tail
```

**过渡方案**：在 S2 完成前，可先用 `fetchConversationTurnsRange(loadedMin - 50, loadedMax)` 手工拼批（需已知 `loadedMin/Max`）；正式方案仍用 `tail`/`before`。

### 4.3 UI 改动清单

| 组件 | 改动 |
|------|------|
| `chat-messages.ts` | `fetchConversationTurnsPage({ tail \| before, limit })` |
| `useChatSession.ts` | `loadInitial` / `loadOlder` 替代全量 `loadMessages` |
| `ChatMessageList.vue` | 顶部 sentinel / loading |
| `use-chat-scroll.ts` | `preserveScrollOnPrepend` |

---

## 5. 实施顺序

| 步骤 | 内容 | 状态 |
|------|------|------|
| **S1** | `readTurnsInOrdinalRange` + `readTurnsTail` + `computeTailOrdinalReadRange` 单测 | ✅ |
| **S1b** | `memory-pipeline` / `plugin-prepare-context` / plan 计数改区间或按链 | ✅ |
| **S2** | `GET .../messages` 增加 `tail` / `before` / `full` + 响应 `page` + 可选 `messages/meta` | ⏳ |
| **S3** | Web 分页 client + `use-turn-list` 状态 | ⏳ |
| **S4** | 上滚锚点、send/regenerate 与 tail 合并 | ⏳ |
| **S5** | `conversation-host` 真区间读 | ✅ |
| **S6** | 文档：`DOC/03` §6.8、`DOC/08`、`DOC/10` 对齐 | ⏳ 部分（本文 + `DOC/22`） |
| **S7（可选）** | 虚拟滚动 Phase 2 | ⏳ |

---

## 6. 测试清单

**自动化（server）**

- [x] `computeTailOrdinalReadRange` 单测
- [ ] `readTurnsInOrdinalRange`：跨 3 块 fixture 集成测
- [ ] `tail=50` HTTP：120 轮会话返回 ordinal 70–119 且 `hasMoreBefore=true`
- [ ] `before=70&limit=50` HTTP
- [x] `from/to` 超 50 → `400 range_too_large`（路由已有）

**手动（web）**

- [ ] 1000+ 轮：首屏请求体积明显小于全量
- [ ] 上滚 5 次、scroll 锚点
- [ ] 发送 / 再生 / 滑动 / 编辑 / 删最后一轮
- [ ] 切换对话状态重置
- [x] 插件 swipe-cleaner 批处理（区间读）

**回归**

- [x] `assemble-messages` 热路径不 `readAllTurns`（`memory-pipeline`）
- [x] memory 重建按块遍历
- [ ] `assemble` 与旧全链读结果一致（长会话抽样）
- [ ] `POST .../repair-chunk-index` 不受影响

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 上滚 prepend scroll 跳动 | 锚点算法 + 手测 |
| 多窗口 tail 落后 | `refreshConversation` 比对 `maxOrdinal` |
| 无参 GET 行为变更 | Phase 3 前保持全量；`full=1` 显式 |
| index head/tail 漂移 | `repair-chunk-index`；区间读沿 tail 链，不依赖每次全目录 sync |

---

## 8. 与现有文档的对应

| 文档 | 关系 |
|------|------|
| `DOC/08` §1.2 | `GET .../messages` 分页 → 本文 S2–S4 |
| `DOC/22` | P1 热路径优化 = 本文 S1b；§0 与之重复处以**本文**为 lazy load 入口索引 |
| `DOC/10` §3.3 | 插件区间读 ✅ |
| `DOC/04-TODO.md` | P1 lazy load 勾选项 → 完成 S2–S4 后更新 |
| `DOC/03` §6.8 | S6：补充 query 与前端分页状态 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06（初） | 规划全文 |
| 2026-06 | 增补 **§0 已完成能力**：`readTurnsTail`、`区间 GET`、插件 host、assemble 热路径；更新 §1/§5/§6 状态 |
