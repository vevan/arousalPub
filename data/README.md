# 数据目录

应用运行时数据根目录，默认位于仓库根下的 `data/`（可在 `config.json` 的 `dataDir` 或环境变量中覆盖）。

## 多用户布局

```
data/
  users.index.json          # 用户注册表（用户名、密码哈希、显示名等）
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
| `prompts/`、`characters/`、`lorebooks/` | 资料与预设（角色主存 **`characters/{id}.png`**，`id` 为 8 位 hex，见 `DOC/03` §6.7） |
| `api-settings.json`、`api-keys.json` | API 配置（内联 key 落盘为 **`apiKeyEnc` / `keyEnc`**，见 `DOC/16`） |
| `user-preferences.json` | 全局偏好（含 embedding **`apiKeyEnc`**） |

## 密钥文件（`data/` 根目录）

| 文件 / 环境变量 | 用途 |
|----------------|------|
| `.jwt-secret` | JWT 签名密钥（生产可首次自动生成） |
| `.data-encryption-key` | API Key **磁盘加密**主密钥（AES-256-GCM） |
| `JWT_SECRET` / `config.json` → `jwtSecret` | 覆盖 JWT 密钥 |
| `DATA_ENCRYPTION_KEY` / `config.json` → `dataEncryptionKey` | 覆盖磁盘加密密钥 |

**Syncthing / 多机**：同步 `data/{userId}/` 下 JSON 密文即可；各实例须使用**相同** `DATA_ENCRYPTION_KEY`（或同步 `.data-encryption-key`），否则无法解密 API Key。

**dev / prod**：无 env/config 时，开发与生产均读写 `data/.data-encryption-key`（首次启动自动生成 64 位 hex，勿再依赖固定 dev 默认钥）。

**轮换 DEK**：本机 `http://127.0.0.1:<serverPort>/admin`（种子用户）→「生成推荐」+「开始轮换」；见 `DOC/17`。

## 插件与 Syncthing

- **轮次 state**：`chats/.../turn-*.json` 的 **`turn.plugins[]`**。
- **插件代码**：`data/plugins/<pluginId>/`（全局）。
- **插件配置**：`data/plugins/<pluginId>/{userId}/settings.json`；上传文件在 **`.../{userId}/assets/`**。
- 详见 **`DOC/09-plugin-system-and-guidance-generate.md`**。

## 备份

以整个 `data/` 为单元备份；含 API Key 与密码哈希，须与生产环境同等访问控制。
