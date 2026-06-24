# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表、本文 **§已归档**。

## P0 余项

- [ ] **向量召回选项独立 Tab** — 将远期记忆 hybrid、资料库 vector/keyword、Hybrid FTS 分词、命中测试等**向量召回相关**设置从「上下文」等大杂烩 Tab 拆出为独立 Tab（全局 `SettingsView` + 对话 `ConversationContextSettings` 对齐）；降低认知负担，与命中测试/组装审计同一信息架构
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
- [x] 对话分支第三轮审计关闭（2026-06-18）：`branchForkTurnIds`、深树 `GET /branches` 批量构建、`rollbackDeleteBranchRegistry` — 见 `DOC/23` §9.3
- [x] 落盘 persist 同步 `turnId`（2026-06-23 · `15c7900`）：修复新助手落盘后「从此处分支」禁用直至刷新 — `ChatPersistResult.turnId` · `applyPersistTurnPlugins` · 见 `DOC/23` §6.4、`DOC/03` §6.8
- [x] 分支树轮次副标题 from/to/total（2026-06-23 · `15c7900`）：`ChatBranchPanel` · `branchTurnRangeParts` · i18n `turnRange` / `turnRangeMain` · 见 `DOC/23` §6.4
- [ ] 架构/接口变更时同步 `DOC/01`–`03`（2026-06-10：内嵌世界书 `DOC/27`、作者注分层 `DOC/28`）

## 已归档（原 P0 / 实现清单 · 勿再在本文件维护细项）

| 项 | 完成 | 归档去向 |
|----|------|----------|
| **对话分支（消息树）** S1–S5 + 验收 + 三轮审计 | 2026-06-18 | [`DOC/23`](23-conversation-branches.md) 全文 · §9 审计 |
| **新落盘助手回复下分支图标禁用** | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 persist `turnId` |
| **分支树轮次副标题**（fork / 末轮 / 独有轮数） | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 · `branch-tree-utils.ts` |
