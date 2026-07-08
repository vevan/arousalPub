# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表、本文 **§已归档**。

## P0 余项

> **编排原则**（2026-07-08）：先 **宿主 generic 契约**（[`DOC/41`](41-plugin-host-generic-principles.md) · [`DOC/42`](42-host-generic-audit-checklist.md)），再 **插件包**；与 **沙箱**（[`DOC/38`](38-plugin-sandbox-and-host-evolution.md) · 默认关）无架构冲突——`runPluginAction` / Host API 代理面相同。

### Composer Slash

- [ ] **Composer Slash 命令** — 定案见 [`DOC/35`](35-group-chat.md) §2.3（群聊 `/@`）；输入框 `/` 命令层（与聊天 turns、输入历史分离）
  - [x] **S0** 宿主 `submitComposer` 统一入口 + 命令解析/路由（raw → 命令 + 剩余正文）
  - [x] **S1** 内置 `/goto N` 跳转轮次
  - [x] **S2** 内置 `/@ Name [Name…]` — 解析 + strip；`speakerQueue` 已接入 G1 persist/API；**正文裸 `@` 不参与选人**
  - [ ] **S3** 插件注册命令（如 `plot-summary` `/summary 36-55`）；输入历史存 raw 提交
  - [x] **S4** Composer `/` 补全菜单（`#composer-slash-layer` + CSS anchor、`60dvh`、两行列表）

### 通知中心（Notification Center）

定案见 [`DOC/40`](40-notification-center.md)。**仅 `host.ui.notify`**（**删除 `toast`**，无兼容层）：每条写通知中心；`snackbar` 默认 `true`；静默显式 `snackbar: false`；snackbar 互动钮 → 已读。

| 层 | 状态 |
|----|------|
| **发送** | ✅ 仅 `notify`（删 `toast`）；默认 snackbar；`snackbar: false` 静默 |
| **存储** | ✅ `notification-storage.ts` envelope |
| **UI** | ✅ 顶栏 bell + 列表 + 带操作钮 snackbar |
| **插件契约** | ✅ `create-plugin-web-host` · bundled 插件已迁 |

**推荐顺序**：~~NC0~~ → ~~NC1~~ → ~~NC2~~ → ~~NC3~~ → ~~NC4~~ → ~~NC5~~ → **NC-V** 验收。

#### NC0 · 盘点（先行）

- [x] **NC0** — 全库 `toast` / `notify` 调用点清单（含 bundled 插件）；迁移：`toast` → `notify(title, undefined, opts)`；静默场景标 `snackbar: false`；定案 §3.1 · §4.2

#### NC1 · 存储层

- [x] **NC1** — `web/src/utils/notification-storage.ts`：`{ schemaVersion, unreadCount, items[] }` · 键 `arousal-notifications-{userId}` · 登出随 `clearUserSessionLocalStorage` 清除 · 条数上限裁剪（如 200）

#### NC2 · Store / API

- [x] **NC2** — Pinia `notification-center` store：`send` / `list` / `markRead` / `delete` / `unreadCount` · 变更订阅（供角标/列表）

#### NC3 · 顶栏 UI

- [x] **NC3** — 顶栏 bell 未读角标 · 通知列表抽屉/菜单 · snackbar（关闭/操作钮 → markRead）· 单条/批量已读·删除 · 空态 · i18n

#### NC4 · 多 Tab 同步

- [x] **NC4** — 同浏览器多 Tab：`window` `storage` 事件同步未读角标与列表

#### NC5 · `host.ui` 迁移

- [x] **NC5** — **删除** `host.ui.toast` / `PluginToastOptions` · 实现 `notify`（写中心 + 默认 snackbar）· 全库改调用（plot-summary / guidance-generate / conversation-export / swipe-cleaner / Web 核心）· `DOC/18` · `DOC/10`

#### NC-V · 验收

- [ ] **NC-V** — storage/store 单测 · 手动：`notify` → 角标 · snackbar 点关闭已读 / 超时仍未读 · 登出清空 · `npm run check:ci`

#### NC-F · 后续（非阻塞 · 择机）

- [ ] **NC-F1 宿主核心场景** — 独立 snackbar 迁入通知中心；方案见 [`DOC/45`](45-notification-center-core-migration.md)（`coreNotify` · action 执行 · 6 文件 ~35 处）
  - [ ] **NC-F1.0** — Store 队列 + **`v-snackbar-queue`** 单例 · `persist` · 图标关闭 · 废除 `pluginSnackbar`
  - [ ] **NC-F1.1** — `PluginUiHost` / `NotificationBell` 执行 `action`
  - [ ] **NC-F1.2** — `PromptsView` · `CharactersView` · `ChatConversationView`
  - [ ] **NC-F1.3** — `ConnectionSettingsCard`
  - [ ] **NC-F1.4** — `ImportSettingsPanel`（含跳转操作）
  - [ ] **NC-F1.5** — 群聊提示（`use-chat-outbound`）
  - [ ] **NC-F1.6** — memory 重建完成可选通知
  - [ ] **NC-F1.V** — 验收（§6 `DOC/45`）
