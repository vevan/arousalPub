# 会话消息懒加载

> **状态（2026-06-12）**：服务端原语 ✅；**UI 分页与 `tail`/`before` query 待做**（**P0** · `DOC/04`）。  
> **前置**：`DOC/08` chunk 链。

## 已完成

| 能力 | 位置 |
|------|------|
| `readTurnsInOrdinalRange` / `readTurnsTail` | `server/src/chunk-chain.ts` |
| `GET .../messages?from=&to=`（≤50 轮） | `server/src/index.ts` |
| assemble / memory 热路径用尾部窗口 | `memory-pipeline.ts`（非全链 `readAllTurns`） |
| 无参 `GET .../messages` 仍全量 | 兼容；lazy load 落地后 Web 改调分页 |

## 待做（S2–S4）

1. **API**：`?tail=N`、`?before=ordinal&limit=N`；响应 `page.hasMoreBefore`、可选 `range`。
2. **Web**：打开对话默认尾部 N 轮；上滚追加；`use-turn-list.ts` 改分页加载。
3. **可选**：虚拟滚动（Phase 2）。

## 约定

- UI 已加载轮次与 assemble 读盘**独立**；发消息不依赖 UI 是否加载全历史。
- 分支 lazy load 依赖 `DOC/23` 分支化读链；当前区间读仅主路径。

## 错误码

`messages_range_invalid`、`messages_range_incomplete`、`range_too_large`（`api-error-codes.ts`）。
