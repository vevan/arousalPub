# API Key 服务端隔离与鉴权（需求定案）

> **状态**：**已实现**（2026-06-02 定案；2026-06 落地并验收）。  
> **优先级**：原 P0（见 `DOC/04-TODO.md`、`cursor.md` 文档索引）。  
> **关联**：`DOC/03` §1.3、§4（密钥不下发浏览器）；`DOC/02` 插件/API 调用原则；`server/src/api-credential-resolve.ts`、`server/src/embedding-credential-resolve.ts`。

---

## 1. 背景与问题（实施前，已解决）

定案前实现与文档目标不一致，**明文 API Key 会进入浏览器**并在出站请求中回传：

| 环节 | 现状 |
|------|------|
| `GET /api/api-keys` | 返回 `keys[].key` 全文 |
| `GET /api/settings` | 预设含明文 `apiKey` |
| `GET /api/user-preferences` | `embeddingApi.apiKey` 明文 |
| `POST /api/chat` | **强制** `body.apiKey` |
| `POST /api/models` | **强制** `body.apiKey` |
| 前端 | `bootstrapAppData()` 拉 keys/settings；`connection` 经 `bindKeychainSync` 把别名 key 灌入表单；`chat-api.ts` 在 body 带 `apiKey` |

**风险**：DevTools、日志、扩展、误导出均可泄露密钥；与 `DOC/03` §1.3「只提交 `apiConfigId` / 由后端拼接鉴权」不符。

---

## 2. 目标原则

1. **读**：列表/设置类 GET **永不返回明文**；仅返回 `keyConfigured`（或 `hasKey`）、`id`、`alias`、`apiKeyId` 等非敏感元数据。
2. **写**：PUT/PATCH 支持「未传 `key` / 省略 `apiKey` → 保留磁盘原值」；显式 `""` 表示清空该槽位。
3. **用**：`POST /api/chat`、`POST /api/models`、Embedding 测试等由服务端根据 **`apiPresetId` / `activePresetId`（默认）+ `apiKeyId`** 读盘解析 `Authorization`，**不要求** body 带 `apiKey`。
4. **看（可选但建议首版包含）**：经 **当前用户登录密码** 校验后，允许 **一次性** 查看某条 keychain 条目明文（`reveal`）；查看结果 **不得** 写入前端持久 store（仅临时 UI）。

---

## 3. 功能需求

### 3.1 服务端凭证解析

- 新增或扩展 **`api-credential-resolve`**（可参考 `embedding-credential-resolve.ts`）：
  - 从 `api-keys.json` 按 `apiKeyId` 解析 key；
  - 从 `api-settings.json` 按 `apiPresetId` / `activePresetId` 解析 preset，并合并 `apiKeyId` 与内联 `apiKey`（磁盘侧）；
  - 解析失败返回明确错误码（如 `api_credential_not_configured`）。
- **`POST /api/chat`**：Body 去掉必填 `apiKey`；可选 `apiPresetId`；`baseUrl` / `model` / 采样参数仍可由 body 覆盖非密钥字段。
- **`POST /api/models`**：Body 改为 `{ apiPresetId?, apiKeyId?, baseUrl? }`，服务端解析 key。
- **Embedding**：`PATCH /api/user-preferences` 的 `embeddingApi` 与测试接口与对话 API 同一 merge/解析规则。

### 3.2 GET 脱敏

| 接口 | 脱敏规则 |
|------|----------|
| `GET /api/api-keys` | 条目为 `{ id, alias, createdAt, updatedAt, keyConfigured }`，无 `key` |
| `GET /api/settings` | 每条 preset 无 `apiKey`，增加 `keyConfigured`；保留 `apiKeyId` |
| `GET /api/user-preferences` | `embeddingApi` 无 `apiKey`，增加 `keyConfigured` |

### 3.3 PUT/PATCH 合并写

- **`PUT /api/api-keys`**：写条目 `{ id, alias, key? }`；**省略 `key`** 则 merge 保留旧值；**新建**条目必须带 `key`。
- **`PUT /api/settings`**：按 preset `id` merge；JSON 中**未出现** `apiKey` 字段则保留磁盘；`apiKeyId` 优先时解析忽略内联 key。
- **`PATCH embeddingApi`**：省略的 `apiKey` 不覆盖已存。

### 3.4 授权查看（Reveal）

- **`POST /api/api-keys/:id/reveal`**，Body `{ password: string }`。
- 使用当前会话用户 + `verifyPassword`（与登录同一套 `users-index` / `auth-password`）。
- 成功：`{ key: string }`；失败：`wrong_password` / `not_found`（需 i18n 错误码）。
- 建议：同用户短时间失败次数限制（防暴力），实现细节实施时定。