- [ ] **NC-F2 Server → Web 推送（可选）** — SSE/响应体 `notifications[]` → 前端入库（仍写 localStorage；v1 无 REST 持久化）
- [ ] **NC-F3 增强** — `dedupeKey` 合并 · `expiresAt` 清理 · 按 plugin/level 筛选 · 移动端系统通知（若需要）

## P1

- [ ] **ST 聊天记录群聊多 bot 导入** — 当前 ST JSONL 导入全部 segment 绑定 `characterIds[0]`；需按 ST `name` 与会话 `characterIds`/`displayNames` 映射各 bot 为 speaker（单 bot 行为不变）。见 [`DOC/37`](37-st-import-settings-tab.md)
- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2

- [ ] **作者注分层** [`DOC/28`](28-authors-note-layers.md) — Phase 2 角色 AN + `{{charAuthorsNote}}`（Phase 1 全局 default ✅）
- [ ] **角色卡内嵌世界书** [`DOC/27`](27-embedded-character-book.md) — Phase 1 组装（constant + keyword、`position`、叠加内嵌优先）；Phase 2 角色库查看 / 编辑 UI
- [ ] **用户文件库** [`DOC/20`](20-user-file-library.md) M1–M5

> ST 导入 Tab / 世界书 / 聊天记录 / M3 回归已关闭，见下方 **§文档**（2026-06～07 · [`DOC/37`](37-st-import-settings-tab.md)）。

## P3

- [ ] **移动端兼容性修复（iOS）** — `DOC/33` §6（iOS 软键盘空白 · 2026-06-25 友测 · 2026-07 降 P3）：~~窄屏 grid/rail overlay~~（已落地）。**待做**：
  - **现象**：iOS Safari 对话页 — ① 键盘未弹出时 `app-footer`（Arousal Pub）下方仍有大块黑区（至浏览器底栏）；② 键盘弹出后 composer 与键盘之间空白，常夹 Safari 自动填充条
  - **根因（分析）**：`.v-application__wrap` 死锁 `100dvh` + Vuetify `app` 顶/底栏相对 **layout viewport**，未跟踪 **visual viewport**；对话页双层底栏（`.chat-footer` + `v-footer.app-footer`）；`index.html` viewport 无 `interactive-widget`；无 `visualViewport` JS；`safe-area` 仅 composer 有、`app-footer` 无
  - **约束**：**不可隐藏 `app-footer`**（插件入口依赖页脚）；方案须在保留双层底栏前提下适配
  - **候选方向**：① viewport `interactive-widget=resizes-content` 试验；② `visualViewport` → CSS 变量替换死 `100dvh`；③ 顶栏/页脚/composer 统一 `safe-area-inset`；④ 验收矩阵：iOS Safari × 键盘开/关 × 地址栏显/隐
