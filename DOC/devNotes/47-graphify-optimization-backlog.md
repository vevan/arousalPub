# Graphify 图谱审计 — 可优化与需修复项

> **状态**：已落地（2026-08-05 · 分支 `Graphify`）  
> **更新（2026-08-17）**：三份图谱已全量重建，热点数据流与优化点见 [`52`](52-graphify-rebuild-and-chat-list-optimization.md)  
> **来源**：`/graphify` 对 `server` / `web` / `plugins` 分别建图；`server` 已用 **directed + 完整 AST 重抽** 重建  
> **索引**：[`DOC/devNotes/04`](04-TODO.md) §已归档 · §文档（原 §P0；server / web / plugins 全项）  
> **图谱产物**（本地，勿当权威业务文档）：
>
> | 范围 | 路径 |
> |------|------|
> | server | 仓库根 `graphify-out/`（`graph.html` · `GRAPH_REPORT.md` · `graph.json`；旧 `server/graphify-out/` 已于 2026-08-17 删除） |
> | web | `web/graphify-out/` |
> | plugins | `plugins/graphify-out/` |

---

## 1. 结论摘要

| 仓 | 节点 / 边（约） | 主要发现 |
|----|-----------------|----------|
| **server**（directed · 解环前） | 3089 / 10525 | **20 组 Import Cycles**；`chat-storage.ts` 出现在 19 组中 |
| **server**（directed · 2026-08-05 重跑） | ~2888 / 10253 | **Import Cycles: None**；`.graphifyignore` 排除 test；路由拆分后 `registerChatRoutes` 入度上升 |
| **web** | 3554 / 4547 | 巨型 Vue 单文件（解环前基线；Phase 7 已拆分） |
| **plugins** | 722 / 1811 | `plot-summary` / `trace-keeper` 度高质量占主导；短名 `k()` 已改 `tKey` |

**说明**：首轮 server 无向图曾出现「几乎无边」——属 AST 抽取不完整事故，**不是**业务稀疏；以 directed 重建图为准。

---

## 2. 需修复 — Import Cycles（建议最先做）

目标：打断环依赖，使存储 / 群聊 / 插件沙箱依赖方向单向化。验收：重建 server directed 图后，下列 cycle **不再出现**（或仅剩有意的类型-only 边且有文档说明）。

### 2.1 CS-P0a — `chat-storage` 中心环（最高优先）

`src/chat-storage.ts` 参与 **19/20** 个 cycle；文件出度约 231、入度约 70。

| ID | Cycle | 建议打断方式 |
|----|-------|--------------|
| CS1 | `chat-storage` ↔ `chunk-chain` | 共享类型 → `*-types`；回调用参数/接口下传，storage 不 import chain 实现 |
| CS2 | `chat-storage` ↔ `memory-index` | 同上；memory 写路径经窄 API |
| CS3 | `chat-storage` ↔ `turn-patch-body` | patch DTO / 校验与 storage 读写分层 |
| CS4 | `chat-storage` → `memory-index` → `memory-corpus` → `chat-storage` | corpus 只依赖只读 turn API |
| CS5 | `chat-storage` → `memory-index` → `chunk-chain` → `chat-storage` | 与 CS1/CS2 一并解 |
| CS6–CS9 | `chat-storage` → `group-chat-turn` → `group-chat/index` → `{audit,continue,outbound,resolve}` → `chat-storage` | **group-chat 只依赖 storage 窄 API**；storage **禁止**反向 import `group-chat/*` 实现 |

**拆分方向（建议，实现时可微调）**：

1. `chat-storage-types` / index 读写 / turn 持久化 / branch·plugin entries 分文件  
2. group-chat、memory、chunk 仅依赖「读 index + 读/写 turn」facade  
3. 保留高频入度 API 为公开面：`readConversationIndex`、`getCurrentUserId`、`normalizeBranchPath`、`getUserDataDir` 等（图上已是事实内核）

### 2.2 CS-P0b — 插件沙箱环

| ID | Cycle | 建议打断方式 |
|----|-------|--------------|
| PS1 | `plugin-system/host-api` → `loader` → `plugin-sandbox-module` → `plugin-worker-client` → `host-api` | 将 `readPluginPackageFile`（及同类）抽到**无 host 依赖**的小模块；host 与 loader 均依赖该模块 |
| PS2 | `plugin-complete-with-context` ↔ `host-api` | complete 只依赖协议/类型，或 host 侧延迟加载 |