### 3.5 前端隔离

- `apiKeys` store：列表无持久 `key`；保存时仅对有改动的条目附带 `key`。
- `connection` store：删除 `bindKeychainSync`；表单 `apiKey` 仅作**本轮输入草稿**；`keyConfigured` / `apiKeyId` 驱动「已配置」态。
- `chat-api` / `useChatSession`：请求体传 `apiPresetId`，**不传 `apiKey`**；就绪条件改为「已配置密钥」而非 `conn.apiKey.trim()`。
- `ConnectionSettingsCard`：占位 `••••••`；Key 管理「查看」走 reveal 对话框；`fetchModels` 只传 `apiPresetId` + `baseUrl`。
- `preferences`（Embedding）：与 connection 相同模式。

### 3.6 导出/导入

- 预设 JSON **导出**：默认不包含 apiKey（用户勾选导出 key 为**主动行为**，与 API 脱敏无关）。
- 导入：key 经 PUT merge 写入服务端，导入后 GET 仍脱敏。

---

## 4. 非目标（本迭代不做）

- 将 `api-settings.json` 迁移为独立 `api_configs` 集合（`DOC/03` §1.1 长期形态）；本需求在**现有文件模型**上完成隔离。
- ~~API Key 磁盘加密（`apiKeyEncrypted`）~~ → **已升为 P0 备忘**，见 **`DOC/04-TODO.md`** §P0「API Key 磁盘加密」。
- 插件包内密钥转发（`DOC/03` §1.3 V2）— 与对话 API 预设并行，不阻塞本项。

---

## 5. 建议实施顺序

1. `api-credential-resolve` + GET 脱敏 + PUT merge（api-keys、settings、embedding preferences）
2. `POST /api/chat`、`POST /api/models` 改用服务端解析
3. `POST /api/api-keys/:id/reveal` + 错误码 / i18n
4. 前端 store、`chat-api`、设置 UI
5. 更新 `DOC/03` 实现状态表；回归：发消息、拉模型列表、Embedding 测试、别名 key 保存/切换

---

## 6. 验收标准

- [x] 登录后 DevTools Network：**无任何 GET** 响应体含完整 API Key。
- [x] `POST /api/chat` 请求体**无** `apiKey` 字段，对话仍可正常 SSE。
- [x] 仅改 preset 别名/模型、不改 key 时 PUT settings **不丢失** 原密钥。
- [x] Keychain 仅改 alias 的 PUT **不丢失** 原 key。
- [x] Reveal：错误密码失败；正确密码可查看且刷新页面后不再自动带出明文（Key 管理内眼睛图标 + 密码对话框）。
- [x] `useChatSession` 在未配置密钥时阻止发送并提示（i18n，`isApiKeyConfigured`）。

---

## 7. 关键代码位置（实施时）

| 区域 | 路径 |
|------|------|
| 路由 / 解析 | `server/src/index.ts`、`server/src/api-credential-resolve.ts` |
| Key 脱敏 / merge | `server/src/api-keys-sanitize.ts`、`server/src/api-settings-sanitize.ts`、`server/src/embedding-api-sanitize.ts` |
| Key 文件 | `server/src/api-keys-file.ts` |
| 预设文件 | `server/src/api-settings-file.ts` |
| Embedding 解析 | `server/src/embedding-credential-resolve.ts` |
| 前端 keys | `web/src/stores/apiKeys.ts` |
| 前端连接 | `web/src/stores/connection.ts`、`web/src/components/ConnectionSettingsCard.vue` |
| 聊天请求 | `web/src/utils/chat-api.ts`、`web/src/composables/useChatSession.ts` |
| 启动拉数 | `web/src/bootstrap/app-data.ts` |

---

## 8. 提示词懒加载（2026-06 已实现，与 Key 隔离并列）

- **`GET /api/prompts`**：仅返回 `index.json`（`id` / `name` / `updatedAt` / `activePresetId`），不含条目 `content`。
- **`GET /api/prompts/:presetId`**：单预设全文；**`PUT`** 写单文件；**`PATCH`** 更新索引；**`DELETE`** 删预设。
- **bootstrap**：`loadIndexFromServer()`；提示词编辑页 `loadEditorFromServer()` 再拉当前激活预设。
- **对话组装**仍仅服务端 `readPromptsDocument()`，不依赖浏览器持有全文。

---

## 9. 文档维护

已同步（2026-06）：

- `DOC/03` §4 安全策略
- `DOC/04` 勾选本需求
- `DOC/02` §3.2、`cursor.md` 索引
