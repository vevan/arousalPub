# 插件 — 对话读写宿主 API（规划）

> **状态**：**规划定案，尚未实现**。  
> **关联**：`DOC/09` §5 Web 宿主、`DOC/03` §6.8 `turns[]` / swipe、`web/src/utils/chat-messages.ts`（现有 `GET .../messages`、`PATCH .../turns/:turnOrdinal`）。

---

## 1. 背景与原则

### 1.1 问题

部分插件需要在**不直接读写** `data/{userId}/chats/` chunk 文件的前提下，对对话轮次做批量处理，例如：

- **清理非激活滑动**（swipe 债务）：删除 `receives[]` 中 `activeReceiveIndex` 以外的候选。
- **Regex 文本替换**（独立功能）：对 `send.userText`、`receives[].content` / `reasoning` 等做规则替换并落盘。

二者**业务逻辑分离**，但共用同一套宿主 **read → 插件变换 → patch** 原语。

### 1.2 定案

| 项 | 定案 |
|----|------|
| 数据权威 | 仍在 chunk / `readAllTurns`；插件**不得**直接 `fs` 访问对话目录 |
| 宿主职责 | 提供结构化 **read / patch**；鉴权、`conversationId`、DTO 形状、校验、UI 刷新 |
| 插件职责 | 读数组 → 自行变换 → 写回；**跨批进度**由插件 `settings.json` 维护 |
| 与现有 REST | 宿主内部复用 `GET /api/chat/conversations/:id/messages` 与 `PATCH .../turns/:turnOrdinal` 语义 |
| 单批上限 | **写死最多 50 轮**（`turnOrdinal` 计数，闭区间 `from..to`） |
| 批处理锁 | `read` / `patch` 批次执行期间，**禁用当前对话的一切写入**（含用户发消息、再生、滑动落盘、编辑保存、删轮等） |

当前 `PluginWebHost` **尚无** `host.conversation`；插件不应以旁路 `fetch` 作为长期方案。

---

## 2. 分层模型

```text
┌─────────────────────────────────────┐
│  插件 A：清理滑动  │  插件 B：regex   │  ← 各自 settings、批次记录、UI
└──────────────┬──────────────────────┘
               │ host.conversation.*
┌──────────────▼──────────────────────┐
│  Web 宿主：runBatch、read、patch、锁   │
└──────────────┬──────────────────────┘
               │ 现有 REST / chat-storage
┌──────────────▼──────────────────────┐
│  chunk 链、turns[]、receives[]       │
└─────────────────────────────────────┘
```

**三步流程（每批重复）**：

1. `host.conversation.runBatch(...)` 获取写锁 → `read({ range })` 得到 **≤50 轮** 数组。  
2. 插件在内存中变换 DTO（清理 / regex / 其它）。  
3. `patchTurns(changedOnly)` → `finally` 释放锁 → 全部批次完成后 **`refresh()`** 一次（或每批 refresh，实现时二选一并在代码注释中固定）。

---

## 3. 数据形状

### 3.1 `ConversationTurnDto`（与 PATCH 对齐）

`turnOrdinal` **从 0 起算**（开场白为第 0 回，与 UI / chunk 一致）。

```ts
interface ConversationTurnDto {
  turnOrdinal: number
  turnId?: string              // 只读，dry-run 报告用
  user: string                 // send.userText（读盘经 getTurnUserText）
  receives: {
    id: string
    content: string
    reasoning?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
  }[]
  activeReceiveIndex: number
  plugins?: unknown[]          // 默认只读；专用权限方可写
}
```

**默认不暴露 / 不可 patch**：`receives[].runtime` 原始对象、chunk `meta`、`index.json`、`chat-prompt.json`。

### 3.2 read 参数

```ts
interface ConversationReadOptions {
  range: { from: number; to: number }   // 闭区间，含端点
}
```

约束：

