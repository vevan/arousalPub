# API 配置与功能绑定 — 实施方案

> **状态**：**Phase 1–4 已落地**（2026-06-08）；P4.3 独立知识库 RAG 接线待 P1。  
> **目标**：在**不引入数据库**、**不破坏现有文件同步**的前提下，落地 `DOC/03` §1.1–§1.2 的「`api_configs` + `feature_bindings`」语义。  
> **策略**：**文件型等价实现**——`presets[]` 即 `api_configs`；新增 `featureBindings[]` 承载全局功能映射；统一解析器替换散落的 `activePresetId` 直读。  
> **关联**：`DOC/03` §1–§3、`DOC/13`、`DOC/11` §4、`DOC/18` `host.api.listPresets`、`DOC/04` P0。

---

## 1. 背景与缺口

### 1.1 现状（2026-06）

| 概念 | 文档 | 仓库实现 |
|------|------|----------|
| `api_configs` | 独立连接登记册 | `api-settings.json` → `presets[]` + `/api/settings` |
| 全局 chat 默认 | `feature_bindings(chat, global)` | **`activePresetId`**（单活跃预设） |
| 全局 rag / rerank | 各 `featureType` 独立 binding | **rag/rerank 无**；**summary 已废弃**（策展记忆替代） |
| 全局插件默认 API | `feature_bindings(plugin, pluginId)` | **已移除**；插件 API 仅在**各插件设置页** + 可选对话 `apiPreset.plugins[pluginId]` |
| 对话覆盖 | `index.json` → `apiPreset` | **已实现**（`conversation-api-resolve.ts`） |
| Embedding 连接 | 可视为独立能力 | `user-preferences.json` → `embeddingApi`（**本方案首版不改路径**） |

### 1.2 为何仍要做

1. **插件**：`curated-memory` 等在各插件设置页配置 `apiConfigId`；对话级 `apiPreset.plugins[pluginId]` 为可选覆盖。
2. **P1 独立 RAG**：`rag_generate` 需全局指定 embedding / 生成用 preset，不能硬绑 `activePresetId`。
3. **P0 调用日志**：需记录 `featureType`、`apiConfigId`、`pluginId` 等解析结果。
4. **删除安全**：preset 引用扫描应覆盖全局 binding，不仅扫对话 `apiPreset`。

### 1.3 非目标（首版）

- 迁移到 MongoDB / SQLite 等独立 `api_configs` 服务
- 拆分 `api-settings.json` 为多文件（除非后续 Syncthing 冲突数据表明必要）
- 对话内自定义 `baseUrl` / `apiKey`（已定案禁止，见 `DOC/03` §1.2.2）
- Embedding 连接迁入 `featureBindings`（保持 `user-preferences.embeddingApi`；RAG 的 `rag_generate` 单独 binding）

---

## 2. 定案

| 决策 | 结论 |
|------|------|
| **`api_configs` 落盘** | **不新建文件**；`presets[]` 即为 api_configs；可选增 `capabilities[]` 供 UI 筛选 |
| **`feature_bindings` 落盘** | 写入 **`api-settings.json`** 新字段 `featureBindings[]`（与 presets 同事务更新） |
| **`activePresetId`** | **保留兼容**；读写时与 `featureBindings` 中 `chat/global` **双向同步**；长期 UI 只展示 binding |
| **REST 形态** | 新增 **`/api/feature-bindings`**（读写 bindings 子集）；**保留** `/api/settings` 整包 PUT（bindings 可省略 = merge 保留） |
| **解析入口** | 新建 **`feature-binding-resolve.ts`**，所有出站前统一调用 |
| **Embedding** | 首版不动 `embeddingApi`；`rag_generate` binding 指向 **chat 类 preset** 或专用 embedding preset（由 capabilities 提示） |

---

## 3. 数据模型

### 3.1 `presets[]`（= `api_configs`）

在现有 `ApiPreset` 上**可选**增加：

```ts
interface ApiPreset {
  // ...现有字段
  /** 可选；缺省视为 ['chat'] */
  capabilities?: Array<'chat' | 'embedding' | 'rerank'>
  /** 可选；默认 true */
  isEnabled?: boolean
}
```

- 存量 preset **无** `capabilities` → 解析为 `['chat']`。
- UI 下拉按 `featureType` 过滤可选 preset（chat 任务不展示仅 embedding 的 preset）。

