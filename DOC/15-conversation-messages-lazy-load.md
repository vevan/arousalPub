# 会话消息分页与前端懒加载 — 实现方案

> **状态**：**规划中**（P1，见 `DOC/04-TODO.md`）  
> **前置**：Chunk 链全链读已实现（`DOC/08`）；当前 `GET .../messages` 与 Web 聊天区为**一次性全量**。  
> **关联**：`DOC/03` §6.8、`DOC/08` §1.2 / §8、`DOC/10` 插件 `readConversationTurnsRange`、`web/src/composables/chat-session/use-turn-list.ts`。

---

## 1. 背景与问题

### 1.1 现状

| 层 | 行为 |
|----|------|
| **服务端** | `GET /api/chat/conversations/:id/messages` → `readAllTurns` 沿 chunk 链读**全部** turn，映射为 JSON 一次返回 |
| **前端** | `fetchConversationTurns` 全量写入 `turns`；`ChatMessageList` `v-for` 渲染**全部** `ChatTurnBlock` |
| **磁盘** | 已按 `turnsPerFile`（默认 100）分块，但 API **未利用**块边界做区间读 |
| **发给模型** | `assemble-messages` / history 上限 / budget trim **仅裁 prompt**，与 UI 加载无关 |

### 1.2 超长会话（如 1000+ 轮）的影响

- **网络**：单次响应体可达数 MB（视单轮正文长度）。
- **服务端**：每次打开对话都 `readAllTurns` + 全量 DTO 映射，CPU/IO 随轮次线性增长。
- **前端**：1000+ DOM 节点 + 富文本/markdown，滚动与内存明显变差。
- **插件**：`readConversationTurnsRange` 表面支持区间，底层仍 `fetchConversationTurns` 全量再 filter（`DOC/10` §3.2）。

### 1.3 目标

1. **打开对话**：默认只加载**尾部最近 N 轮**（用户立即可见区域）。
2. **上滚加载更早**：按批追加，不重复请求已加载区间。
3. **服务端区间读**：按 `turnOrdinal` 范围只读相交 chunk，避免为 UI 扫全链。
4. **与插件批读对齐**：同一套 range 语义与上限常量（读侧可略大于写侧 50 轮批上限）。
5. **向后兼容**：迁移期保留无参全量响应（或 `?full=1`），避免未改动的调用方立刻损坏。

### 1.4 非目标（本期不做）

- 首页 **`/api/chat/index` 对话列表**分页（元数据轻量，另项）。
- 虚拟列表 / 可变高度项的完整方案（可作为 **Phase 2** 优化项）。
- 改变 chunk **存储格式**或 `index.json` 字段语义。

---

## 2. API 定案

### 2.1 元数据（可选，建议 Phase 1 一并做）

```http
GET /api/chat/conversations/:id/messages/meta
```

```ts
interface MessagesMetaResponse {
  /** 实际存在的 turn 条数（去重后） */
  turnCount: number
  minOrdinal: number | null
  maxOrdinal: number | null
  /** 与 chunk 设置一致，供客户端估算批次数 */
  turnsPerFile: number
}
```

实现：`readAllTurns` 仅收集 ordinal 统计，或从 `index.json` + tail 块 `meta.ordinalRange` 推导（优先轻量路径，避免为 meta 扫全链正文）。

### 2.2 区间读取（主接口扩展）

在现有路由上增加 **query**，不新增路径：

```http
GET /api/chat/conversations/:id/messages?from=0&to=49
GET /api/chat/conversations/:id/messages?before=100&limit=50
GET /api/chat/conversations/:id/messages?tail=80
GET /api/chat/conversations/:id/messages?full=1
```

| 参数 | 含义 | 优先级 |
|------|------|--------|
| `tail=N` | 最近 N 轮（按 `turnOrdinal` 降序取 N 条再升序返回） | 打开对话默认 |
| `before=K&limit=L` | `turnOrdinal < K` 的最近 L 轮（上滚加载更早） | 上滚 |
| `from` + `to` | 闭区间 `[from, to]`，与 `DOC/10` 一致 | 插件 / 调试 |
| `full=1` | **兼容**：等价今日无参全量 | 迁移期 |
| （无参） | **Phase 3 前**：仍全量；**Phase 3 后**：改为等同 `tail=DEFAULT` 并打 deprecation 日志 | 分阶段 |