- [ ] **远期记忆 Lance 分片写入** — 当前保留重建后 / `sealChunkMemorySegment` 时的 best-effort `optimize`；待官方 TS 版本暴露 `targetRowsPerFragment` / `maxRowsPerGroup` 后接入可控 compaction，避免大量几十 KB 小 fragment 或单个过大 fragment（见 `DOC/03` §14.5）
- [ ] **【待讨论】插件后台任务与对话并发** — 例：Historian（`plot-summary`）自动摘要在落盘 idle 后启动，但 **`pluginHold` 会挡住 composer 发新消息**；插件在浏览器内跑、无服务端 job 队列；同会话 chunk **无** per-conversation 读写锁（`prepare-context` 读 turn vs `/api/chat` 落盘）。待议：是否允许摘要与聊天并行、是否弱化/取消 hold、是否引入服务端任务队列或 `runScope({ writeLock: false })` + 会话级锁；见 `DOC/09` §5.1 · `DOC/10` · `plugins/plot-summary/src/lifecycle.ts`
- [ ] ST 宏扩展备忘 [`DOC/14`](14-st-macros-porting.md)；Embedding MRL / Reranker / Qwen instruct（低优先级）
- [ ] **沙箱 Phase C（可选）** — 包内自维护 API（[`DOC/38`](38-plugin-sandbox-and-host-evolution.md) A3 · 已归档延后项）
- [ ] **CI 宿主门禁（可选）** — GitHub Actions 接 `check:host-no-plugin-ids` · `verify-host-build-without-bundled`（[`DOC/42`](42-host-generic-audit-checklist.md)）

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
- [x] 对话分支第三轮审计关闭（2026-06-18）：`branchForkTurnIds`、深树 `GET /branches` 批量构建、`rollbackDeleteBranchRegistry` — 见 `DOC/23` §9.3
- [x] 落盘 persist 同步 `turnId`（2026-06-23 · `15c7900`）：修复新助手落盘后「从此处分支」禁用直至刷新 — `ChatPersistResult.turnId` · `applyPersistTurnPlugins` · 见 `DOC/23` §6.4、`DOC/03` §6.8
- [x] 分支树轮次副标题 from/to/total（2026-06-23 · `15c7900`）：`ChatBranchPanel` · `branchTurnRangeParts` · i18n `turnRange` / `turnRangeMain` · 见 `DOC/23` §6.4
- [x] 会话级 Composer 输入历史（置顶/最近 · 可配置上限）（2026-06-25 · `ccff961`）：`composer-input-history-storage` · `ChatComposerInputHistoryMenu` · 点发送写入 · 与 turns 分离
- [x] 向量召回设置独立 Tab 与信息架构对齐（2026-06-25 · `d276720`）：全局/对话 `vectorRecall` Tab · Tab 顺序「对话历史 → 资料库 → 向量召回」· 向量召回内分块（远期记忆 / 资料库 / API）· 对话「对话历史」Tab 与全局对齐 · `vuetify-overrides` 统一 switch 标签样式 — 见 `DOC/03` §9.6
- [x] 指导生成 · 指导修改（2026-07-01）：`guidance-generate` `mode: 'revise'` · `assistant-turn-footer` · `reviseSystemPrefix` 设置项 · `DOC/09` §7.1、`DOC/18` §3.3
- [x] Web 首屏 bundle 体积优化（2026-07-01 · **已验收关闭**）：入口 JS ~1.55 MB → `index` ~190 KB（gzip ~59 KB）；`manualChunks`（vuetify / virtua / vue-i18n / vue-vendor / marked）· 路由与模态懒加载 · i18n 分 locale · `npm run build:analyze`。**不追** `@mdi/font` → `@mdi/js`（woff2 ~403 KB 保留）
- [x] 群聊设计定案（2026-07-01）：`DOC/35-group-chat.md` — segment 模型、`/@`、裸 `@` 关闭、`[NEXT@Name]`、G0–G4 里程碑
- [x] Composer Slash S0–S2/S4（2026-07-01）：`submitComposer`、`/goto`、`/@`、补全浮层 — 见 [`DOC/36`](36-composer-slash.md)；**S3 插件执行**仍开放
- [x] 架构/接口变更时同步 `DOC/01`–`03`（2026-07-02）：预设编辑/全局分离、`chat.index` 写锁与列表统计、群聊成员头像 — 见 `DOC/03` §1.2、§7.1、§15.10 · `DOC/35` §2.2
- [x] 群聊选人模型修订定案（2026-07-02）：`speakerMode` 三选一、掷骰竞标、额度与不连说、`next@` hint 失败仅手动 — 见 `DOC/35` §2.6–§3、§8
- [x] 群聊 G3/G4 实现 + audit 按 segment 落盘（2026-07-03）：`groupChatTurnState` · 掷骰 roster · `ChatTurnPromptDialog` 群聊 Tab · `(turnId, segmentIndex)` 去重 — 见 `DOC/24` §3.2–§3.4、`DOC/35` §7
- [x] 群聊 G3/G4 审计修复（2026-07-03）：regen 截断重建 `groupChatTurnState` · Continue 额度前后端对齐 · shared `group-chat-settings` — commit `2189d2a`
- [x] 群聊代码模块化 + `sync-all-shared`（2026-07-03）：`server/src/group-chat/*` · G2 死代码清理 · `patchRegenSegments` — commit `97937ed` · 见 `DOC/35` §7.1
- [x] **远期记忆批量索引进度条**（2026-07-04 · `8fffdd0`）：`reindexConversationMemory` 分阶段 `onProgress`（planning / collecting_turns / embedding_turns / writing_turns / embedding_lorebooks / finalizing）· `embedTextsInBatches` 批次回调 · SSE `memory/rebuild?stream=1` · `useMemoryRebuild` + 对话页/设置页进度条与 stage 文案
- [x] **远期记忆尾段 buffer 文档同步**（2026-07-04）：`DOC/23` §4.4 / §5.1 · `DOC/03` §14.5.1 / §14.7；运行时 buffer 已于 `c3a3c4f` 移除
- [x] **角色库 userCardList 全链路**（2026-07-04）：Index/API · 角色库 UI · 新建会话 picker 默认 · 单测 — 见 `DOC/03` §12.2–§12.5
- [x] **远期记忆尾段 buffer 死代码清理**（2026-07-04 · `40407e6`）：删除 `memory-tail-buffer.ts` · `sealChunkMemorySegment` / 增量 upsert 迁入 `memory-index.ts` — 见 `DOC/23` §4.4 · §5.1
- [x] **Sandbox + 宿主去特化归档**（2026-07-08）：[`DOC/04`](04-TODO.md) §已归档 · [`DOC/38`](38-plugin-sandbox-and-host-evolution.md) · [`DOC/42`](42-host-generic-audit-checklist.md) · [`DOC/43`](43-plugin-api-binding-audit-checklist.md)
- [x] **ST 导入 Tab 全链路**（2026-06～07）：设置页「导入」· ST 世界书 / 聊天记录 / 预设跳转 · M3 回归 — 见 [`DOC/37`](37-st-import-settings-tab.md)
- [x] **迹录 segment 级 TK-O1 + 主线闭环**（2026-07-08）：多 segment transcript / resolveLiveTraceStates / Separate 目标 segment 剥块 — 见 [`DOC/30`](30-plugin-trace-keeper.md) §10 · [`DOC/35`](35-group-chat.md) §6 · [`DOC/44`](44-turn-segment-only-storage.md)
- [x] **迹录 TK-F + UI/pinned 收尾**（2026-07-08）：outgoing/memory 多 segment 单测 · 侧栏 segment E2E · 槽位迁 `assistant-turn` · 同会话新回复 live tail 取消 pinned（`50725a0`）— 见 [`DOC/30`](30-plugin-trace-keeper.md) §4.3 · §6.2
- [x] **兼容/过渡代码大清理**（2026-07-08 · 未提交）：`.cursor/rules/no-compatibility-code.mdc` · 预设 granular 槽 · TK-D · audit/密钥/FTS/宏/ Historian 后缀等；审计清单 [`.tmp/compatibility-code-audit.md`](../.tmp/compatibility-code-audit.md) · 同步 `DOC/03` §6/§13/§14/§15 · `DOC/25` §15.2 · `DOC/29` · `DOC/12` §4.2

