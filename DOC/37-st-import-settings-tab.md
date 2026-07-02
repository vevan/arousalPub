# 设置页「导入」Tab — SillyTavern 迁移入口（设计定案）

> **状态**：设计定案，**未实现**（**P2**，见 `DOC/04-TODO.md` §迁移）。  
> **定案日期**：2026-07-02  
> **关联**：`DOC/04` §迁移、`DOC/26`（ST 宏）、`DOC/27`（角色卡内嵌世界书）、`DOC/03` §6（chunk / turn）、§13（资料库）、§15（提示词预设）；样本 `.tmp/安娜 - 日记.jsonl`、`.tmp/希斯.json`（仅分析用，不入库）。

---

## 1. 背景

### 1.1 现状

| 能力 | 现有入口 | 说明 |
|------|----------|------|
| ST 提示词预设 | `PromptsView` 工具栏「导入」 | `detectPromptImportKind` → ST 确认对话框 → `POST /api/prompts/convert-st` → `importStPresetFromJson`；服务端 `server/src/st-preset-import.ts` |
| 原生提示词 JSON | 同上 | 直接 `importPresetsFromJson` |
| 原生世界书 export | `LorebooksView` 工具栏「导入」 | `parseLorebookImport`（`web/src/utils/lorebooks-package.ts`），**不认** ST `entries` 对象形态 |
| ST 聊天记录 | **无** | JSONL 需新转换器 + API |
| ST 独立世界书 | **无** | 需 ST → `Lorebook` 映射 + API |

各库页面已有导入，但 **SillyTavern 迁移** 分散、无统一入口；`DOC/04` P2「迁移」需产品化入口。

### 1.2 目标

在 **系统设置** 增加 **「导入」** Tab，**仅**提供三项 ST 专项迁移：

1. **ST 聊天记录**
2. **ST 世界书**
3. **ST 提示词预设** — **不重复实现**；点击后触发提示词库既有导入流程（自动打开提示词对话框并弹出文件选择）。

**不在此 Tab 内**：角色卡 PNG/JSON、原生提示词/世界书 export、连接 preset、批量备份等（仍保留各库原入口）。

---

## 2. 产品定案（2026-07-02）

| # | 决策 | 说明 |
|---|------|------|
| 1 | **Tab 仅三项** | ST 聊天记录、ST 世界书、ST 提示词预设；无第四块「其他导入」 |
| 2 | **预设走原流程** | Tab 内**无**独立 file picker / convert 逻辑；`uiContext` 信号 → 关设置 → 开 `PromptsView` → `performImportPickFile()` |
| 3 | **聊天 / 世界书 Tab 内完成** | 文件选择、预览/确认、绑定（聊天）均在 Tab 内；服务端新 API |
| 4 | **优先级 P2** | 与 `DOC/04`「迁移」同级；可先落地 Tab 壳 + 预设跳转，再补聊天/世界书 API |
| 5 | **种子原则** | 导入写入用户数据目录，**不**挂 `ensureUsersRegistry` 常规分支；遵循 `.cursor/rules/user-data-seed.mdc` |

---

## 3. UI 与路由

### 3.1 接入点

- `web/src/views/SettingsView.vue`：`SettingsTab` 增加 `'import'`；`navItems` 增加 `{ id: 'import', icon: 'mdi-import', … }`。
- 新建 `web/src/components/settings/ImportSettingsPanel.vue`（对齐 `BudgetTrimSettingsPanel` 等），避免 `SettingsView` 膨胀。
- `web/src/App.vue`：`settingsInitialTab` 类型联合增加 `'import'`。

设置以 **embedded 对话框** 打开（`App.vue`），新 Tab 自动可用，**无需**新路由。

### 3.2 布局

```
设置 → 导入
├── [Card] ST 聊天记录     — 说明 + 「选择 JSONL…」+ 绑定表单 + 导入
├── [Card] ST 世界书       — 说明 + 「选择 JSON…」+ 书名预览 + 导入
└── [Card] ST 提示词预设   — 说明 + 「打开提示词库并导入…」（无 file input）
```

每项一张 `v-card`：标题、`text-body-2` 说明、主按钮。窄屏与现有设置 Tab 一致（`useNarrowLayout`）。

### 3.3 i18n 键（建议）

| 键 | 中文示例 |
|----|----------|
| `settings.navImport` | 导入 |
| `settings.importIntro` | 从 SillyTavern 迁入聊天记录、世界书或提示词预设。 |
| `settings.importStChatTitle` | ST 聊天记录 |
| `settings.importStChatHint` | JSONL 导出；导入前需绑定用户角色与对话角色。 |
| `settings.importStLoreTitle` | ST 世界书 |
| `settings.importStLoreHint` | ST World Info / Lorebook JSON；导入后为独立资料库。 |
| `settings.importStPresetTitle` | ST 提示词预设 |
| `settings.importStPresetAction` | 打开提示词库并导入… |
| `settings.importStPresetHint` | 将打开提示词库并弹出文件选择，与在提示词库中点击「导入」相同。 |

