# 会话消息懒加载

> **状态（2026-06-13）**：服务端 `tail` / `before` query ✅；Web 默认尾部窗口 + 上滚追加 ✅。  
> **前置**：`DOC/08` chunk 链。

## 已完成

| 能力 | 位置 |
|------|------|
| `readTurnsInOrdinalRange` / `readTurnsTail` / `readTurnsBefore` | `server/src/chunk-chain.ts` |
| `GET .../messages?from=&to=`（≤50 轮） | `server/src/conversation-messages-api.ts` |
| `GET .../messages?tail=N` · 响应 `page.hasMoreBefore` / `page.from` / `page.to` | 同上 |
| `GET .../messages?before=ordinal&limit=N` | 同上 |
| Web 打开对话默认 `tail=30` | `web/src/composables/chat-session/use-turn-list.ts` |
| 上滚距顶 ≤120px 或点击「加载更早的对话」追加 | `ChatMessageList.vue` |
| assemble / memory 热路径用尾部窗口 | `memory-pipeline.ts` |
| 无参 `GET .../messages` 仍全量 | 兼容；插件/设置页等仍可用 |

## 可选（Phase 2）

- 虚拟滚动（长列表 DOM 优化）

## 约定

- UI 已加载轮次与 assemble 读盘**独立**；发消息不依赖 UI 是否加载全历史。
- 分支 lazy load 依赖 `DOC/23` 分支化读链；当前区间读仅主路径。

## 错误码

`messages_range_invalid`、`messages_range_incomplete`、`range_too_large`（`api-error-codes.ts`）。