响应体扩展：

```ts
interface MessagesPageResponse {
  turns: MessagesTurnDto[]          // 与今日字段一致
  range: {
    from: number | null             // 本批最小 ordinal
    to: number | null               // 本批最大 ordinal
  }
  page: {
    hasMoreBefore: boolean          // 是否还有更早轮次
    hasMoreAfter: boolean           // 是否还有更新轮次（多 tab 场景）
    totalCount?: number             // 可选，来自 meta 缓存
  }
}
```

### 2.3 常量（建议 `server/src/messages-page.ts` + `web` 复用导出或镜像）

```ts
/** 打开对话默认加载轮数 */
export const MESSAGES_DEFAULT_TAIL = 80

/** 上滚单次追加 */
export const MESSAGES_LOAD_MORE = 50

/** 单次 GET 区间上限（只读，可大于插件 PATCH 批 50） */
export const MESSAGES_READ_MAX_SPAN = 100

/** 与 DOC/10 插件写批对齐 */
export const CONVERSATION_BATCH_MAX_TURNS = 50
```

校验：

- `tail`：`1 .. MESSAGES_READ_MAX_SPAN`（或允许到 200，实现时固定并单测）。
- `from/to`：`to - from + 1 <= MESSAGES_READ_MAX_SPAN`，否则 `400 range_too_large`（与 `DOC/10` 错误码风格一致）。
- 非法组合（同时 `tail` 与 `from`）→ `400 invalid_query`。

### 2.4 错误码

在 `api-error-codes.ts` 增补（示例）：

- `messages_range_too_large`
- `messages_invalid_query`
- `messages_conversation_not_found`（沿用现有 404 语义）

---

## 3. 服务端实现

### 3.1 新区间读：`readTurnsInOrdinalRange`

**文件**：`server/src/chunk-chain.ts`（或 `messages-read.ts` 薄封装）

```ts
export async function readTurnsInOrdinalRange(
  conversationId: string,
  range: { from: number; to: number },
): Promise<TurnRecord[]>
```

算法要点：

1. `syncChunkIndexIfDrifted` + `readConversationIndex`。
2. 由 `ordinalRangeForNewChunk` / 文件名 `turn-000000-000099.json` 推算**可能相交**的 chunk 文件列表，**不必**从 tail 扫到 head 再 filter。
3. 只 `readChunkFile` 相交块，合并 `turns`，`sortTurnsUnique`，再 `filter(ord in [from, to])`。
4. 快路径：若 `index` 仅单块且 range 覆盖整块，只读一次。

另实现：

```ts
export async function readTurnsTail(
  conversationId: string,
  limit: number,
): Promise<{ turns: TurnRecord[]; hasMoreBefore: boolean }>
```

内部可先 `maxOrdinal`（tail 块 `meta.ordinalRange.end`），再 `readTurnsInOrdinalRange(max - limit + 1, max)`。

`readAllTurns` **降级为兼容/运维路径**（`?full=1`、调试、少数需枚举全量的工具），**不再**作为 assemble / memory 热路径的默认实现。

### 3.2 组装与 memory：同样应按 chunk 读，而非全链

当前 `runMemoryPipeline` 调用 `readAllTurns` 是**历史写法**（单 tail 块时代遗留），按代码实际需求**不必**扫全链：

| 用途 | 实际需要的 turn | 可行读法 |
|------|-----------------|----------|
| **近期 history**（`selectRecentTurns`） | 尾部 `historyCount` 轮（`limitEnabled` 时 ≤200，否则默认 16） | `readTurnsTail(convId, historyCount + slack)`，通常 **1～2 个 chunk** |
| **memory 召回 query**（`buildMemoryRecallQuery`） | 仅**上一轮** assistant + 本轮 user | 读 tail 块最后 1～2 条即可，**无需** `allTurns` |
| **向量命中正文**（`resolveTurnById`） | Lance 返回的 `turnId` | **已实现**：从 `tailChunkFile` 沿 `previous` 按块查找，命中即停 |
| **lore `buildScanText`** | `memoryText` + `recentHistoryScanText`（由上面两项生成） | 不直接读 turn 列表 |
| **memory 全量重建**（`reindexConversationMemory`） | 全部可嵌入 turn | **已实现按块**：`listChunkFileNames` + 逐块 `readChunkFile`（见 `memory-index.ts`） |
| **重建计划计数**（`planConversationMemoryReindex`） | 仅统计条数 | 可改为扫块 `turns.length` 累加，**不必** `readAllTurns` 拼全表 |