- `from`、`to` 为非负整数，`from <= to`。
- **`to - from + 1 <= 50`**（常量 `CONVERSATION_BATCH_MAX_TURNS = 50`）；超出返回 **`range_too_large`**，**不截断**。
- 若范围内部分 ordinal 不存在，返回**实际存在的**子集；插件通过 `turnOrdinal` 连续性或 `settings` 进度判断是否读完。

可选响应字段（实现时建议）：

```ts
{ turns: ConversationTurnDto[]; range: { from, to }; maxOrdinal?: number }
```

### 3.3 patch 参数

- **`patchTurns(dtos[])`**：唯一写入口；**单次调用** `1 <= dtos.length <= 50`。
- **单轮**：`patchTurns([dto])`，等价于今日 `persistTurnToServer(turn)`；宿主内部仍走同一实现，**不**另暴露 `patchTurn`。
- **`dtos.length === 0`**：no-op，返回 `{ ok: 0, failed: [] }`（便于插件在「本批无变更」时统一调用）。
- 校验与现有 API 一致：`receives.length >= 1`；`activeReceiveIndex` 合法；`id` + `content` 必填项完整。
- **部分失败**：返回 `{ ok: number; failed: { turnOrdinal, error }[] }`；已成功轮次**不回滚**（v1 无事务）。

---

## 4. `runBatch` 与写锁

### 4.1 API 形态（规划）

```ts
const CONVERSATION_BATCH_MAX_TURNS = 50

interface ConversationBatchContext {
  conversationId: string
  read(opts: ConversationReadOptions): Promise<ConversationTurnDto[]>
  patchTurns(dtos: ConversationTurnDto[]): Promise<BatchPatchResult>
}

host.conversation.runBatch(
  fn: (ctx: ConversationBatchContext) => Promise<void>,
): Promise<void>
```

- 进入 `runBatch`：**按 `conversationId` 加写锁**；若已锁 → **`conversation_locked`**。
- 若 `loading` 或 `regeneratingTurnOrdinal !== null` → **`conversation_busy`**（不与进行中的 stream 并发）。
- **`finally` 释放锁**，避免插件忘解锁。

### 4.2 写锁期间禁用的操作（当前对话）

| 禁用 | 原因 |
|------|------|
| 发送 / `sendWithPlugins` | append 新 turn |
| 再生 / 滑动触发再生 | 改 `receives[]` |
| 滑动切换 active 并 PATCH | 竞态 |
| 编辑用户/助手并保存 | PATCH 同 turn |
| 删除整轮 | DELETE |
| 其它插件 `chat.send` / `regenerate` | 同上 |

**仍允许**：滚动、复制、只读预览（不写盘的 assemble 预览等）。

**不必锁**：其它会话、设置页、插件 settings API、全局 API 配置。

UI：`canSend` 等与 `conversationWriteLocked` 联动；Composer 禁用并提示「对话维护中」。

### 4.3 宿主 UI 原语（规划）

宿主提供**可选**的通用交互能力，降低简单插件成本；**不**禁止插件自建界面。

| 原语 | 用途 | 说明 |
|------|------|------|
| `host.ui.toast(message, opts?)` | 短提示 | 成功 / 失败 / 中性；自动消失 |
| `host.ui.notify(title, body?, opts?)` | 稍长通知 | 可选持久或带 action |
| `host.ui.confirm(opts)` | 危险操作确认 | `title` / `body` / `confirmLabel` / `cancelLabel`；返回 `Promise<boolean>` |
| `host.ui.openFormDialog` | 已有 | 见 `registerFormDialog`（指导生成等） |

**插件自定 UI**：

- 插件可在 `register(host)` 内挂载 **Vue 组件 / `v-dialog`**（如 `swipe-cleaner` 的确认框、`regex-transform` 的规则编辑器）。
- 宿主**不**试图覆盖 regex 等复杂场景的全部 UI；仅保证 slot 挂载点、z-index 与主题不冲突。
- 复杂插件 manifest 可声明 `"ui": { "customPanels": true }`（可选，仅文档约定）。

