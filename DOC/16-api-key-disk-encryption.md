# API Key 磁盘加密 — 实现方案

> **状态**：**已实现**（P0，2026-06）。DEK 轮换见运维台 `DOC/17`（`/api/admin/crypto/rotate-data-key`）。  
> **前置**：`DOC/13` 服务端隔离（GET 脱敏、reveal 需登录密码、resolve 读盘）**已完成**。  
> **关联**：`server/src/api-keys-file.ts`、`api-settings-file.ts`、`user-preferences-file.ts`、`api-credential-resolve.ts`。

---

## 1. 背景

`DOC/13` 解决「密钥不出浏览器」；磁盘上仍为**明文 JSON**：

| 文件 | 明文字段 |
|------|----------|
| `data/{userId}/api-keys.json` | `keys[].key` |
| `data/{userId}/api-settings.json` | `presets[].apiKey`（内联，非 keychain 引用时） |
| `data/{userId}/user-preferences.json` | `embeddingApi.apiKey` |

Syncthing / 备份 zip / 误传仓库时存在泄露面。

---

## 2. 定案（为何不用「登录密码派生」）

| 方案 | 结论 |
|------|------|
| **登录密码派生 DEK** | ❌ 发消息 / Embedding / 拉模型在 JWT 会话下**不再**要求用户密码；无法在每次 `resolveChatCredentials` 时解密 |
| **服务端主密钥 DEK** | ✅ 与 JWT 密钥同类：`DATA_ENCRYPTION_KEY` 环境变量 → `config.json` → `data/.data-encryption-key`（生产自动生成） |
| **按用户不同 DEK** | 首版不做；目录已按 `userId` 隔离，密文 AAD 绑定 `userId` 防块搬运 |

**Reveal** 仍校验**登录密码**（人工查看明文）；**日常 resolve** 用服务端 DEK 自动解密，无需用户在场。

---

## 3. 密码学

- 算法：**AES-256-GCM**
- 密钥：32 字节（256 bit），自 `resolveDataEncryptionKey()` 经 SHA-256 规范化
- 每字段独立随机 **12 字节 IV**
- **AAD**（附加认证数据）：`arousal:{userId}:{context}`，`context` 如 `api-key:{id}`、`preset:{id}`、`embedding`

磁盘 JSON 字段（与明文二选一，写盘后仅留密文）：

```ts
interface EncryptedSecretV1 {
  v: 1
  iv: string   // base64
  tag: string  // base64, 16 bytes
  ct: string   // base64
}
```

| 存储位置 | 密文字段 | 内存 / 业务层 |
|----------|----------|----------------|
| api-keys | `keyEnc` | `ApiKeyEntry.key` |
| api-settings preset | `apiKeyEnc` | `ApiPreset.apiKey` |
| user-preferences embedding | `apiKeyEnc` | `EmbeddingApiSettings.apiKey` |

**空密钥**：不写 `key` / `keyEnc`（与今日「未配置」一致）。

---

## 4. 读写与迁移

### 4.1 读

1. 若存在 `*Enc` → `decryptSecret(blob, { aad })`
2. 否则若存在 legacy 明文 `key` / `apiKey` → 直接使用（**惰性迁移**）
3. 解密失败 → 抛错 / 500，**不**静默清空（防密钥轮换误操作）

### 4.2 写

1. 内存层仍为明文（与 `DOC/13` resolve / merge 不变）
2. 落盘前：`encryptSecret(plaintext, { aad })`，JSON **省略**明文字段
3. 首次写入后完成该文件迁移

### 4.3 密钥轮换

本机运维台（`DOC/17`）手动触发：`POST /api/admin/crypto/rotate-data-key`；维护写锁 + 全用户重加密 + 更新 `data/.data-encryption-key`（或提示改 env/config）。`GET /api/admin/crypto/suggest-key` 生成推荐 64 位 hex 材料。

**dev/prod 共用 DEK**：无 env/config 时，**dev 与 prod 均**在首次 `resolveDataEncryptionKey()` 时生成 `data/.data-encryption-key`（不再使用固定 dev-fallback 写入）。

### 4.4 Syncthing / 多机

- 同步 `data/{userId}/*.json` 密文即可
- **`data/.data-encryption-key` 或环境变量必须在各实例一致**，否则无法解密
- 与 `data/.jwt-secret` 相同运维要求；写入 `data/README.md` 说明

---

## 5. 模块划分

| 文件 | 职责 |
|------|------|
| `data-encryption-key.ts` | 解析 DEK（镜像 `auth-secret.ts` 优先级） |
| `secret-encryption.ts` | `encryptSecret` / `decryptSecret` / 类型 guard |
| `api-keys-file.ts` | 磁盘 ↔ 内存加解密 |
| `api-settings-file.ts` | preset 内联 `apiKey` 加解密 |
| `user-preferences-file.ts` | `embeddingApi.apiKey` 加解密 |

**不改**：`api-credential-resolve.ts`、`embedding-credential-resolve.ts` 接口（仍读内存明文）。

---

## 6. 实施顺序

| 步骤 | 内容 | 验收 |
|------|------|------|
| **S1** | `data-encryption-key` + `secret-encryption` + 单测 | round-trip、错误 AAD、空串 |
| **S2** | `api-keys-file` 读写加密 | 存量明文读后下次 PUT 变密文；reveal / chat 正常 |
| **S3** | `api-settings-file` preset 内联 key | PUT settings 省略 key 不丢；磁盘无 `apiKey` 明文 |
| **S4** | `user-preferences` embedding key | PATCH embedding 同 merge 规则 |
| **S5** | 文档：`DOC/13` §4、`DOC/04` 勾选、`data/README.md` 运维 | — |

---

## 7. 验收标准

- [ ] AAD 绑定 userId：复制它用户密文到本用户目录解密失败
- [x] 磁盘三文件落盘密文字段；resolve / reveal / merge 行为不变
- [x] `secret-encryption.test.ts` round-trip

---

## 8. 非目标（首版）

- 登录密码派生 DEK、OS keychain
- 自动密钥轮换工具
- 加密 `conversation` 级字段（当前无 inline apiKey 落盘）
