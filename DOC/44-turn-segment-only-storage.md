# Turn 存储：仅 segments（移除 turn.receives 镜像）

> **状态**：定案 · 实施中（2026-07-08）  
> **关联**：[`DOC/35`](35-group-chat.md) §2.1 · [`DOC/04`](04-TODO.md) §TK-D · [`DOC/03`](03-实现细节.md) §6.8

---

## 1. 动机

`turn.receives` / `turn.activeReceiveIndex` 与 `segments[activeSegmentIndex].receives` **重复落盘**，靠 `syncTurnReceivesFromActiveSegment` 维护镜像。该兼容层：

- 膨胀读写与 persist 分支
- 易漂移（写 segment 未 sync、或只写 turn.receives）
- 误导插件 / Host API（以为 turn.receives 是整轮合集）

**定案：删除 turn 级 receives 字段与全部 sync 逻辑；权威数据仅在 `segments[]`。**

---

## 2. 磁盘模型（chunk `TurnRecord`）

```text
turn {
  turnId, turnOrdinal, createdAt?, send: { userText }
  segments: AssistantSegment[]     // 必填；单 bot 亦至少 1 段
  activeSegmentIndex: number
  plugins: unknown[]
  speakerQueue?, groupChatTurnState?, speakerCharacterId?
}

AssistantSegment {
  id, speakerCharacterId
  receives: TurnReceive[]
  activeReceiveIndex: number
  meta?: { nextSpeakerHint?, ... }
}
```

**不再写入**（旧 chunk 由一次性迁移 strip）：

- ~~`turn.receives`~~
- ~~`turn.activeReceiveIndex`~~

`speakerCharacterId` 仍保留在 turn 级，表示 **active segment 的 speaker**（写盘时从 `segments[activeSegmentIndex]` 推导，非第二套正文）。

---

## 3. API 与前端

| 层 | 规则 |
|----|------|
| **GET …/messages** | 仅返回 `segments[]` + `activeSegmentIndex`；**不**再返回顶层 `receives` |
| **PATCH / persist body** | `receives` / `activeReceiveIndex` 表示 **目标 segment**（`segmentIndex` 或 `activeSegmentIndex` 指定）；写盘只改 `segments[i]` |
| **Web `ChatTurnItem`** | `receives` / `activeReceiveIndex` 为 **parse 时 derived**（= active segment），不当作持久化字段；UI 群聊按 `segments` 渲染 |

---

## 4. 服务端访问约定

- 读 assistant 正文 / receiveId：**必须**经 `segments[segmentIndex]` 或 `getActiveSegment(turn, defaultSpeaker)`
- 按 `receiveId` 写 plugins / 正文：`findReceiveInTurn(turn, receiveId)` → segment 索引 → 改 `segments[i].receives`
- **禁止** `turn.receives`（类型级删除，无 fallback 分支）

共享 helper：`server/src/group-chat/segments.ts`（`getActiveSegment` · `findReceiveInTurn` · `getSegmentAtIndex` 等）。

---

## 5. 迁移

1. 若 chunk 仅有 legacy `turn.receives` 且无 `segments`：包装为单 segment（当前库 **0** 条，脚本仍保留）
2. 删除 `turn.receives` / `turn.activeReceiveIndex` 键
3. 脚本路径：`.tmp/strip-turn-receives-mirror.mjs`（执行后删除，不入库）

---

## 6. 与迹录 TK 的衔接

- TK-H Host 快照 / 写回直接基于 `segments[]`（见 [`DOC/30`](30-plugin-trace-keeper.md) · [`DOC/04`](04-TODO.md) §已归档）
- `turn.plugins[]` + `payload.receiveId` 不变；receive 必须 ∈ `segments[*].receives[*].id`

---

## 7. 验收

- [x] `npm run check:ci` 通过（代码侧）
- [x] 全库 chunk 无 `turn.receives` 键（TK-D2 迁移后 · 1490 turn stripped）
- [ ] 群聊多 segment / 单 bot / swipe 回归