**undo**：v1 **不做** undo；危险操作靠 `confirm` 文案明示「不可撤销」，用户自担风险。

**与删轮关系**：**删整轮**为 core `useChatSession` + `DELETE` API，**非** conversation 插件职责；插件 patch **不得**删 `turn`、不得改 `turnOrdinal` 序列；清理 swipe 只减 `receives.length`，与删轮按钮独立并存。

---

## 5. 批次进度（插件 settings）

宿主**不**实现全对话 job 引擎；**跨批断点**由插件写入 `data/plugins/{pluginId}/{userId}/settings.json`。

示例（各插件独立 schema）：

```json
{
  "batchSize": 30,
  "progressByConversation": {
    "abcb574d": {
      "nextFrom": 50,
      "failedTurnOrdinals": [12],
      "lastRunAt": "2026-06-02T12:00:00.000Z"
    }
  }
}
```

约定：

- `batchSize` **≤ 50**（插件 UI 校验；宿主 read/patch 仍硬顶 50）。
- 多批 = 多次 `runBatch`；**不要在锁外 patch 半批、锁内 patch 半批**（除非接受中间态被用户打断的风险）。
- **dry-run**：插件可先 read（锁内或只读预检）→ 本地模拟 → 展示统计 → 用户确认后再 `runBatch` + patch。

---

## 6. 示例插件（业务分离）

### 6.1 滑动清理（swipe-cleaner，拟）

**变换**（与 §1.1 相同）：

- 对每轮若 `receives.length > 1`：仅保留 `receives[activeReceiveIndex]`，`activeReceiveIndex = 0`。
- **`receives.length <= 1` 的轮次跳过**（不 patch、不计入统计）。
- 开场白轮（`user` 为空）同样适用。
- patch 仅提交有变化的轮次（`patchTurns(changedOnly)`）。

**UI 定案**：

| 入口 | slot | 可见性 |
|------|------|--------|
| 清理本聊天全部 swipe | `composer-toolbar` | 与 **指导生成** 并列（扫帚图标）；至少一轮 `receives.length > 1` 时可点 |
| 清理本轮其它 swipe | `assistant-turn-footer` | **每一轮**助手气泡（有多 swipe 时）；非仅最后一轮 |

宿主需为 `assistant-turn-footer` 接入 `PluginSlotMount` 并传入 `turn` / `listIndex`（当前仅有 DOM 占位）。

**确认文案**（confirm 时展示统计，**无 undo**）：

- **轮次级**：「将删除本回合其余 **{nRemove}** 条候选回复，仅保留当前第 **{current} / {total}** 条。此操作不可撤销。」
- **会话级**：「将在 **{turnCount}** 个回合中删除共 **{swipeRemoveTotal}** 条未选中的 swipe，保留每轮当前显示的内容。此操作不可撤销。」

统计在 confirm 前由 read（或当前 session 只读预检）计算；会话级多批时在**首批 confirm 前**汇总全对话数字（dry-run），再 `runBatch`。

**manifest（拟）**：`conversation.read`、`turn.receive.prune`；slots：`composer-toolbar`、`assistant-turn-footer`。

### 6.2 Regex 替换（regex-transform，拟）

- settings：规则列表（pattern / flags / replacement / 作用字段：`user` | `assistant` | `reasoning`）。
- read 一批 → map 允许字段；**不改变** `receives.length`（除非规则显式删空且宿主禁止空 content）。
- **UI**：规则编辑器由插件自建（复杂表单 / 预览 / dry-run）；宿主仅提供 `host.conversation` + 可选 toast/confirm。
- 与滑动清理**不共用** progress 键；manifest 权限可拆分。

### 6.3 与 `afterAssemblePrompts` 的区别

| 方式 | 改磁盘 | 改 UI | 改下次 LLM 输入 |
|------|--------|-------|-----------------|
| `host.conversation` patch | 是 | refresh 后一致 | 是 |
| `afterAssemblePrompts` only | 否 | 否 | 仅 outgoing messages |

