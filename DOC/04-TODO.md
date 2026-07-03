# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表、本文 **§已归档**。

## P0 余项

- [ ] **Composer Slash 命令** — 定案见 [`DOC/35`](35-group-chat.md) §2.3（群聊 `/@`）；输入框 `/` 命令层（与聊天 turns、输入历史分离）
  - [x] **S0** 宿主 `submitComposer` 统一入口 + 命令解析/路由（raw → 命令 + 剩余正文）
  - [x] **S1** 内置 `/goto N` 跳转轮次
  - [x] **S2** 内置 `/@ Name [Name…]` — 解析 + strip；`speakerQueue` 已接入 G1 persist/API；**正文裸 `@` 不参与选人**
  - [ ] **S3** 插件注册命令（如 `plot-summary` `/summary 36-55`）；输入历史存 raw 提交
  - [x] **S4** Composer `/` 补全菜单（`#composer-slash-layer` + CSS anchor、`60dvh`、两行列表）
- [ ] **群聊** — 定案 [`DOC/35`](35-group-chat.md)；当前仅 `characterIds[]` 多卡绑定；ST 宏见 `DOC/14` / `DOC/26`
  - [x] **G0 轮次模型** — `AssistantSegment` + `speakerCharacterId`；chunk/turn 迁移；UI 多气泡；regenerate/swipe 仅当前 segment
  - [x] **G1 `/@` + Continue** — Slash S0/S2；未开群聊默认 char1、`/@` 强制 1 段 + toast；`groupContinue` API + 手动 Continue 条
  - [x] **G2 随机 + 衰减** — `groupChat` settings、权重/mute、顶栏 bot 列表；`autoContinue`；`{{group}}` / `{{groupNotMuted}}`（**过渡**：`mode: weighted` + 全局衰减 + 每 bot 1 segment，见 `DOC/35` §3.4）
  - [x] **G3 选人模型** — `speakerMode: sequential \| dice \| next@` 三选一；`/@` L0 覆盖；per-bot `speakQuota` + 掷骰竞标（§2.6）；`maxSegmentsPerTurn`；`groupChatTurnState` 落盘（2026-07-03）
  - [x] **G4 LLM 接续** — `speakerMode=next@` 全量：Continue 改选 UI、audit 掷骰表；hint 失败手动；assemble `[NEXT@]` 说明注入（2026-07-03）
  - [ ] **G5 打磨** — 群聊 assemble 按模式注入说明、预设模板、`{{notChar}}` 群聊语义

## P1

- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2

- [ ] **迁移** — 定案 [`DOC/37`](37-st-import-settings-tab.md)：设置页 **「导入」Tab**（仅 ST 聊天记录 / ST 世界书 / ST 提示词预设）
  - [ ] **Tab 壳 + ST 预设跳转** — `SettingsTab: 'import'` · `ImportSettingsPanel` · `uiContext.requestOpenPromptsImport` → 关设置 · 开提示词库 · `performImportPickFile()`
  - [ ] **ST 世界书** — `st-lorebook-import.ts` · `POST /api/lorebooks/import-st`（preview + import）；`comment→title`、`disable→enabled`、无 key + `vectorized` → `triggerMode: 'vector'`；导入后 reindex
  - [ ] **ST 聊天记录** — SillyTavern JSONL → chunk / `TurnRecord`（开场 + 正文；可选 `reasoning`、`durationMs`）；导入前绑定 `userCharacterId` / `characterIds`；不含 model、swipe、插件 `extra`；流式读 JSONL + 批量写 chunk
- [ ] **作者注分层** `DOC/28` — Phase 2 角色 AN + `{{charAuthorsNote}}`（Phase 1 全局 default ✅）
- [ ] **角色卡内嵌世界书** `DOC/27` — Phase 1 组装（constant + keyword、`position`、叠加内嵌优先）；Phase 2 角色库查看 / 编辑 UI
- [ ] 插件实例与 API 绑定、插件审计、fallback 策略（部分 host API 见 `DOC/10`）
- [ ] **用户文件库** `DOC/20` M1–M5

## P3

- [ ] **移动端兼容性修复（iOS）** — `DOC/33` §6（iOS 软键盘空白 · 2026-06-25 友测 · 2026-07 降 P3）：~~窄屏 grid/rail overlay~~（已落地）。**待做**：
  - **现象**：iOS Safari 对话页 — ① 键盘未弹出时 `app-footer`（Arousal Pub）下方仍有大块黑区（至浏览器底栏）；② 键盘弹出后 composer 与键盘之间空白，常夹 Safari 自动填充条
  - **根因（分析）**：`.v-application__wrap` 死锁 `100dvh` + Vuetify `app` 顶/底栏相对 **layout viewport**，未跟踪 **visual viewport**；对话页双层底栏（`.chat-footer` + `v-footer.app-footer`）；`index.html` viewport 无 `interactive-widget`；无 `visualViewport` JS；`safe-area` 仅 composer 有、`app-footer` 无
  - **约束**：**不可隐藏 `app-footer`**（插件入口依赖页脚）；方案须在保留双层底栏前提下适配
  - **候选方向**：① viewport `interactive-widget=resizes-content` 试验；② `visualViewport` → CSS 变量替换死 `100dvh`；③ 顶栏/页脚/composer 统一 `safe-area-inset`；④ 验收矩阵：iOS Safari × 键盘开/关 × 地址栏显/隐
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

## 已归档（原 P0 / 实现清单 · 勿再在本文件维护细项）

| 项 | 完成 | 归档去向 |
|----|------|----------|
| **对话分支（消息树）** S1–S5 + 验收 + 三轮审计 | 2026-06-18 | [`DOC/23`](23-conversation-branches.md) 全文 · §9 审计 |
| **新落盘助手回复下分支图标禁用** | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 persist `turnId` |
| **分支树轮次副标题**（fork / 末轮 / 独有轮数） | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 · `branch-tree-utils.ts` |
| **向量召回设置独立 Tab** | 2026-06-25 · `d276720` | [`DOC/03`](03-实现细节.md) §9.6 · `SettingsView` / `ConversationContextSettings` |
