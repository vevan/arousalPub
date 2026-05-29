# 数据目录

应用运行时数据根目录，默认位于仓库根下的 `data/`（可在 `config.json` 的 `dataDir` 或环境变量中覆盖）。

## 多用户布局

```
data/
  users.index.json          # 用户注册表（用户名、密码哈希、显示名等）
  00000000/                 # 种子账号（首次安装自动创建，需完成 setup）
  {8位hex}/                 # 其它用户目录（allocateUserId 分配，跳过 00000000）
```

- **用户 ID**：8 位小写十六进制，与业务实体 ID（会话、角色卡等）命名空间独立。
- **种子账号 `00000000`**：安装后自动生成；在 Web 引导中设置用户名/密码后 `setupComplete: true`。
- **认证**：除 `/api/auth/*`、`/health`、`/api/users/:id/avatar` 外，其余 `/api/*` 需 JWT（`Authorization: Bearer`）。不再使用 `X-User-Id` 或 `default-user` 目录名。
- **本机默认用户**：仅浏览器 `localStorage`（`arousal-default-user-id` + refresh 会话），不写入 `users.index.json`。勾选后使用 **persisted** 会话（`data/auth-sessions.json`，重启仍有效）；未勾选为 **ephemeral** 会话（仅内存，**重启失效**；**15 分钟**无活动后 refresh 失败需重登）。
- **`data/auth-sessions.json`**：默认用户的 refresh 会话索引（不含明文 refresh，仅存哈希）。

## 单用户目录结构

每个 `{userId}/` 下典型内容：

| 路径 | 说明 |
|------|------|
| `avatar.png` | 用户头像（首装从 `server/assets/users/default-avatar.png` 复制） |
| `chats/` | 对话会话与消息 |
| `prompts/` | `index.json` + `preset-*.json` |
| `characters/` | 角色卡 PNG 与 `index.json` |
| `lorebooks/` | 资料库 JSON |
| `api-settings.json` | 连接/API 预设 |
| `api-keys.json` | API Key 别名 |
| `preferences.json` | 用户偏好（主题、语言等） |

## 备份

以整个 `data/` 为单元备份即可；含 API Key 与密码哈希，须与生产环境同等访问控制。