---

## 4. ST 提示词预设 — 委托原流程

### 4.1 现有行为（须完整复用）

```196:198:web/src/views/PromptsView.vue
function performImportPickFile() {
  importFileRef.value?.click()
}
```

选文件后：`detectPromptImportKind` → native 直写 / ST 确认对话框 → `store.importStPresetFromJson` → `/api/prompts/convert-st`（`server/src/st-preset-import.ts`）。

`PromptsView` 由 `App.vue` 以 `v-if="promptsDialogOpen"` 挂载，**当前无** `defineExpose`。

### 4.2 推荐实现：`ui-context` 信号

与 `requestOpenPromptsDialog` / `openPromptsSignal` 同模式（`web/src/stores/ui-context.ts`）：

```ts
const openPromptsImportSignal = ref(0)

function requestOpenPromptsImport() {
  openPromptsImportSignal.value += 1
}
```

**`App.vue`** watch：

1. `settingsDialogOpen = false`（避免双层 modal）
2. `promptsDialogOpen = true`

**`PromptsView.vue`** watch `openPromptsImportSignal`：

```ts
await nextTick()
performImportPickFile()
```

**`ImportSettingsPanel`** 预设卡片按钮：

```ts
uiContext.requestOpenPromptsImport()
```

### 4.3 边界

| 场景 | 行为 |
|------|------|
| 提示词库已打开 | signal 递增仍触发 `performImportPickFile()` |
| 用户取消文件选择 | 无操作；提示词库保持打开 |
| ST / native 混在 Tab | **禁止** — Tab 只负责跳转，格式检测仍在 `PromptsView` |

**不新增** `/api/prompts/convert-st` 调用点或 Tab 内 hidden `<input type="file">`。

---

## 5. ST 聊天记录 — 映射与 API

### 5.1 源格式（JSONL）

样本：`.tmp/安娜 - 日记.jsonl`（~28MB）。

| 行 | 内容 |
|----|------|
| 第 1 行 | `chat_metadata`（`note_prompt`、`STMemoryBooks` 等）— **不导入** |
| 第 2 行起 | 逐条消息 JSON |

典型字段：`name`、`is_user`、`is_system`、`mes`、`swipes[]`、`swipe_id`、`extra.reasoning`、`gen_started` / `gen_finished`、`extra.model`、插件 `extra`（如 `qvink_memory`）等。

### 5.2 简化映射定案

| ST 来源 | 本地字段 | 说明 |
|---------|----------|------|
| 第 2 条 assistant `mes`（`is_system: true`） | 开场 turn：`turnOrdinal=0`，`send.userText=""`，单 segment / 单 receive | 只取当前 `mes`，**忽略** `swipes[]` |
| 之后 user `mes` | `send.userText` | 每条 user 消息一轮 |
| 之后 assistant `mes` | `receives[0].content`（或 segment 内 receive） | 每轮一条 receive |
| `extra.reasoning` | `receives[0].reasoning` | 有则写 |
| `gen_started` + `gen_finished` | `receives[0].runtime.durationMs` | 两者皆有才算 |
| `extra.model`、`swipes`、插件 `extra`、metadata 行 | **不写** | v1 丢弃 |

配对规则：flat message 列表按 **user → assistant** 成 turn；开场单独处理。

目标结构：`TurnRecord`（`server/src/chat-storage.ts`）— `turnId`、`turnOrdinal`、`send`、`segments[]` / `receives[]`、`activeReceiveIndex` 等；单 bot 导入时 **单 segment**，`speakerCharacterId = characterIds[0]`（对齐群聊 G0 迁移，`DOC/35`）。

### 5.3 绑定前置

**写入任何 turn 之前**须 PATCH 会话绑定（与新建对话一致）：

- `userCharacterId` / `userName`
- `characterIds[]`（单角色 ST 聊天通常一条）

流程：选文件 → 预览统计（轮次数、首条时间）→ 选/建角色 → **创建或选定 conversationId** → PATCH 绑定 → 调用导入 API → 写 chunk + 更新 `chat.index.json`。

