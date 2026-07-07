# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表、本文 **§已归档**。

## Sandbox（`DOC/38` · **Phase A + B 已完成（含 B3+）**）

> **说明**：远程分支 `sandbox` 用于近期插件/DOC 落地提交；**本节**指 [`DOC/38`](38-plugin-sandbox-and-host-evolution.md) 的**插件沙箱化 + 组装注入描述符**工程。**Phase A、Phase B（含 B3+）已落地**。  
> **顺序定案**：前置 DOC/39 → **Phase A 注入** → **Phase B Worker 沙箱**。

### 前置（已满足 · 非 Sandbox 本体）

- [x] **DOC/39** 二次 LLM 上下文 + Prompt 组装 — `prepareContextBlocks` / `assemblePluginPrompt` / `completeWithContext`；Historian + trace-keeper Separate 已迁；见 [`DOC/39`](39-plugin-context-and-prompt-assembly.md) §6

### Phase A — 注入描述符 + §6.6 chat depth（**✅ 已完成**）

宿主 `resolveAfterAssemblePromptsAddition` 返回 **`PluginPromptInjection[]`**（`chat` depth + `injectionOrder`），post-user 区归并 splice；裁切前 token 预留逻辑不变。详 [`DOC/38`](38-plugin-sandbox-and-host-evolution.md) §3。

- [x] **A0 契约** — `PluginPromptInjection` 类型；`plugin-prompt-injection-merge.ts` 归并器（复用 `resolveChatDepthInsertIndex` / `compareInjectionEntries`）
- [x] **A1 宿主元数据** — `chat-assemble` 向 apply 传入 `trimmedHistoryMessages` / `historySpan`；`applyPluginsAfterAssemblePrompts` 走归并器（legacy `ChatMessage[]` 暂映射 `injectionOrder` 500）
- [x] **A2 guidance-generate** — 迁描述符：depth **0** `injectionOrder` **10**；revise assistant **11** + system **12**；移除整表 `afterAssemblePrompts` 主路径
- [x] **A3 trace-keeper Together** — depth **0** `injectionOrder` **500**（显式描述符，替代 legacy append）
- [x] **A4 单测** — 多插件 `injectionOrder` 共存、群聊 `afterUserInput`、revise 双条、`additionCache` / token 预留
- [x] **A4+ afterUserInput 审计** — regex 后 synthetic 解析群聊 / depth 0 作者注正文；hoist 精确匹配，避免误标 preset / authorsNote

**`injectionOrder` 默认值（暂硬编码 · 小=近 user · 大=近栈底）**：省略 **100** · guidance **10** · revise **11 / 12** · 群聊 afterUserInput **20** · trace-keeper **500** · preset tail（无元数据）**100**。

- [ ] **注入 `injectionOrder` 可配置化** — 上述档位现分散在插件常量与 `plugin-prompt-injection-merge.ts`；后续改为 manifest 策略字段或宿主/设置页可配（含群聊 afterUserInput、preset 元数据、revise 子档）

### Phase B — 服务端 Worker 沙箱（P0 · 依赖 A · **✅ 已完成**）

- [x] **B0 Worker 运行时** — `plugin-worker-bootstrap.mjs` 加载 `dist/server.mjs`；`plugin-worker-protocol.ts` 结构化 IPC
- [x] **B1 Host API 代理** — `plugin-worker-client.ts` 分发 settings / complete / regex / macro / `completeWithContext`
- [x] **B2 安装路径** — `loader.loadPluginServerModule`：bundled 与第三方同一 Worker 路径
- [x] **B3 回归** — `plugin-worker-sandbox.test.ts`；默认同进程 `import`；Worker 失败 fallback；`guidance-generate` `await applyPromptMacroPipeline`
- [x] **B3+** — `npm run test:sandbox -w server`（`PLUGIN_SERVER_SANDBOX=1` 全量回归，707 项通过）
- [x] **B4 加固** — userId IPC · 串行 · 超时 · STRICT
- [x] **B5 子进程 + Permission** — `fork` 替代 `worker_threads`；`--permission` 只读插件目录

### 相关（与 Sandbox 交叉 · 仍开放）

