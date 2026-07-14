# 数据目录

应用运行时数据根目录，默认位于仓库根下的 `data/`（可在 `config.yaml` 的 `dataDir` 或环境变量中覆盖）。

## 多用户布局

```
data/
  users.index.json          # 用户注册表（用户名、密码哈希、显示名等）
  .jwt-secret               # JWT 签名密钥（可选自动生成）
  .data-encryption-key      # API Key 磁盘加密主密钥（可选自动生成）
  backups/                  # 产品内全量冷备 zip（§8.8；Syncthing 勿同步，见 §备份）
    backup-<时间>.zip
    backup-manifest.json
  plugins/                  # 全局插件包（安装一次，全用户共用代码）
    <pluginId>/
      manifest.json
      dist/
      locales/
      assets/               # 可选：如 default.mp3
      {userId}/             # 该用户在此插件下的配置与上传
        settings.json
        assets/
        secrets/
  00000000/                 # 种子账号
    plugin-registry.json    # 该用户插件启用与 hook 排序
    chats/
    ...
  {8位hex}/
    plugin-registry.json
    ...
```

- **用户 ID**：8 位小写十六进制。
- **插件 registry**：**每个用户一份** `data/{userId}/plugin-registry.json`（非全局根目录）。旧版 `data/plugin-registry.json` 会在首次 seed 时迁移到用户目录。
- **认证**：除公开路由外，`/api/*` 需 JWT。

## 单用户目录 `{userId}/`

| 路径 | 说明 |
|------|------|
| `plugin-registry.json` | 该用户插件 enabled / order |
| `avatar.png` | 用户头像 |
| `chats/` | 对话会话与消息 |
| `prompts/`、`characters/`、`lorebooks/` | 资料与预设（角色主存 **`characters/{id}.png`**，`id` 为 8 位 hex，见 `DOC/03` §6.7；宿主元数据 **`characters/index.json`**：`userCardList`、**`imageFilesByCharacterId`**（M2 文件绑定，不进 PNG）） |
| `files/` | 用户文件库（`index.json` + `{fileId}/meta.json` + `{fileId}/content`；见 `DOC/20` · `DOC/03` §17） |
| `api-settings.json`、`api-keys.json` | API 配置（内联 key 落盘为 **`apiKeyEnc` / `keyEnc`**，见 `DOC/25` §15） |
| `user-preferences.json` | 全局偏好（含 embedding **`apiKeyEnc`**、**`hybridFts`** 记忆检索分词，见 `DOC/03` §14.4.3） |
| `memory/` | Lance 远期记忆索引（**派生**，可重建；Syncthing 建议忽略，见 `DOC/03` §14.5） |
| `hybrid-fts/` | Hybrid BM25 分词资源（如 `zh-jieba/{variant}/jieba/default/dict.txt`，`variant` 为 small / default / big；见 `DOC/03` §14.4.3） |
| `regex-rules.json` | 原生正则规则（用户级；**无**会话级副本，见 **`DOC/24`** §2.1、§6） |

## 密钥文件（`data/` 根目录）

| 文件 / 环境变量 | 用途 |
|----------------|------|
| `.jwt-secret` | JWT 签名密钥（生产可首次自动生成） |
| `.data-encryption-key` | API Key **磁盘加密**主密钥（AES-256-GCM） |
| `JWT_SECRET` / `config.yaml` → `jwtSecret` | 覆盖 JWT 密钥 |
| `DATA_ENCRYPTION_KEY` / `config.yaml` → `dataEncryptionKey` | 覆盖磁盘加密密钥 |

**Syncthing / 多机**：同步 `data/{userId}/` 下 JSON 密文即可；各实例须使用**相同** `DATA_ENCRYPTION_KEY`（或同步 `.data-encryption-key`），否则无法解密 API Key。