### 5.4 API 草案

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat/import-st/preview` | multipart `file` 或流式 JSONL；返回 `{ turnCount, openingPreview, warnings[] }` |
| `POST` | `/api/chat/import-st` | Body：`conversationId` + 文件或已解析 turn 批次；流式读 JSONL + 批量写 chunk |

实现参考：`server/src/chunk-chain.ts` 写路径、`allocateShortId`；大文件 **流式** 读行，避免整文件进内存。

### 5.5 不包含（v1）

- model / preset / lorebook 绑定恢复
- swipe 变体、hidden 消息
- ST 插件状态（`qvink_memory` 等）
- 自动从 ST 角色名匹配本地角色（可 v2 辅助，非必须）

---

## 6. ST 世界书 — 映射与 API

### 6.1 源格式

样本：`.tmp/希斯.json` — `{ entries: { "0"…"7" }, stlo: { budget, priority, … } }`。

- 8 条 lore；部分 `key: []` + `vectorized: true`；`disable: true` 表禁用。
- 全局 `stlo` 为 ST 侧预算，**不**写入本地 `Lorebook` 顶层（本地预算在组装/设置侧）。

### 6.2 字段映射

目标：`Lorebook` / `LorebookEntry`（`server/src/lorebook-types.ts`）。

| ST | 本地 | 说明 |
|----|------|------|
| `comment` | `title` | 缺省用 uid 或截断 `content` |
| `content` | `content` | 原样 |
| `key[]` | `keys` | |
| `disable: true` | `enabled: false` | |
| `constant: true` | `constant: true`, `triggerMode: 'constant'` | |
| 有 `key` 且非 constant | `triggerMode: 'keyword'` | |
| `key` 空且 `vectorized: true` | `triggerMode: 'vector'` | 与会话 vector 召回一致 |
| `order` / uid | `order` | 保持 ST 顺序 |
| `priority` | `priority` | 缺省 0 |
| — | 单默认组 `group-default` | ST 导出无组；全部条目入一组 |

**不导入**：`stlo`、ST 专有 extension 字段。

### 6.3 导入后

- 写入 `data/{userId}/lorebooks/{id}.json` + 更新 index（与现有 CRUD 一致）。
- **向量条目**须触发资料库 reindex（`lorebook-vector-index`），UI 可提示「正在建立向量索引」。

### 6.4 API 草案

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/lorebooks/import-st/preview` | JSON body 或 multipart；返回 `{ name, entryCount, vectorEntryCount, disabledCount }` |
| `POST` | `/api/lorebooks/import-st` | Body：`{ stJson, name? }` → 新建 lorebook id，返回 `{ ok, id }` |

服务端模块建议：`server/src/st-lorebook-import.ts`（单测对齐 `st-preset-import.test.ts` 风格）。

Tab UI：选 JSON → preview 对话框 → 确认 → 调用 API → Snackbar + 可选「打开资料库」链 `uiContext.requestOpenLorebooksDialog(id)`。

---

## 7. 实现里程碑

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **M0** | `SettingsTab` + `ImportSettingsPanel` 三卡片壳；i18n；预设卡片 `requestOpenPromptsImport` + `ui-context` + `App` / `PromptsView` watch | 无 |
| **M1** | `st-lorebook-import.ts` + preview/import API + Tab 世界书卡片 | M0 |
| **M2** | ST JSONL 转换 + preview/import API + Tab 聊天卡片（绑定表单） | M0 |
| **M3** | 大文件进度、错误报告、单测与 `.tmp` 样本回归 | M1–M2 |

---

## 8. 关键文件索引

| 用途 | 路径 |
|------|------|
| 设置 Tab | `web/src/views/SettingsView.vue` |
| 对话框编排 | `web/src/App.vue` |
| UI 跨面板信号 | `web/src/stores/ui-context.ts` |
| ST 预设（已有） | `web/src/views/PromptsView.vue`、`server/src/st-preset-import.ts` |
| 原生世界书导入（参考 UX） | `web/src/views/LorebooksView.vue` |
| Turn 磁盘模型 | `server/src/chat-storage.ts` |
| 资料库类型 | `server/src/lorebook-types.ts` |
| 待办 | `DOC/04-TODO.md` §迁移 |

---

## 9. 验收清单（实现后）

- [ ] 设置 → 导入 Tab 可见，仅三张 ST 卡片
- [ ] 点击「ST 提示词预设」：设置关闭、提示词库打开、系统文件选择框弹出；选 ST JSON 后出现既有 ST 确认对话框并成功导入
- [ ] ST 世界书：`.tmp/希斯.json` 导入后 8 条、disable/vector 映射正确；vector 条目可 reindex
- [ ] ST 聊天：绑定 user/char 后导入 JSONL；开场 + 交替轮次正确；reasoning/durationMs 可选字段正确
- [ ] 未实现 API 前，聊天/世界书卡片可 disabled + hint，或隐藏主按钮并显示「即将推出」