- [ ] 插件实例与 API 绑定、插件审计、fallback 策略（部分见 [`DOC/10`](10-plugin-conversation-host.md)）

### 非目标（v1 Sandbox）

- 浏览器 `web.mjs` Worker 沙箱（CSP + 宿主 API 已约束；另议题）
- 插件 capabilities 跨插件 RPC（[`DOC/09`](09-plugin-system-and-guidance-generate.md) §8.7）

---

## 宿主去特化（`DOC/41` · **P0 · 强制**）

> **定案**：[`DOC/41`](41-plugin-host-generic-principles.md) · **审计/checklist**：[`DOC/42`](42-host-generic-audit-checklist.md) · Cursor `.cursor/rules/plugin-host-generic.mdc`  
> **原则**：宿主只提供 generic 能力；**禁止** bundled 插件 id 字面量、按 id 分支、产品语义命名/路由/类型。  
> **现状（2026-07-07）**：**Phase 0–3 已完成**；§8.2 审计项 **已全部修复**；可选 CI 接入门禁（DOC/42 §6.0.2）。  
> **门禁**：`npm run check:host-no-plugin-ids`

### Phase 0 — 门禁与注释（P0）

- [x] **0.1 CI grep** — `scripts/check-host-no-plugin-ids.mjs` + `npm run check:host-no-plugin-ids`
- [x] **0.2 注释 sweep** — S-F7-* / W-F7-*（2026-07-07）
- [x] **0.3 legacy 删除** — `server/src/plot-summary/`、`plugin-prepare-context.ts`

### Phase 1 — Server

- [x] **serverActions** — `POST /api/plugins/:pluginId/actions/:action` + manifest `serverActions`
- [x] **turnPlugins merge** — `shared/turn-plugin-merge.ts` + manifest `turnPlugins`
- [x] **删 trace 专用路由** — `plugin-action-route.ts` 替代
- [x] **lifecycle** — `onCharacterPrimaryChanged` 分发
- [x] **persist extras** — `resolveConversationPersistExtras` hook
- [x] **bundled-registry** — loader/registry 读 `plugins/bundled-registry.json`
- [x] **migrate-plot-summary** — `scripts/migrate-curated-memory-to-plot-summary.ts` + `npm run migrate:curated-memory`

### Phase 2 — Web 宿主

- [x] **eagerOnRoutes** — registry 暴露 + `usePluginHost({ routeKeys: ['chat'] })`
- [x] **chat plugins 载荷** — `Record<string, unknown>`
- [x] **persist-display** — 仅 `persist.plugins` 透传
- [x] **设置壳** — schema widget（`bundleSelect` / `companionPanel` 等 · DOC/42 §2 W-X）

### Phase 3 — 类型与单测

- [x] **draft.kind** — shared 改为 opaque `string`
- [x] **单测 fixture** — 宿主测试 `fixture-plugin-*`
- [x] **Web actions** — `host.plugin.runAction`（trace-keeper 已迁）

### DoD

- [x] DOC/41 §8 CI grep 零命中
- [x] DOC/41 §7 三问 — DOC/42 §8.2 已修复
- [ ] GitHub Actions 接入门禁（可选；本地 **`npm run check:ci`**）

---

## P0 余项
- [ ] **Composer Slash 命令** — 定案见 [`DOC/35`](35-group-chat.md) §2.3（群聊 `/@`）；输入框 `/` 命令层（与聊天 turns、输入历史分离）
  - [x] **S0** 宿主 `submitComposer` 统一入口 + 命令解析/路由（raw → 命令 + 剩余正文）
  - [x] **S1** 内置 `/goto N` 跳转轮次
  - [x] **S2** 内置 `/@ Name [Name…]` — 解析 + strip；`speakerQueue` 已接入 G1 persist/API；**正文裸 `@` 不参与选人**
  - [ ] **S3** 插件注册命令（如 `plot-summary` `/summary 36-55`）；输入历史存 raw 提交
  - [x] **S4** Composer `/` 补全菜单（`#composer-slash-layer` + CSS anchor、`60dvh`、两行列表）