### 2.3 子任务勾选（实现时用）

- [x] CS1–CS5：storage ↔ chunk / memory / turn-patch 解环  
- [x] CS6–CS9：storage ↔ group-chat 四环解环  
- [x] PS1：host-api ↔ loader ↔ sandbox ↔ worker 解环  
- [x] PS2：complete-with-context ↔ host-api 解环  
- [x] 回归：`npm run check:ci`（或至少 server 测试 + typecheck）  
- [x] 验收：server directed 重跑 **Import Cycles: None**；仍允许文档化单向边与 `host-api` 对 `runCompleteWithContext` 的动态 `import()`

**P0 Phase 1–4 落地摘要（2026-08-05）**

- 新模块：`chat-turn-types.ts` · `chat-turn-accessors.ts` · `turn-patch-types.ts` · `chat-storage-io.ts` · `plugin-system/plugin-package-read.ts`
- `chunk-chain` / `memory-index` / `memory-corpus` 改依赖 types+io+accessors，不再 import `chat-storage` 实现
- `group-chat/*` 的 `TurnRecord` 改自 `chat-turn-types`；`chat-storage` 曾直接 import `group-chat/{segments,resolve,audit}` + `shared/group-chat-settings`（不再经 `group-chat-turn` barrel）
- `host-api`：`readPluginPackageFile` ← `plugin-package-read`；`completeWithContext` 对 `runCompleteWithContext` 使用 `import()`
- 仍单向（非环）：`chat-storage` → `chunk-chain` / `memory-index`；`host-api` 仍 import `readConversationPluginSettings` from `chat-storage`

**P0 Phase 3 hoist 落地摘要（2026-08-05）**

- 新模块：`chat-turn-mutate.ts`（segment/receive 内存变更 + speaker sync via `group-chat/segments`）· `chat-group-turn-ops.ts`（`saveFirstTurn` / `appendConversationTurn` / `appendSegmentToTurn` / `updateTurnContentInTailChunk` / `updateTurnSegmentInTailChunk` / `mergeTurnPluginEntriesAtOrdinal` + audit/resolve 编排）
- **`chat-storage.ts` 不再 value-import `group-chat/*` 实现**（`segments` / `resolve` / `audit`）；仅保留 `shared/group-chat-settings` normalize/merge
- 调用方（`chat-persist-after-chat`、`chat-routes`、`plugin-action-route`、集成测）改从 `chat-group-turn-ops` 取高阶落盘 API
- `chat-turn-accessors` → `group-chat/segments` 薄依赖保留（`patchTurnDisplayContent` speaker sync；segments 不依赖 accessors，无环）

**审计修复（2026-08-05）**

- `turn-memory-xml` / `history-macros` / `plugin-summarize-format` / `regex-outgoing`：`getTurnUserText`/`TurnRecord` 改自 accessors+types；segment 辅助改自 `group-chat/segments`（消除 `memory-corpus`→`turn-memory-xml`→`chat-storage` 残留值依赖边）
- `api-config-references`：`conversationDir` 改自 `chat-storage-io`
- 值导入静态扫环：CS1–CS9 / PS / SR1 目标模块无自环；`npm run check:ci` 通过
- **残留 type 环清零**：`feature-binding-types.ts`（`ResolvedFeatureAudit` / `ResolvedFeatureBinding` / `FEATURE_TYPES`）；`chat-turn-accessors` 等改依赖 types；server directed 重跑 **Import Cycles 0**


---

## 3. 需修复 / server 跟进

| ID | 项 | 图谱证据 | 建议 |
|----|----|----------|------|
| SR1 | 小 2-file cycles | `regex-persist`↔`regex-persist-patch`；`st-preset-import`↔`limits`；`assemble-prompts`↔`system-binding-slots`；preferences memo 三角；prompt-macros 多环 | 类型下沉 / 单向调用，逐个打断 |
| SR2 | `src/index.ts` 过肥 | 出度约 **445** | 路由/注册分文件，index 只装配 |
| GF1 | 建图排除 `test/**` | server/web 多条 INFERRED `indirect_call` 指向测试（假边） | `.graphifyignore` 或抽取时跳过 test；避免误导重构 |

