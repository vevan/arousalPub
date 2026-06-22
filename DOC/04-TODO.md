# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表。

## P0 余项

- [ ] **对话分支（消息树）** — 定案：`DOC/23` §1.4 **空分支 + 从下一轮继续**；memory/枚举原语已就绪（P3 ✅）

  **S1 · 读路径（阻塞 messages / assemble）**
  - [x] `chunk-chain.ts`：实现 `resolveActivePathTurns(convId, activeBranchPath, range?)`（前缀至 `forkTurnId` + 分支 suffix 合并 · §5.3）
  - [x] `readTurnsTail` / `readTurnsBefore` / `readTurnsInOrdinalRange` 改为基于 `activeBranchPath`（主路径 `""` 行为不变）
  - [x] `conversation-messages-api.ts`：`GET .../messages` 返回合并后线性列表；`tail` / `before` 分页在 active 路径上计算 `hasMoreBefore`
  - [x] `memory-pipeline.ts`：`loadTurnsForMemoryPipeline` 读 active 路径 tail/区间（assemble history 窗口）
  - [x] `plugin-prepare-context`（若有独立读链）：摘要 / 区间读限定 active 路径 — 经 `readTurnsInOrdinalRange` 默认读 index.activeBranchPath
  - [x] 单测：`mergeActivePathPrefixSegment` / `parseBranchRegistryForkTurnId`（`chunk-chain-active-path.test.ts`）；集成 fixture 待 S3

  **S2 · 写路径**
  - [x] `writeChunkFile` append 前 `mkdir` 递归（含 `branchN/` 相对路径）
  - [x] `writeBranchConversationIndex`；`prepareTailChunkForAppend` / `rotateTailChunk` 分支感知
  - [x] `appendConversationTurn` 读 `activeBranchPath`；空分支首 append 创建首 chunk（`forkOrdinal + 1`）
  - [x] `chat-persist-after-chat.ts`：落盘读 `activeBranchPath` + `readTailChunkAt`
  - [x] `scheduleMemoryIndexUpsert` 落盘传 `branchPath`；`readChunkContainingOrdinal` active 路径定位
  - [x] `updateTurnContentInTailChunk` / PATCH 写盘带 `branchPath`
  - [ ] 单测：空分支 fixture 首次 append 磁盘断言（已由集成脚本覆盖）

  **S3 · 分支 API**
  - [x] `POST /api/chat/conversations/:id/branches` — 空分支（§5.3）：注册表 + `branchN/index.json`（无 chunk）+ 可选切 `activeBranchPath`
  - [x] `GET /api/chat/conversations/:id/branches` — 递归树（`path` / `forkTurnId` / `forkOrdinal` / `turnCount` · §6.5）
  - [x] `PATCH /api/chat/conversations/:id` — body 支持 `activeBranchPath`；sync 根 `index.json` + `chat.index.json`
  - [x] `api-error-codes.ts` + i18n：`fork_turn_not_found`、`fork_turn_not_on_active_path`、`branch_path_conflict` 等
  - **审计 backlog**（详见 `DOC/23` §9.1）：无事务回滚、ALS+动态 import 等；严重项 `setActive` 覆盖 `branches[]` 已修复
  - [x] 集成：创建分支 → append → messages / assemble / memory 召回（`.tmp/conversation-branches-integration.ts` · 2026-06-18）
  - [ ] 集成：memory Lance 全链路需 embedding API 时另行 e2e

  **S4 · 前端**
  - [x] 会话 meta 加载 / 持久化 `activeBranchPath`（`ChatConversationView` + `useConversationBranches`）
  - [x] `ChatConversationView` 顶栏：分支树图标 + drawer/overlay 总览（`GET .../branches`）；active 高亮；点击切换 → PATCH + 清空 `turns` + 重载 tail
  - [x] 消息气泡菜单：「从此处分支」（任意 turn）→ `POST .../branches`；可选 `forkMessageId`
  - [x] Fork 点标记：有 sibling 分支的 turn 显示指示；点击打开总览并定位
  - [x] `use-turn-list.ts` / `ChatMessageList`：切换分支后 `reloadTurns` 重置 tail + prepend 懒加载仍可用（`DOC/15`）
  - [x] i18n：`zh.json` / `en.json`（分支、创建、切换、空分支提示等）

  **S5 · 索引与清理（可紧随 S2）**
  - [x] `rebuildHeadTailFromLinks` 按 `branchPath` 作用域扫描（主路径仅根目录 `turn-*.json`）
  - [x] `syncChunkIndexIfDrifted` / tail 缓冲：分支 tail 变更后 `invalidateChunkIndexSyncCache`
  - [ ] 弃用分支（可 v1.1）：`DELETE .../branches/:path` 或设置页入口 → 删子树 + `deleteTurnMemoryByBranchSubtree` + 重置 `activeBranchPath`

  **验收**
  - [x] 主路径 `activeBranchPath=""` 回归与改前一致（`.tmp/conversation-branches-integration.ts` · `branch-accept-main-path`）
  - [x] fork @160：分支目录创建时无 chunk；首条消息写入 `branch1/turn-000100-000199.json`（ordinal 161）
  - [x] 切换分支后 UI 仅显示 active 路径；memory 召回不含兄弟 `branchPath`（集成 recall / cross）
  - [x] 375px 顶栏分支树可用（`ChatBranchPanel` · `@media (max-width: 40rem)` 全宽浮层 · S4）