- [ ] **迹录（trace-keeper）助手消息级状态** — 群聊同 turn 多 segment 时，侧栏 live / pinned 与历史注入仍按 **turn + activeReceive** 解析，只能看到**最后发言 bot** 的 tracker；需改为 **segment / receive 级**（与 swipe 变体同一套 `receiveId` 键，但 UI 与 resolve 未走 `segments[]`）。定案见 [`DOC/30`](30-plugin-trace-keeper.md) §4 · [`DOC/35`](35-group-chat.md) §2.1、§6 · `plugins/trace-keeper/`
  - **现状**：落盘已有 `turn.plugins[]` + `payload.receiveId`（`mergeTurnPluginEntry`）；群聊 `appendSegmentToTurn` 每段独立 receive；**缺口**在插件 resolve / 侧栏仍读 `turn.receives` + `activeReceiveIndex`，未按 `activeSegmentIndex` 遍历 `turn.segments[]`
  - [ ] **TK0 审计** — 群聊 3 segment 同 turn 落盘后 chunk 内 `turn.plugins` 是否保留 3 条 trace；列缺口清单（panel / separate / patch / sync-from-assistant）
  - [ ] **TK1 Resolve 锚点** — `trace-state-resolve.ts` · `panel-empty.ts`：新增 `resolveTraceForSegment(turn, segmentIndex, epoch)`（经 segment 的 `receives[activeReceiveIndex].id` 查 plugins）；live 群聊跟随 `activeSegmentIndex`，单段 turn 行为不变
  - [ ] **TK2 侧栏 UX** — pinned 支持 `(turnOrdinal, segmentIndex)` 或 segment 内 prev/next；Handlebars `meta` 增 `speakerCharacterId` / `segmentIndex` / `receiveId`；空态 / Separate 指向当前 segment 非整轮
  - [ ] **TK3 API 与写回** — `regenerate-separate` · `patch-state` · `turn-plugin-sync-from-assistant` 接受 `segmentIndex` 或 `receiveId`；写回仅改对应 segment 的 assistant 块；确认 Continue / regen 不覆盖其它 segment 的 plugins 条目
  - [ ] **TK4 组装注入（按需）** — 若产品要求下一段 bot 看见各 segment tracker：`resolveLiveTraceStates` 按 segment 展开（非每 turn 一条）；与 outgoing 正则保留 `<ex-trace-keeper>` 策略对齐
  - [ ] **TK5 验收** — 群聊同 turn 多 bot 各段 state 可切换查看 + Separate；单 bot / swipe 无回归；补 `plugins/trace-keeper/test/` 与 persist 集成用例

## P1

- [ ] **通知中心**（[`DOC/40`](40-notification-center.md)）— 统一通知发送与管理：**localStorage**（`arousal-notifications-{userId}`）、已读/未读、删除；顶栏列表 UI；`host.ui.notify` 迁入（现等同 toast）
- [ ] **ST 聊天记录群聊多 bot 导入** — 当前 ST JSONL 导入全部 segment 绑定 `characterIds[0]`；需按 ST `name` 与会话 `characterIds`/`displayNames` 映射各 bot 为 speaker（单 bot 行为不变）。见 [`DOC/37`](37-st-import-settings-tab.md)
- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2

  - [x] **迁移** — 定案 [`DOC/37`](37-st-import-settings-tab.md)：设置页 **「导入」Tab**（仅 ST 聊天记录 / ST 世界书 / ST 提示词预设）
  - [x] **Tab 壳 + ST 预设跳转** — `SettingsTab: 'import'` · `ImportSettingsPanel` · `uiContext.requestOpenPromptsImport` → 关设置 · 开提示词库 · `performImportPickFile()`
  - [x] **ST 世界书** — `st-lorebook-import.ts` · `POST /api/lorebooks/import-st`（preview + import）；`comment→title`、`disable→enabled`、无 key + `vectorized` → `triggerMode: 'vector'`；导入后 reindex
  - [x] **ST 聊天记录** — SillyTavern JSONL → chunk / `TurnRecord`（开场 + 正文；可选 `reasoning`、`durationMs`）；导入前绑定 `userCharacterId` / `characterIds`；不含 model、swipe、插件 `extra`；流式读 JSONL + 批量写 chunk
  - [x] **M3 回归与打磨** — multipart 50MB、聊天 preview/import 共用逐行状态机 + import 按 chunk 流式落盘（无 turn 上限）、解析只保留导入字段、失败清理空会话与 index 回滚、warnings/错误码 UI、世界书 3000 条上限