结论：**assemble / 每次发消息**应改为 `readTurnsTail`（或 `readTurnsInOrdinalRange` 尾部窗口），与 UI 分页共用同一套 chunk 原语；1000+ 轮会话发消息时不应再触发全链 IO。

```ts
// memory-pipeline.ts 改造方向（示意）
const window = resolveHistoryXmlTurnCount(input.historySettings) + 2
const { turns: tailTurns } = await readTurnsTail(input.conversationId, window)
const recentTurns = selectRecentTurns(tailTurns, historyCount, beforeExclusive)
const query = buildMemoryRecallQuery(input.userText, tailTurns, beforeExclusive)
```

注意：`beforeExclusive`（再生）时须保证窗口仍覆盖「上一轮」；`window` 取 `max(historyCount, 2) + 1` 即可。

### 3.3 路由改造

`server/src/index.ts` 中 `GET .../messages`：

1. 解析 query → 分支调用 `readTurnsTail` / `readTurnsInOrdinalRange` / `readAllTurns`。
2. DTO 映射逻辑**抽函数** `mapTurnRecordsToMessagesDto(records)`，避免三处复制。
3. 计算 `hasMoreBefore`：`minOrdinal > 0` 或存在 `turnOrdinal < range.from` 的 turn（以索引/meta 为准）。

### 3.4 插件宿主

`web/src/plugins/conversation-host.ts`：

- `readConversationTurnsRange` 改为 `fetch(...?from=&to=)`，**不再**全量拉取。
- 批上限仍 `CONVERSATION_BATCH_MAX_TURNS = 50`；服务端 `MESSAGES_READ_MAX_SPAN` 须 ≥ 50。

服务端插件批处理若走内部 TS 调用，可直接 `readTurnsInOrdinalRange`，不走 HTTP。

---

## 4. 前端实现

### 4.1 数据模型（`use-turn-list` 扩展或 `use-turn-page.ts`）

```ts
interface TurnPageState {
  turns: ChatTurnItem[]              // 已加载，按 turnOrdinal 升序
  loadedMin: number | null
  loadedMax: number | null
  hasMoreBefore: boolean
  loadingInitial: boolean
  loadingOlder: boolean
}
```

原则：

- **已加载区间连续**：`[loadedMin, loadedMax]` 无洞（上滚只向更小 ordinal 扩展）。
- **发送/再生/滑动**：在尾部追加或 PATCH 已加载项；若操作落在未加载区间，触发 `refreshTail()`。
- **切换 conversationId**：清空 state，再 `loadInitial()`。

### 4.2 加载流程

```
打开对话
  → GET ?tail=MESSAGES_DEFAULT_TAIL
  → 渲染 + scrollChatToBottom

用户滚到顶部附近（rootMargin / IntersectionObserver sentinel）
  → GET ?before={loadedMin}&limit=MESSAGES_LOAD_MORE
  → prepend 到 turns，保持 scroll 锚点（记录旧 scrollHeight，追加后修正 scrollTop）

refreshConversation / 写锁释放后
  → 若尾部 ordinal 变化：合并 tail 或局部 reload ?tail=…
```

### 4.3 UI

| 组件 | 改动 |
|------|------|
| `ChatMessageList.vue` | 顶部 loading 条 / sentinel；可选「加载更早消息」按钮（移动端友好） |
| `use-chat-scroll.ts` | `preserveScrollOnPrepend` 辅助 |
| `useChatSession.ts` | 编排 `loadInitial` / `loadOlder` / 替换原 `loadMessages` 全量逻辑 |
| `chat-messages.ts` | `fetchConversationTurnsPage(opts)` |