### 3.2 `featureBindings[]`（= 全局 `feature_bindings`）

```ts
type FeatureType =
  | 'chat'
  | 'rag_generate'
  | 'rerank'

interface FeatureBinding {
  /** 稳定 id，8 位 hex；新建时 generateShortId */
  id: string
  featureType: FeatureType
  /** chat / rag_generate / rerank → 固定 'global' */
  featureRefId: string
  apiConfigId: string
  modelOverride?: string
  /** 温度等；首版仅 modelOverride，params 预留 */
  params?: Record<string, unknown>
  updatedAt: string
}
```

**唯一性约束**（服务端校验）：

| featureType | featureRefId | 规则 |
|-------------|--------------|------|
| `chat` | `global` | 每用户至多 1 条 |
| `rag_generate` | `global` | 至多 1 条 |
| `rerank` | `global` | 至多 1 条 |

### 3.3 磁盘示例

```json
{
  "version": 1,
  "savedAt": "2026-06-08T12:00:00.000Z",
  "activePresetId": "a1b2c3d4",
  "presets": [ { "id": "a1b2c3d4", "alias": "主模型", "baseUrl": "...", "model": "..." } ],
  "featureBindings": [
    {
      "id": "f0000001",
      "featureType": "chat",
      "featureRefId": "global",
      "apiConfigId": "a1b2c3d4",
      "updatedAt": "2026-06-08T12:00:00.000Z"
    },
    {
      "id": "f0000002",
      "featureType": "rag_generate",
      "featureRefId": "global",
      "apiConfigId": "b2c3d4e5",
      "updatedAt": "2026-06-08T12:00:00.000Z"
    }
  ]
}
```

### 3.4 `activePresetId` 同步规则

| 操作 | 行为 |
|------|------|
| **读盘** | 若 `featureBindings` 无 `chat/global` 但有 `activePresetId` → **惰性补**一条 chat binding |
| **写盘** | 更新 `chat/global` binding 时同步 `activePresetId = apiConfigId` |
| **PUT settings 改 activePresetId** | 同步 upsert `chat/global` binding |
| **删除 preset** | 若被任一 binding 引用 → **409**（扩展现有引用扫描） |

---

## 4. 解析链（核心）

### 4.1 全局 binding 查询

```ts
function resolveGlobalBinding(
  bindings: FeatureBinding[],
  featureType: FeatureType,
  featureRefId: string,
): FeatureBinding | null
```

查找顺序：`exact (type, refId)`。

### 4.2 非插件功能（chat / rag_generate / rerank）

> **已移除 `summary`**：会话叙事摘要由 **`curated-memory`** 插件 + 插件设置内 `apiConfigId` 承担，不再设全局 `summary` 键。读盘时忽略磁盘上遗留的 `featureType: summary` 条目。

```text
effective =
  对话.apiPreset[featureType]     // 键名 rag_generate 在对话里可简写为 rag，实现时定案一处
  ?? 全局 featureBindings(type, 'global')
  ?? 兼容回退 activePresetId      // 仅 chat；其它类型无 binding 则报错
```

**chat** 已与 `conversation-api-resolve.ts` 对齐：对话 `apiPreset.chat` 优先于全局。

### 4.3 插件功能

```text
effective =
  对话.apiPreset.plugins[pluginId]
  ?? 对话.apiPreset.plugin
  ?? 插件 settings.apiConfigId（各插件设置页）
  ?? null → 插件 manifest policy（embedded / userFirst）
```

与 `DOC/03` §1.2.1 **`resolvedPlugin`** 一致。读盘时忽略遗留的 `featureType: plugin` 全局 binding。

### 4.4 解析结果（供日志与转发）

```ts
interface ResolvedFeatureApi {
  featureType: FeatureType
  featureRefId: string
  pluginId?: string
  apiConfigId: string
  preset: ApiPreset
  model: string          // modelOverride ?? preset.model
  source: 'conversation' | 'global' | 'legacy_active' | 'plugin_settings'
}
```

### 4.5 需改造的调用点