**§3 子任务勾选**

- [x] SR1：小 2-file cycles 解环（类型下沉 / 单向调用）
- [x] SR2：瘦身 `src/index.ts`
- [x] GF1：仓库根 `.graphifyignore` 排除 `test/**`、`*.test.ts`/`*.test.js`、`graphify-out/**`

**P0 Phase 5 落地摘要（2026-08-05）**

- `hasEnabledPersistRules` → `regex-persist-enabled.ts`（打断 `regex-persist`↔`regex-persist-patch`）
- `StPresetJson` 等 → `st-preset-types.ts`；`st-preset-limits` 只依赖 types
- 预设类型 → `prompt-preset-types.ts`；`system-binding-slots` 不再 import `assemble-prompts`
- `UserPreferencesDocument` → `user-preferences-types.ts`；`request-preferences-memo` 只依赖 types
- `MacroVarMap` → `prompt-macros/macro-var-types.ts`；types/limits 不再 import `macro-vars` 实现
- 根目录 `.graphifyignore`（GF1）

**P0 Phase 6 落地摘要（2026-08-05）**

- `src/index.ts` 仅装配 Fastify / hooks / listen；路由迁入 `src/routes/*-routes.ts`（auth / misc / chat / settings / prompts / lorebooks / characters / files / knowledge / plugins）
- 既有 `regex-routes` / `hybrid-fts-routes` / `admin/routes` 保持原位，由 index 调用

---

## 4. 可优化（体量与可维护性）

### 4.1 web — 巨型单文件

度最高（约，拆分前）：

| 文件 | 度（约） |
|------|----------|
| `ConversationContextSettings.vue` | 154 |
| `PromptsView.vue` | 143 |
| `CharactersView.vue` | 110 |
| `ConversationListView.vue` | 97 |
| `ChatConversationView.vue` | 96 |
| `PluginSchemaForm.vue` | 95 |
| `LorebooksView.vue` | 95 |

建议：按列表 / 表单 / 对话框 / composables 拆分；抽公共 `auth` / `loading` / `delete-dialog` / i18n 模式（`props`/`emit`/`errorText` 等跨数十社区重复）。

**§4.1 子任务勾选**

- [x] `ConversationContextSettings` → `conversation-settings/*Tab` + `useConversationContextSettings`
- [x] `PromptsView` → `prompts/{ListPanel,EntryEditor,Dialogs}`
- [x] `LorebooksView` → `lorebooks/{ListPanel,EntryEditor,Dialogs}`
- [x] `CharactersView` → `characters/` + `useCharactersLibrary`
- [x] `ConversationListView` → `conversation-list/` + create/filters composables
- [x] `ChatConversationView` → `ChatHeaderBar` / `ChatMemoryRebuildDialog` + chat-session bindings/media
- [x] `PluginSchemaForm` → `settings/plugin-schema/*` + `usePluginSchemaForm`
- [x] 公共页面状态：`useAsyncAction` · `useDeleteConfirmDialog`

**P0 Phase 7 落地摘要（2026-08-05）**

| 壳文件 | 拆分前 | 拆分后 |
|--------|--------|--------|
| `ConversationContextSettings.vue` | （已先行） | ~579 |
| `PromptsView.vue` | （已先行） | ~671 |
| `LorebooksView.vue` | （已先行） | ~403 |
| `CharactersView.vue` | 2502 | 247 |
| `ChatConversationView.vue` | 1901 | 764 |
| `PluginSchemaForm.vue` | 1741 | 174 |
| `ConversationListView.vue` | 1707 | 467 |

### 4.2 plugins

| 项 | 证据 | 建议 |
|----|------|------|
| `plot-summary` 过重 | 度质量和 ≈1838 | 继续拆 `dialogs` / `pipeline` / `settings` / `review` |
| `trace-keeper` 次重 | ≈1240 | 保持 panel / separate / server 边界 |
| 短名 `k()` | God node；3 插件各一份 | 改为可读名 |
| `isAutoSummarizeEnabled` 双处 | `dialogs.ts` + `index.ts` | 单点导出 |

**§4.2 子任务勾选**

