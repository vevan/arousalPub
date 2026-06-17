# 会话消息懒加载

> **状态（2026-06-14）**：服务端 `tail` / `before` query ✅；Web 默认尾部窗口 + 上滚追加 ✅；虚拟滚动 ✅。  
> **前置**：`DOC/08` chunk 链。

## 已完成

| 能力 | 位置 |
|------|------|
| `readTurnsInOrdinalRange` / `readTurnsTail` / `readTurnsBefore` | `server/src/chunk-chain.ts` |
| `GET .../messages?from=&to=`（≤50 轮） | `server/src/conversation-messages-api.ts` |
| `GET .../messages?tail=N` · 响应 `page.hasMoreBefore` / `page.from` / `page.to` | 同上 |
| `GET .../messages?before=ordinal&limit=N` | 同上 |
| Web 打开对话默认 `tail=30` | `web/src/composables/chat-session/use-turn-list.ts` |
| 上滚距顶 ≤120px 自动追加；手动「加载更早的对话」按钮 | `use-turn-list.ts` · `ChatMessageList.vue` |
| 虚拟滚动（`virtua` · `Virtualizer`） | `ChatMessageList.vue` |
| prepend 锚点：`shift` + `scrollToItem`，失败时 `scrollHeight` 差值回退 | `use-turn-list.ts` |
| 初次加载 spinner · 失败提示（composer `errorText`） | `ChatMessageList.vue` · i18n |
| assemble / memory 热路径用尾部窗口 | `memory-pipeline.ts` |
| 无参 `GET .../messages` 仍全量 | 兼容；插件/设置页等仍可用 |

## 虚拟滚动要点

- **组件**：`virtua` `Virtualizer`，`item-size` hint 480，`shift` 仅在可 prepend 时开启，`buffer-size=800`。
- **高度跟踪**：virtua 内置 `ResizeObserver` 自动量高（流式、编辑、思维链展开无需手工 `size-dependencies`）。
- **滚底**：注册 scroller 实例 + DOM `scrollHeight` 重试；流式仅 `onlyIfNearBottom` 贴底。
- **加载更早**：自动加载有 500ms 冷却 + `autoLoadArmed`；**按钮不受冷却**，作为兜底。

## 约定

- UI 已加载轮次与 assemble 读盘**独立**；发消息不依赖 UI 是否加载全历史。
- 分支 lazy load 依赖 `DOC/23` 分支化读链；当前区间读仅主路径。

## 内存与数据窗口

- 虚拟滚动仅减少 **DOM**；`turns` 数组随每次 prepend **累积增长**（每片最多 30 轮）。
- 用户连续上滚加载多片后，内存与 Vue 响应式开销会上升；**未做已滚远 turn 的卸载（LRU）**。
- 若需支持极长会话只读浏览，远期可考虑：保留 ordinal 索引 + 卸载视口外 N 片以外的 turn 数据（与编辑/重生/审计交互需单独设计）。

## 错误码

`messages_range_invalid`、`messages_range_incomplete`、`range_too_large`（`api-error-codes.ts`）。

Web 加载失败文案：`chat.errors.loadMessagesFailed` · `chat.errors.loadOlderFailed`。