**Phase 1**：仅渲染已加载 turns（DOM 规模 ≈ 80–200），已解决主痛点。  
**Phase 2（可选 P1+）**：`v-virtual-scroll` 或自研虚拟列表，应对用户连续上滚加载 500+ 轮后 DOM 仍偏大的情况。

### 4.4 边界

- **空会话**：`turns=[]`，`hasMoreBefore=false`。
- **不足 tail 轮**：返回实际条数，不 padding。
- **并发的上滚**：忽略过期响应（`requestId` / `conversationId` 校验）。
- **编辑第 10 轮**：若 `loadedMin <= 10 <= loadedMax`，PATCH 后本地更新；否则可选提示「请上滚加载该轮」或自动 expand range。

---

## 5. 实施顺序

| 步骤 | 内容 | 验收 |
|------|------|------|
| **S1** | `readTurnsInOrdinalRange` + `readTurnsTail` + 单测（2～3 块 fixture，1000 轮 mock） | 区间读不读无关 chunk |
| **S1b** | `runMemoryPipeline` 改 `readTurnsTail`；`planConversationMemoryReindex` 改按块计数 | 1000 轮会话 `assemble-messages` 不扫全链 |
| **S2** | `GET .../messages` query 分支 + `messages/meta` + 错误码 | curl：`tail=80`、`before=`、`from/to`；`full=1` 仍全量 |
| **S3** | `chat-messages.ts` 分页 client + `use-turn-list` 分页状态 | 打开 500 轮会话：网络仅 ~80 条；滚顶再 +50 |
| **S4** | 上滚锚点、`refreshConversation` 与 send/regenerate 合并逻辑 | 加载更早后视口不跳；发消息后尾部正确 |
| **S5** | `conversation-host.ts` 改区间 API | 插件批处理不再拉全量 |
| **S6** | 文档：`DOC/03` §6.8、`DOC/08` §1.2、`DOC/10` §3 | — |
| **S7（可选）** | 虚拟滚动 Phase 2 | 连续加载 300+ 轮仍流畅 |

---

## 6. 测试清单

**自动化（server）**

- [ ] `readTurnsInOrdinalRange`：跨 3 块、单块、空会话、损坏链
- [ ] `tail=50` 在 120 轮会话返回 ordinal 70–119 且 `hasMoreBefore=true`
- [ ] `before=70&limit=50` 返回 20–69
- [ ] `from/to` 超 `MESSAGES_READ_MAX_SPAN` → 400

**手动（web）**

- [ ] 1000+ 轮会话：首屏请求体积明显小于全量（DevTools Network）
- [ ] 上滚 5 次后最早轮次可见，scroll 不剧烈跳动
- [ ] 发送、再生、滑动、编辑、删最后一轮：与全量模式行为一致
- [ ] 切换对话再切回：状态重置正确
- [ ] 插件 swipe-cleaner / conversation-export 批处理仍正常

**回归**

- [ ] `assemble-messages` 在 1000+ 轮会话上仍正确注入 history / memory（与全链读结果一致）
- [ ] memory 全量重建仍按块遍历，行为不变
- [ ] `POST .../repair-chunk-index` 不受影响

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 上滚 prepend 导致 scroll 跳动 | 固定锚点算法 + 单测/手测用例 |
| 多窗口同时写，另一窗口 tail 落后 | `refreshConversation` 比对 `maxOrdinal`；可选 SSE/轮询后续项 |
| 插件与 UI 参数不一致 | 共用 `from/to` 语义；常量集中导出 |
| `无参 GET` 行为变更破坏外部脚本 | 分 Phase：`full=1` 显式全量；无参保持全量直至 Phase 3 |
| 虚拟列表与可变高度气泡 | Phase 2 再引入；Phase 1 靠限制已加载条数 |

---

## 8. 与现有文档的对应

- `DOC/08` §1.2「`GET .../messages` 分页」→ 本方案落地。
- `DOC/04-TODO.md` P1 → 勾选项指向本文。
- `DOC/10` `readConversationTurnsRange` → S5 改为真区间读。
- `DOC/03` §6.8 → 实现后补充 API query 与前端分页状态说明。
