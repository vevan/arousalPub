# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表。

## P0 余项

- [ ] **消息树 / 分支 UI** — `DOC/23` §6（服务端 memory/枚举已就绪；创建分支 API、active 路径写入与前端消息树为当前主线）
- [ ] **全局插件 settings 缓存与订阅** — `DOC/32`：`getUserSettings` 对齐会话 settings store（snapshot + 写时 notify）；消除 chat 侧栏 refresh 重复 GET；trace-keeper / custom-styles 验收

## P1

- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2

- [ ] **群聊** — ST 式多角色发言轮次与 `{{group}}` / `{{groupNotMuted}}` / `{{charIfNotGroup}}` 等宏语义；当前仅 `characterIds[]` 多卡绑定与注入，见 `DOC/14` §1、`DOC/26`
- [ ] **作者注分层** `DOC/28` — Phase 2 角色 AN + `{{charAuthorsNote}}`（Phase 1 全局 default ✅）
- [ ] **角色卡内嵌世界书** `DOC/27` — Phase 1 组装（constant + keyword、`position`、叠加内嵌优先）；Phase 2 角色库查看 / 编辑 UI
- [ ] 插件实例与 API 绑定、插件审计、fallback 策略（部分 host API 见 `DOC/10`）
- [ ] **用户文件库** `DOC/20` M1–M5

## P3

- [ ] ST 宏扩展备忘 `DOC/14`；Embedding MRL / Reranker / Qwen instruct（低优先级）

## 文档

- [x] Historian 摘要起始轮 toggle 取消（2026-06-12）：`range-picker` 再次点击同一 `turn-block-head` 起始按钮清除 `rangeStartTurn`
- [x] 对话页正则批量 apply UI（2026-06-12）：`ConversationRegexApplyPanel` · 对话设置 Tab「正则批量」· `POST .../regex/apply` dry-run / apply
- [x] Web / Server 提示词预设 normalize 完全对齐（2026-06-13）：共用 `shared/prompt-preset-normalize.ts` + `server/src/prompt-preset-normalize.test.ts` 矩阵单测
- [x] 组装预览绑定块 inject 占位（2026-06-13）：`bindingPlaceholderMode` · 提示词库 `assemble-preview` 绑定槽一律 `<inject slot="…" />`
- [x] 会话消息 UI 懒加载 + virtua 虚拟列表（2026-06-14～17）：`DOC/15` · `ChatMessageList` · 思维链 `<details>` sticky
- [x] 库编辑器失焦保存与 PUT/PATCH 去重（2026-06-17）：提示词 / 世界书 / Embedding / 对话 API·插件 schema 文本字段；见 `DOC/03` §15.10、`DOC/25` §8.1
- [x] 对话页顶栏 UI（2026-06-17）：`chat-header` pill 层级、effective 预设/模型、绑定提示词与世界书菜单、设置入口；见 `DOC/03` §11.2
- [ ] 架构/接口变更时同步 `DOC/01`–`03`（2026-06-10：内嵌世界书 `DOC/27`、作者注分层 `DOC/28`）