| 模块 | 现状 | 改造 |
|------|------|------|
| `conversation-api-resolve.ts` | `activePresetId` 回退 | chat 全局回退走 `resolveFeatureApi('chat')` |
| `api-credential-resolve.ts` | `settings.activePresetId` | 无对话 id 时走 `resolveFeatureApi('chat')` |
| `plugin-complete.ts` | 调用方直传 `apiConfigId` | 新增 `resolvePluginCompleteApi(pluginId, conversationId?)` |
| `plugin-complete-draft-route.ts` / preflight | 同上 | 服务端解析后再 `runPluginComplete` |
| `web` `chat-api.ts` | `conn.activePresetId` | 无对话覆盖时行为不变（store 仍暴露 activePresetId = chat binding） |
| `curated-memory` settings `apiConfigId` | 各插件设置页 | 插件 API 的**主配置来源**（次于对话 `apiPreset.plugins`） |

---

## 5. HTTP API

### 5.1 保留（`api_configs` 语义已由下列路由承担）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` / `PUT` | `/api/settings` | 响应增加 `featureBindings`（GET 脱敏规则不变） |
| 现有 | `/api/settings/presets/:id/test` 等 | 不变 |

### 5.2 新增（`feature_bindings`）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/feature-bindings` | 返回当前用户全部 bindings |
| `PUT` | `/api/feature-bindings` | **幂等批量 upsert**；Body: `{ bindings: FeatureBinding[] }` 或单条 `{ binding }` |
| `DELETE` | `/api/feature-bindings/:id` | 删一条；`chat/global` 删除时清空 `activePresetId` 并回退到 presets[0] |

**校验**：

- `apiConfigId` 必须存在于 `presets[]`
- 违反唯一性 → `409 feature_binding_duplicate`
- preset 已禁用 `isEnabled === false` → `400 preset_disabled`

### 5.3 引用扫描扩展

`api-config-references.ts` 增加 `kind: 'global_feature_binding'`，扫描 `featureBindings[].apiConfigId`。

`GET /api/settings/presets/:id/references` 响应合并对话 + 全局 binding 引用。

---

## 6. 前端

### 6.1 设置页 —「功能绑定」卡片（Phase 2）

位置：`ConnectionSettingsCard` 下方或独立 Tab。

| 功能键 | UI | 说明 |
|--------|-----|------|
| **对话（chat）** | preset 下拉 | 替代「当前活跃预设」语义；改选 = upsert `chat/global` |
| **RAG 生成** | preset 下拉 | 灰字标注「独立知识库 RAG 接入后生效」 |
| **Rerank** | preset 下拉 | 可折叠「高级」 |

**Store**：`connection.ts` 增加 `featureBindings`；`activePresetId` getter 派生自 `chat/global` binding。

### 6.2 对话设置 / 插件设置

- **不变**：`ConversationApiSettingsPanel` 仍只覆盖 chat 采样参数 + preset 选择。
- **插件 settingsSchema**：`apiConfigId` 在**各插件设置页**配置；留空时仅可走对话 `apiPreset.plugins` 或 manifest embedded policy。

### 6.3 宿主 API

`host.api.listPresets()` 已实现；可选增 `host.api.resolveBinding(featureType, refId?)` **只读** effective（供插件展示，不含密钥）。

---

## 7. 迁移

### 7.1 惰性迁移（无批量脚本）

1. 首次 `readApiSettingsFromFile`：若无 `featureBindings` 且有 `activePresetId` → 内存补 `[{ chat, global, apiConfigId: activePresetId }]`
2. 下次 `writeApiSettingsToFile` 落盘 `featureBindings`
3. 旧客户端仅认 `activePresetId` 仍可用（服务端写时双写）

### 7.2 无需迁移的数据

- 对话 `apiPreset` 已是 binding 形状，**不改**。
- `user-preferences.embeddingApi` **不改**。

---

## 8. 实施阶段

### Phase 1 — 解析器与磁盘（后端，**无 UI 变更**）

| 步骤 | 文件 / 内容 | 验收 |
|------|-------------|------|
| **P1.1** | `feature-binding-types.ts`：类型 + 校验 + 唯一性 | 单测覆盖重复/非法 refId |
| **P1.2** | `api-settings-file.ts`：读写 `featureBindings`；`syncActivePresetWithChatBinding` | 读旧文件补 binding；round-trip |
| **P1.3** | `feature-binding-resolve.ts`：`resolveFeatureApi`、`resolvePluginApi` | 单测：对话覆盖 > 全局 > legacy |
| **P1.4** | 改造 `conversation-api-resolve.ts`、`api-credential-resolve.ts` | 现有 `conversation-api-settings.test.ts` 全绿；chat 行为不变 |
| **P1.5** | `api-config-references.ts` 扫 global bindings | preset 删除 409 含 binding 引用 |
| | ✅ 2026-06-08 完成 | `feature-binding-types.ts`、`feature-binding-resolve.ts`、单测 11 项 |