- [ ] **移动端兼容性修复** — `DOC/33`：~~窄屏 grid/rail overlay~~（已落地）；余 composer / iOS `100dvh`/安全区/软键盘验收

## P1

- [ ] **Web 首屏 bundle 体积优化（Vite chunk > 500KB 警告）** — 当前单次 JS ~1.55MB（gzip ~462KB），CSS ~944KB（Vuetify + MDI）；性能/首屏问题，非构建失败。落地顺序：① `rollup-plugin-visualizer`（或 `vite build --analyze`）确认占比；② `web/src/main.ts` 去掉 Vuetify 全量 `import * as components/directives`，仅保留 `vite-plugin-vuetify` `autoImport`（及少量 labs 如 `VIconBtn`）；③ `web/src/router/index.ts`、`App.vue` 中 `SettingsView` / `PromptsView` / `CharactersView` / `LorebooksView` / `AuthView` 等改为 `defineAsyncComponent` 或 `() => import(...)` 懒加载；④ 仍超限则 `build.rollupOptions.output.manualChunks`（或 Rolldown `codeSplitting`）拆 `vue` / `vuetify` / `virtua` vendor；⑤ `@mdi/font` 全量 → `@mdi/js` 按需 SVG（woff2 ~403KB）；⑥ `web/src/i18n/index.ts` 按 locale 动态 `import()` 语言包。仅调高 `chunkSizeWarningLimit` 只消警告、不减体积。插件 web 模块已 `import(url)` 动态加载，无需改。
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
- [x] 对话设置上下文 Tab 命中测试（2026-06-18）：`POST .../context/recall-test` · `ConversationRecallTestDialog` · 全库 Memory hybrid + 资料库；不排除近期 N 轮
- [x] 全局插件 settings 缓存与订阅（2026-06-18 · `a7ca4ea`）：`plugin-user-settings` Pinia store · `getUserSettingsSnapshot` / `onUserSettingsChanged` · trace-keeper 验收；见 `DOC/32`
- [x] 对话分支创建定案（2026-06-18）：**空分支 + 从下一轮继续** · chunk 命名 · 顶栏分支树 UI · API 草案 — 见 `DOC/23` §1.4–§1.5、§5.3、§6.4–§6.5
- [ ] 架构/接口变更时同步 `DOC/01`–`03`（2026-06-10：内嵌世界书 `DOC/27`、作者注分层 `DOC/28`）
