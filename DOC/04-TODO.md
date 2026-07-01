# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表、本文 **§已归档**。

## P0 余项

- [ ] **指导生成插件 · 指导修改** — `guidance-generate` 新增「指导修改」模式（与现有 send/regenerate 并列）：
  - **输入**：用户填写指导文；目标为**当前轮助手回复**（含 swipe 当前选中项 `activeReceiveIndex` 正文）
  - **组装**：将本次回复作为上下文中的 **assistant 消息**注入（非从零生成）；再附指导 system，要求 LLM **在保留大意前提下按指导修正细节**（措辞、情节、语气等）
  - **触发**：composer / 助手 turn footer 入口（与现有指导弹框对齐）；可走 `regenerateWithPlugins` 或专用 `mode: 'revise'` + 宿主 API（若需不增 swipe 而覆盖当前 receive，需与产品定案）
  - **落盘**：`turn.plugins[].payload` 扩展 `mode` / `guidanceText`；审计与 `DOC/09` §7.1、`DOC/18` 同步

## P1

- [ ] **Web 首屏 bundle 体积优化（Vite chunk > 500KB 警告）** — ~~单次 JS ~1.55MB（gzip ~462KB）~~ → 已拆块：入口 `index` ~190KB（gzip ~59KB）、`vuetify` ~286KB、`ChatConversationView` 路由懒加载 ~243KB；CSS 拆为 `index` ~371KB + `vuetify` ~403KB。余项：**⑤** `@mdi/font` → `@mdi/js` 按需 SVG（woff2 ~403KB）。已完成：① `npm run build:analyze`（`rollup-plugin-visualizer` → `.tmp/vite-bundle-stats.html`）；② `main.ts` 去掉 Vuetify 全量 import；③ 路由 + `App.vue` 懒加载；④ `manualChunks`；⑥ i18n 按 locale 动态 `import()`。
- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2

- [ ] **Composer Slash 命令** — 输入框 `/` 命令层（与聊天 turns、输入历史分离）：宿主 `submitComposer` 统一入口 + 命令解析/路由；内置通用命令如 `/goto N` 跳转轮次；业务命令由插件注册（如 `plot-summary` 的 `/summary 36-55`）；输入历史已存 raw 提交，P2 落地时复用。见对话中架构讨论
- [ ] **群聊** — ST 式多角色发言轮次与 `{{group}}` / `{{groupNotMuted}}` / `{{charIfNotGroup}}` 等宏语义；当前仅 `characterIds[]` 多卡绑定与注入，见 `DOC/14` §1、`DOC/26`
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
- [ ] 架构/接口变更时同步 `DOC/01`–`03`（2026-06-10：内嵌世界书 `DOC/27`、作者注分层 `DOC/28`）

## 已归档（原 P0 / 实现清单 · 勿再在本文件维护细项）

| 项 | 完成 | 归档去向 |
|----|------|----------|
| **对话分支（消息树）** S1–S5 + 验收 + 三轮审计 | 2026-06-18 | [`DOC/23`](23-conversation-branches.md) 全文 · §9 审计 |
| **新落盘助手回复下分支图标禁用** | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 persist `turnId` |
| **分支树轮次副标题**（fork / 末轮 / 独有轮数） | 2026-06-23 · `15c7900` | [`DOC/23`](23-conversation-branches.md) §6.4 · `branch-tree-utils.ts` |
| **向量召回设置独立 Tab** | 2026-06-25 · `d276720` | [`DOC/03`](03-实现细节.md) §9.6 · `SettingsView` / `ConversationContextSettings` |