**里程碑**：行为等价于今日，磁盘可多 `featureBindings` 字段。**已达成**。

### Phase 2 — REST + 设置页 UI

| 步骤 | 内容 | 验收 |
|------|------|------|
| **P2.1** | `index.ts` 注册 `/api/feature-bindings` | curl GET/PUT/DELETE |
| **P2.2** | `GET /api/settings` 返回 bindings；PUT merge bindings | 前端 connection store 加载 |
| **P2.3** | `FeatureBindingsCard.vue` + i18n | chat 改选同步 activePresetId；刷新后保持 |
| **P2.4** | `ConnectionSettingsCard`「当前预设」文案对齐 binding 语义 | 无回归 |
| | ✅ 2026-06-08 完成 | `/api/feature-bindings`、`FeatureBindingsCard`、connection store |

### Phase 3 — 插件接线

| 步骤 | 内容 | 验收 |
|------|------|------|
| **P3.1** | `plugin-api-resolve.ts` + complete/preflight/draft 路由 | 省略 `apiConfigId` 时走解析链 |
| **P3.2** | 各插件 `settingsSchema.apiPreset` 设置页 | 改插件 `apiConfigId` 后 complete 走新 preset |
| **P3.3** | `DOC/18` / `plugins/README.md` 补充 resolve 链说明 | — |
| | ✅ 2026-06-08 完成 | `curated-memory` 可省略 `apiConfigId`；宿主统一解析 |

### Phase 4 — 为 P1 RAG / 日志预留

| 步骤 | 内容 | 验收 |
|------|------|------|
| **P4.1** | `resolveFeatureApi('rag_generate')` 在组装管线占位调用 | 未配置时跳过，不报错 |
| **P4.2** | turn `receive.runtime` 增 `resolvedFeature?: { featureType, apiConfigId, source }` | 对话请求可审计 |
| **P4.3** | 独立知识库 RAG 落地时接 `rag_generate` binding | 见 `DOC/04` P1；文档管线前置 **`DOC/20`** M1+M4 |
| | ✅ 2026-06-08 P4.1–P4.2 完成 | `chat-assemble` 返回 `resolvedRagGenerate`；`/api/chat` 落盘 `runtime.resolvedFeature` |

---

## 9. 测试清单

| 类别 | 用例 |
|------|------|
| **解析** | 对话 chat 覆盖 > 全局 chat binding > activePresetId |
| **解析** | plugin：对话 plugins[id] > plugin > 插件 settings |
| **迁移** | 无 featureBindings 的旧 json 首次写盘后含 chat binding |
| **同步** | 改 activePresetId 后 chat binding 一致；反之亦然 |
| **删除** | preset 被 global binding 引用 → 409 + references |
| **安全** | GET settings / bindings 不返回 apiKey 明文 |
| **插件** | completeDraft 无 apiConfigId + 插件 settings 有 apiConfigId → 成功 |

---

## 10. 文档与 TODO 勾选

完成后更新：

- [ ] `DOC/03` §2.1–§2.2 标注「文件型已实现」
- [ ] `DOC/04` P0 勾选 `api_configs` / `feature_bindings`
- [ ] `cursor.md` 索引
- [ ] `data/README.md` `api-settings.json` 字段说明

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| PUT `/api/settings` 整包覆盖丢 bindings | PUT merge：`featureBindings` 省略则保留磁盘；与 apiKeys 规则一致 |
| `activePresetId` 与 binding 双写不一致 | 写路径单一入口 `normalizeApiSettingsDocument` |
| 插件 manifest `embedded` 与 binding 冲突 | 文档写清优先级；preflight 返回 `resolved.source` 供调试 |
| Syncthing 并发写 settings | 延续单写者约定；整文件 `writeFile` |

---

## 12. 估算

| Phase | 量级 |
|-------|------|
| Phase 1 | 1–2 天（后端 + 单测） |
| Phase 2 | 1–2 天（REST + 设置 UI） |
| Phase 3 | 0.5–1 天（插件 + curated-memory 联调） |
| Phase 4 | 0.5 天（日志字段 + RAG 占位） |

**建议顺序**：Phase 1 → 2 → 3；Phase 4 可与 P1 独立 RAG 并行。