**dev / prod**：无 env/config 时，开发与生产均读写 `data/.data-encryption-key`（首次启动自动生成 64 位 hex，勿再依赖固定 dev 默认钥）。

**轮换 DEK**：本机 `http://127.0.0.1:<serverPort>/admin`（种子用户）→「生成推荐」+「开始轮换」；见 `DOC/17`。

## 插件与 Syncthing

- **轮次 state**：`chats/.../turn-*.json` 的 **`turn.plugins[]`**。
- **插件代码**：`data/plugins/<pluginId>/`（全局）。
- **插件配置**：`data/plugins/<pluginId>/{userId}/settings.json`；上传文件在 **`.../{userId}/assets/`**。
- 详见 **`DOC/09-plugin-system-and-guidance-generate.md`**。

## 备份

以整个 `data/` 为单元备份；含 API Key 与密码哈希，须与生产环境同等访问控制。运维细节见 **`DOC/03` §8**。

### 产品内冷备（`data/backups/` · `DOC/03` §8.8）

| 项 | 说明 |
|----|------|
| **触发** | 服务启动后：距上次**成功**冷备超过 `config.yaml` → `backupIntervalDays`（默认 7 天），或从未备份 |
| **落盘** | `{dataDir}/backups/backup-<ISO8601>.zip` + `backup-manifest.json` |
| **保留** | `backupMaxKept`（默认 5），超出删最旧 zip |
| **范围** | 整棵 `data/`（含各 `{userId}/`、`memory/` Lance、`.jwt-secret`、`.data-encryption-key` 等），**不含** `backups/` 自身 |
| **进行中** | 备份期间 Web 全屏进度；变更 `data` 的写 API 返回 **503** `backup_in_progress` |
| **状态 API** | `GET /api/backup/status`（免 JWT）：`running`、`filesDone`、`filesTotal`、`lastSuccessAt`、`lastError` |

**`backup-manifest.json`**（示例字段）：

```json
{
  "lastSuccessAt": "2026-06-09T02:25:18.000Z",
  "file": "backup-20260609T022518Z.zip",
  "bytes": 12345678
}
```

配置（`config.yaml` 或 `config.example.yaml`）：`backupEnabled`（默认 `true`）、`backupIntervalDays`、`backupMaxKept`、`backupRetryHours`（失败后暂缓重试，默认 24h）。

~~对话轮次增量备份（§8.4）~~：**无限期延后**，不实现；`chats/.../index.json` 内 `backupSettings` 仅为历史占位。

### Syncthing 与多机边界

| 同步 | 忽略 / 注意 |
|------|------|
| `chats/`、JSON 配置、chunk 等**权威数据** | **`backups/`** 整个目录 |
| 可选：各机本地重建 | **`memory/`** Lance 索引（推荐 `.stignore`，见 `DOC/03` §14.5） |

**单写者**：同一 `dataDir` 上**只运行一个 server**（勿 prod 与 dev 双开）；否则 Lance 易损坏（`memory_vector_index_corrupt` → 设置页重建索引）。

在 Syncthing 共享文件夹的 **Ignore Patterns**（`.stignore`）中建议：

```
backups
memory
```

各实例须使用**相同** `DATA_ENCRYPTION_KEY`（或同步 `.data-encryption-key`），否则无法解密 API Key（见上文 §密钥文件）。

### 恢复流程（`DOC/03` §8.5）

1. **停止**应用（避免半写文件）。
2. 将当前 `data` **改名为** `data.broken-<时间戳>`（保留现场）。
3. 从 `backups/` 选定 zip **解压到原 `dataDir`**（覆盖还原整棵 `data/`）。
4. **启动**并验证登录、对话、API Key reveal、插件。
5. 使用 Syncthing 时：恢复期间宜**暂停同步**或指定单方权威副本后再同步，避免旧副本覆盖新恢复数据。

手动离线拷贝：可直接复制整棵 `data/`（含密钥文件）；与产品内 zip 冷备互为补充。