Regex 若只需「 outgoing 不改盘」，仍可用 server hook；**批量清理已存对话**必须走本节 API。

---

## 7. manifest 权限（规划）

`permissions` 今日仅为声明，实现 conversation host 后应对 read/patch **enforce**：

| 权限 | 说明 |
|------|------|
| `conversation.read` | 允许 `read` |
| `turn.send.write` | 允许 patch `user` |
| `turn.receive.content.write` | 允许 patch `receives[].content` |
| `turn.receive.reasoning.write` | 允许 patch `reasoning` |
| `turn.receive.prune` | 允许减少 `receives.length`（清理滑动） |
| `turn.plugins.write` | 已有声明；写 `turn.plugins[]` |

未声明的字段在 patch 时**忽略或 403**（实现时选一种并写死）。

---

## 8. 边界与后续

|  topic | 说明 |
|--------|------|
| Memory 向量 | 索引粒度为 **`turnId` 一条**（`turnEmbeddingCorpus` = 用户 + **当前 active** 助手正文），**非** per-receive。清理 swipe **不删 turn**，故无「孤儿 receive 向量」。PATCH 落盘后 `scheduleMemoryIndexUpsert` 会按新 corpus 重嵌；若保留内容与索引一致则等价 no-op。**Lance compaction**（`optimizeChunkMemoryTable` / `sealChunkMemorySegment`）是合并碎片文件，`aggressiveCleanup` 清旧 **fragment**，**不**按 turn 语义删行；**删 turn** 时才有 `scheduleMemoryIndexDelete`。Regex 批量改正文后若未触发 upsert 才可能 stale；v1 不自动全量 re-embed，设置页可手动重建索引 |
| 对话备份 compaction | §8 增量备份**排除**可重建缓存（含 Lance）；淘汰最旧 K 份备份**不**单独清理向量表 |
| Syncthing | 锁仅防应用内竞态；外部手改 chunk 仍可能冲突 |
| 单轮多 swipe | 50 轮上限按 **turn 数**；单轮多条长 receive 仍可能 payload 大，属预期 |
| 删整轮 | Core 功能（`DELETE .../turns/:ordinal`）；conversation 插件**不得**替代或拦截 |
| 未打开的对话 | 后续可在设置页对列表中会话跑批：`getConversationId` 来自列表而非当前 session，协议相同 |
| Server 批处理 | v1 仅 Web host + 现有 PATCH；若需超大对话离线任务，再议 `POST .../turns/batch` |

---

## 9. 实现清单（代码待做）

- [ ] `PluginWebHost.conversation`：`getId`、`runBatch`、`read`、`patchTurns`、`refresh`
- [ ] `PluginWebHost.ui`：`toast`、`notify`、`confirm`（Promise<boolean>）
- [ ] `useChatSession`：`conversationWriteLocked`；`canSend` / 再生 / 滑动 / 编辑 / 删除 统一门禁
- [ ] `ChatTurnAssistant`：`assistant-turn-footer` 接 `PluginSlotMount`
- [ ] 常量 `CONVERSATION_BATCH_MAX_TURNS = 50`；`range_too_large` / `conversation_busy` / `conversation_locked` 错误码
- [ ] `manifest.permissions` 校验（read/patch 字段级）
- [ ] 内置插件 `swipe-cleaner`；`regex-transform` 可选（自定 UI）

---

## 10. 参考（当前已实现）

- 读：`GET /api/chat/conversations/:id/messages` → `web/src/utils/chat-messages.ts` `fetchConversationTurns`
- 写：`PATCH /api/chat/conversations/:id/turns/:turnOrdinal` → `persistTurnToServer`
- 磁盘：`server/src/chat-storage.ts` `TurnRecord`；`updateTurnContentInTailChunk` 已按 `turnOrdinal` 在 chunk 链定位
