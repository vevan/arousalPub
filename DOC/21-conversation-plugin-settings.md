# 会话级插件设置（Conversation Plugin Settings Tab）

> **状态**：**v1 已落地**（`conversationSettingsSchema`、对话齿轮 → 插件 Tab、`plot-summary` 迁移）。  
> **更名（v1.6）**：插件 id 自 `curated-memory` 改为 `plot-summary`；宿主启动时迁移 registry / `pluginSettings` / 用户 settings（`migrate-plot-summary.ts`）。  
> **关联**：`DOC/09` §5.6、`DOC/11` §4、`DOC/18` §6、`DOC/12` Historian（剧情纪要）字段拆分。  
> **auto ensure**：**v1.4 已落地**（`host.lorebook.ensure`）；manual 无摘要资料库时仍弹框选书。

---

## 1. 动机与原则

| 原则 | 定案 |
|------|------|
| 不硬编码插件 | 对话设置**不得**在宿主 Tab（绑定、资料库等）内写死某 `pluginId` 字段 |
| 独立 Tab | `ConversationContextSettings` 增加 **插件** 导航项 |
| 动态渲染 | 仅展示 **registry `enabled`** 且 manifest 声明 **`conversationSettingsSchema`** 的插件 |
| 存储 | `index.json` → `pluginSettings[pluginId]`（与 `DOC/11` §4 一致） |
| 与全局分离 | `settingsSchema` ↔ 用户 `settings.json`；`conversationSettingsSchema` ↔ 会话 `pluginSettings`；两套字段**可完全不相交** |
| 合并语义 | 宿主不解释业务字段；**插件代码**定义继承（如 `loadMergedSettings`） |
| 运行时字段 | `lastSummarizedEnd`、`sidecarEntryIds` 等**不得**出现在任一 schema |

**开关 / 排序**：仍在系统设置 → 插件列表（registry），不属于 schema。

---

## 2. Manifest 契约

### 2.1 `conversationSettingsSchema`

结构与 `settingsSchema` 相同（`version` + `fields[]`），字段类型复用 `PluginSettingsFieldSchema` / `PluginSchemaForm`。

```json
{
  "conversationSettingsSchema": {
    "version": 1,
    "fields": [
      {
        "key": "targetLorebookId",
        "type": "lorebook",
        "labelKey": "convTargetLorebookIdLabel",
        "descriptionKey": "convTargetLorebookIdDesc"
      }
    ]
  }
}
```

### 2.2 会话继承全局（可选字段属性）

| 属性 | 说明 |
|------|------|
| `conversationInherit: true` | 表单项可清空；保存时对该键传 `null`，从 `pluginSettings` 删除，运行时回落全局 |
| `inheritFromGlobalKey` | 与 `settings.json` 中键名对应；hint 展示「未设置时继承全局：{值}」 |

### 2.3 HTTP / 宿主 API

| 操作 | 路径 / API |
|------|------------|
| 列举（含 schema） | `GET /api/plugins/manage` → `conversationSettingsSchema`、`hasConversationSettings` |
| 读会话 | `GET /api/chat/conversations/:id` → `pluginSettings[id]` |
| 写会话 | `PATCH /api/chat/conversations/:id` → `{ pluginSettings: { [id]: partial } }`；值 `null` 删键 |
| Web 封装 | `fetchConversationPluginSettings` / `patchConversationPluginSettings` |

---

## 3. 对话设置 UI

### 3.1 Tab 行为

- 导航：**插件**（`mdi-puzzle-outline`）
- 无已启用且含 `conversationSettingsSchema` 的插件 → **隐藏**该 Tab
- 先展示**插件列表**（名称、版本、id）；点「配置」进入该插件表单（与系统设置 → 插件 Tab 同模式）
- 表单内自动保存（debounce）；「返回插件列表」回到列表
- 打开对话设置时 `mergePluginLocales(pluginId)`（与系统设置插件页一致）

### 3.2 与 composer 菜单

- **插件 Tab** = 会话级配置主入口（可发现）
- **composer 菜单** = 流程快捷（自动摘要开关、手动摘要、区间选择、复杂 dialog）
- 二者读写同一 `pluginSettings`；复杂控件（Sidecar 三态、自动 Sidecar 多选）可暂留插件 dialog

---

## 4. Historian（剧情纪要）（`plot-summary`）字段定案

### 4.1 全局 `settingsSchema`（系统设置 → 插件 → 配置）

保留：API、自动摘要新对话默认、块长/buffer **默认**、Sidecar 库、prompt 模板、标题格式、触发方式等。

**删除**：`defaultTargetLorebookId`（不再提供全局默认摘要目标书）。

### 4.2 会话 `conversationSettingsSchema`（对话齿轮 → 插件）

| 字段 | 说明 |
|------|------|
| `targetLorebookId` | **摘要资料库**（写入目标；空 = 未配置，摘要时弹框选书） |
| `autoSummarizeEnabled` | 本会话自动摘要（自动块） |
| `blockTurns` | 可清空继承全局 `triggerEveryNTurns` |
| `bufferTurns` | 可清空继承全局 `bufferTurns` |

### 4.3 与 `lorebookIds` 边界

| 字段 | 用途 |
|------|------|
| 绑定 Tab → `lorebookIds` | 注入 prompt |
| 插件 Tab → `targetLorebookId` | 摘要 **写入**；文案 **摘要资料库** |

### 4.4 auto ensure（v1.4 · 已做）

- 全局设置 → 插件 → Historian（剧情纪要）：`targetLorebookMode: auto` + `autoLorebookNameTemplate`
- 无 `targetLorebookId` 时 `host.lorebook.ensure` 建书并 `patchPluginSettings`
- **manual**（默认）：仍弹框选已有书

---

## 5. 实现清单

- [x] `PluginManifest.conversationSettingsSchema` + `listPluginsManage` 暴露
- [x] `ConversationPluginSettingsPanel` + `ConversationContextSettings` 插件 Tab
- [x] `PluginSchemaForm` 支持 `conversationInherit` / `inheritFromGlobalKey`
- [x] `plot-summary`：删全局默认目标书、会话 schema、 `loadMergedSettings` 仅读会话 `targetLorebookId`
- [x] `host.lorebook.ensure`（见 `DOC/04`）
