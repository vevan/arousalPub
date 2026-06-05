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
| `api-settings.json`、`api-keys.json` | API 配置 |
| `preferences.json` | 主题、语言等 |

## 插件与 Syncthing

- **轮次 state**：`chats/.../turn-*.json` 的 **`turn.plugins[]`**。
- **插件代码**：`data/plugins/<pluginId>/`（全局）。
- **插件配置**：`data/plugins/<pluginId>/{userId}/settings.json`；上传文件在 **`.../{userId}/assets/`**。
- 详见 **`DOC/09-plugin-system-and-guidance-generate.md`**。

## 备份

以整个 `data/` 为单元备份；含 API Key 与密码哈希，须与生产环境同等访问控制。