- [x] `plot-summary` 继续分包（dialogs / pipeline / settings / review 边界已到位）
- [x] `trace-keeper` 保持 panel / separate / server 边界，避免再向 index 堆
- [x] 短名 `k()` → `tKey`（guidance-generate / plot-summary / trace-keeper）
- [x] `isAutoSummarizeEnabled` 单点导出（`settings.ts`；dialogs + index 共用）

**P0 Phase 8 落地摘要（2026-08-05）**

- `plot-summary`：`export function isAutoSummarizeEnabled` / `tKey` 于 `settings.ts`；去掉 dialogs/index 本地双定义；dialogs/pipeline/settings/review 模块边界保持
- `trace-keeper`：panel / separate / server 边界保持，未再向 index 堆逻辑
- 三插件 `k()` 统一改名为 `tKey`（i18n pluginKey 包装）

### 4.3 server（cycles 解完之后）

- 大社区 cohesion 仍低（~0.06–0.10）：配合目录分层（storage / assemble / plugin / macros）  
- 组装热点：`buildConversationOutboundMessages`、`invokeCstMacro` — 文档化调用序即可，非必须立刻拆  

---

## 5. 明确「先别当 bug」

| 现象 | 说明 |
|------|------|
| 首轮 server 几乎无边 | 抽取事故；以 §1 directed 重建为准 |
| Knowledge Gaps 的 `name`/`private`/`version` | package.json / manifest 字段噪声 |
| Surprising → `test/**` 的 `indirect_call` | 抽取假阳性（见 GF1） |
| `compilerOptions` 进 web God Nodes | tsconfig 噪声，非业务枢纽 |

---

## 6. 建议落地顺序（均记入 `04` §P0）

1. §2 `chat-storage` 环 → 插件沙箱环  
2. §3 小环 + index 瘦身 + 建图 ignore test  
3. §4.1 web Top Vue 拆分 → §4.2 plugins 分包/`k()` 命名  

---

## 7. 复现建图（备忘）

```text
# 解释器：uv tools graphifyy
# server（推荐 directed；完整 AST，勿用不完整并行 Job 半成品）
graphify extract server   # 或按 skill 流水线；建图时 directed=True
# 产物目录：server/graphify-out/
```

外部 `node:*` / npm 包 import 无本地节点属正常 dangling，建图前可剪掉（重建脚本已剪 751 条）。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-29 | 首版：三仓图谱审计；记入 `DOC/devNotes/04` §P0 |
| 2026-07-29 | server / web / plugins 及 server 跟进项全部升为 `04` §P0 |
| 2026-08-05 | P0 Phase 1–4：抽出 turn types/io/accessors + 插件 package-read；CS1–CS9 / PS1–PS2 解环；server typecheck + 测试通过（plugin dist stale 除外） |
| 2026-08-05 | P0 Phase 5：SR1 小环解环 + GF1 `.graphifyignore`；见 §3 落地摘要 |
| 2026-08-05 | P0 Phase 8（plugins 部分）：`k()`→`tKey`；`isAutoSummarizeEnabled` 单点导出；见 §4.2 |
| 2026-08-05 | P0 Phase 6：`index.ts` 路由拆至 `src/routes/*`；见 §3 |
| 2026-08-05 | P0 Phase 7：web 七巨型 Vue + 公共 composable 拆分；见 §4.1 落地摘要；`npm run typecheck` 通过 |
| 2026-08-05 | **P0 全项闭合**（分支 `Graphify`）：server 解环 + SR1/SR2/GF1 + web 拆分 + plugins `tKey` / autoSummarize 单点；见 `04` §P0 |
| 2026-08-05 | **P0 Phase 3 hoist**：`chat-group-turn-ops` + `chat-turn-mutate`；`chat-storage` 零 value-import `group-chat/*` 实现；见 §2.1 落地摘要 |
| 2026-08-05 | **循环审计修复**：切断 `turn-memory-xml` 等对 `chat-storage` 的残留值依赖；`README` §47 状态改为已落地；值导入扫环 + `check:ci` 通过 |
| 2026-08-05 | **残留 type 环清零**：`ResolvedFeatureAudit` 等下沉 `feature-binding-types.ts`；`chat-turn-accessors` 不再依赖 `feature-binding-resolve`；server directed 重跑 Import Cycles **20 → 0** |
