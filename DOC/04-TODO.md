# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表。

## P0 余项

- [ ] **Web / Server 提示词预设 normalize 完全对齐** — `web/src/stores/prompts.ts` `normalizePreset` 与 `server/src/prompt-preset-normalize.ts` `normalizePresetForAssemble` 须行为一致（已知分叉：`pinPostHistoryAfterChatHistory` vs 组内 `maxO+1` 追加、`presetUsesSystemSubBlocks` 入参、Web 独有 `migrateCharacterGroupToFlatOrder` / 剥离 `useBoundCharacterPostHistory` 等）；目标为共享逻辑或单测矩阵锁死，避免 UI 与组装结果分叉。见 `DOC/03` §15.9。
- [ ] **会话消息 UI 懒加载** — `DOC/15`（`tail`/`before` query + 上滚加载更早轮次；打开对话默认尾部窗口；底层 `readTurnsTail` / `from`–`to` 区间读 ✅）

## P1

- [ ] **对话页顶栏 UI 优化** — `ChatConversationView` `chat-header`（返回、标题、effective 预设/模型提示等）布局与信息层级打磨；见 `DOC/03` §11.4
- [ ] **消息树 / 分支 UI** — `DOC/23` §6（服务端 memory/枚举已就绪）
- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2

- [ ] **作者注分层** `DOC/28` — Phase 2 角色 AN + `{{charAuthorsNote}}`（Phase 1 全局 default ✅）
- [ ] **角色卡内嵌世界书** `DOC/27` — Phase 1 组装（constant + keyword、`position`、叠加内嵌优先）；Phase 2 角色库查看 / 编辑 UI
- [ ] 插件实例与 API 绑定、插件审计、fallback 策略（部分 host API 见 `DOC/10`）
- [ ] **用户文件库** `DOC/20` M1–M5

## P3

- [ ] ST 宏扩展备忘 `DOC/14`；Embedding MRL / Reranker / Qwen instruct（低优先级）

## 文档

- [x] 对话页正则批量 apply UI（2026-06-12）：`ConversationRegexApplyPanel` · 对话设置 Tab「正则批量」· `POST .../regex/apply` dry-run / apply
- [x] chat 深度锚点（§6.6 · 2026-06-12）：最后一条 user 消息，非整栈 `messages.length`
- [ ] 架构/接口变更时同步 `DOC/01`–`03`（2026-06-10：内嵌世界书 `DOC/27`、作者注分层 `DOC/28`）