## 已归档（原 P0 / 实现清单 · 勿再在本文件维护细项）

| 项 | 完成 | 归档去向 |
|----|------|----------|
| **角色库用户卡标记（`userCardList`）** | 2026-07-04 | [`DOC/03`](03-实现细节.md) §12.2–§12.5 · `server/test/character-user-card-list.test.ts` |
| **群聊 G0–G5**（segment · `speakerMode` · `/@` · Continue · 宏 · audit） | 2026-07-03 | [`DOC/35`](35-group-chat.md) · [`DOC/03`](03-实现细节.md) §6.8 · [`DOC/24`](24-regex-and-session-audit.md) §3 |
| **对话分支（消息树）** S1–S5 + 验收 + 三轮审计 | 2026-06-18 | [`DOC/23`](23-conversation-branches.md) 全文 · §9 审计 |
| **新落盘助手回复下分支图标禁用** | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 persist `turnId` |
| **分支树轮次副标题**（fork / 末轮 / 独有轮数） | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 · `branch-tree-utils.ts` |
| **向量召回设置独立 Tab** | 2026-06-25 · `d276720` | [`DOC/03`](03-实现细节.md) §9.6 · `SettingsView` / `ConversationContextSettings` |
| **远期记忆重建 SSE 进度条** | 2026-07-04 · `8fffdd0` | [`DOC/03`](03-实现细节.md) §14.5.1 · `memory-reindex-sse.ts` · `useMemoryRebuild.ts` |
| **DOC/39 二次 LLM 上下文 + 拼 prompt**（Historian + trace-keeper Separate · `completeWithContext`） | 2026-07-07 | [`DOC/39`](39-plugin-context-and-prompt-assembly.md) §6 · `sandbox` 分支 commit `de8e1f7` / `3847d0f` |
| **Sandbox Phase A+B**（注入描述符 · Worker 沙箱 · DOC/43 交叉项） | 2026-07-08 | [`DOC/38`](38-plugin-sandbox-and-host-evolution.md) · [`DOC/43`](43-plugin-api-binding-audit-checklist.md) · **延后**：包内自维护 API（A3） |
| **宿主去特化 Phase 0–3**（`check:host-no-plugin-ids` · serverActions · schema 壳） | 2026-07-07 | [`DOC/41`](41-plugin-host-generic-principles.md) · [`DOC/42`](42-host-generic-audit-checklist.md) · **可选**：GitHub Actions 接入门禁 |
| **迹录 segment 级（TK0–TK-F）** | 2026-07-08 | [`DOC/30`](30-plugin-trace-keeper.md) §10 · [`DOC/44`](44-turn-segment-only-storage.md) · [`DOC/35`](35-group-chat.md) §6 · `430849b` / `9065626` / `50725a0` |