- [ ] **作者注分层** `DOC/28` — Phase 2 角色 AN + `{{charAuthorsNote}}`（Phase 1 全局 default ✅）
- [ ] **角色卡内嵌世界书** `DOC/27` — Phase 1 组装（constant + keyword、`position`、叠加内嵌优先）；Phase 2 角色库查看 / 编辑 UI
- [ ] **用户文件库** `DOC/20` M1–M5

## P3

- [ ] **移动端兼容性修复（iOS）** — `DOC/33` §6（iOS 软键盘空白 · 2026-06-25 友测 · 2026-07 降 P3）：~~窄屏 grid/rail overlay~~（已落地）。**待做**：
  - **现象**：iOS Safari 对话页 — ① 键盘未弹出时 `app-footer`（Arousal Pub）下方仍有大块黑区（至浏览器底栏）；② 键盘弹出后 composer 与键盘之间空白，常夹 Safari 自动填充条
  - **根因（分析）**：`.v-application__wrap` 死锁 `100dvh` + Vuetify `app` 顶/底栏相对 **layout viewport**，未跟踪 **visual viewport**；对话页双层底栏（`.chat-footer` + `v-footer.app-footer`）；`index.html` viewport 无 `interactive-widget`；无 `visualViewport` JS；`safe-area` 仅 composer 有、`app-footer` 无
  - **约束**：**不可隐藏 `app-footer`**（插件入口依赖页脚）；方案须在保留双层底栏前提下适配
  - **候选方向**：① viewport `interactive-widget=resizes-content` 试验；② `visualViewport` → CSS 变量替换死 `100dvh`；③ 顶栏/页脚/composer 统一 `safe-area-inset`；④ 验收矩阵：iOS Safari × 键盘开/关 × 地址栏显/隐
- [ ] **远期记忆 Lance 分片写入** — 当前保留重建后 / `sealChunkMemorySegment` 时的 best-effort `optimize`；待官方 TS 版本暴露 `targetRowsPerFragment` / `maxRowsPerGroup` 后接入可控 compaction，避免大量几十 KB 小 fragment 或单个过大 fragment（见 `DOC/03` §14.5）
- [ ] **【待讨论】插件后台任务与对话并发** — 例：Historian（`plot-summary`）自动摘要在落盘 idle 后启动，但 **`pluginHold` 会挡住 composer 发新消息**；插件在浏览器内跑、无服务端 job 队列；同会话 chunk **无** per-conversation 读写锁（`prepare-context` 读 turn vs `/api/chat` 落盘）。待议：是否允许摘要与聊天并行、是否弱化/取消 hold、是否引入服务端任务队列或 `runScope({ writeLock: false })` + 会话级锁；见 `DOC/09` §5.1 · `DOC/10` · `plugins/plot-summary/src/lifecycle.ts`
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
- [x] **远期记忆批量索引进度条**（2026-07-04 · `8fffdd0`）：`reindexConversationMemory` 分阶段 `onProgress`（planning / collecting_turns / embedding_turns / writing_turns / embedding_lorebooks / finalizing）· `embedTextsInBatches` 批次回调 · SSE `memory/rebuild?stream=1` · `useMemoryRebuild` + 对话页/设置页进度条与 stage 文案
- [x] **远期记忆尾段 buffer 文档同步**（2026-07-04）：`DOC/23` §4.4 / §5.1 · `DOC/03` §14.5.1 / §14.7；运行时 buffer 已于 `c3a3c4f` 移除
- [x] **角色库 userCardList 全链路**（2026-07-04）：Index/API · 角色库 UI · 新建会话 picker 默认 · 单测 — 见 `DOC/03` §12.2–§12.5
- [x] **远期记忆尾段 buffer 死代码清理**（2026-07-04 · `40407e6`）：删除 `memory-tail-buffer.ts` · `sealChunkMemorySegment` / 增量 upsert 迁入 `memory-index.ts` — 见 `DOC/23` §4.4 · §5.1

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
