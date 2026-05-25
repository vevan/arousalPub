# Runtime data

本目录由服务端运行时维护，**整体被 .gitignore 忽略**，只有这份 README 进 git。

实际位置可在仓库根 `config.json` 里通过 `dataDir` 字段更改，或通过环境变量 `DATA_DIR` 覆盖。优先级：`DATA_DIR` > `config.json#dataDir` > 默认 `./data`（相对仓库根，见 `server/src/config.ts`）。

## 多用户目录

用户数据按 **`data/{userId}/`** 存放。未指定用户（或请求头/查询未带用户 id）时使用 **`default-user`**。

指定用户（任选其一）：

- 请求头：`X-User-Id: my-user`
- 查询参数：`?user=my-user`

## 目录结构（单用户示例）

```
data/
└── default-user/
    ├── api-settings.json    # API 预设，GET/PUT /api/settings
    ├── api-keys.json        # API Key 别名库，GET/PUT /api/api-keys
    ├── prompts/
    │   ├── index.json       # 索引：activePresetId + 各预设 id/name/updatedAt
    │   ├── preset-default.json
    │   └── preset-….json    # 每个预设一份完整 JSON
    ├── chats/               # 对话（chat.index.json + 每会话子目录）
    ├── lorebooks/           # 世界书（骨架，预留）
    └── characters/          # 角色卡库（{uuid}.png + index.json）
```

### `characters/` 角色卡文件

- **文件名**：`{uuid}.png`（内嵌 Character Card V2 元数据）。
- **API**：`GET /api/characters`、导入/新建/更新/删除等，见 `DOC/03-实现细节.md` §12。

## 备份

拷贝整个 `data/`（或单个 `data/{userId}/`）即可备份该用户的对话、提示词、角色卡与 API 配置。

## 从旧版平铺布局迁移

服务端启动时会自动：

1. 将 `data/api-settings.json`、`data/chats/` 等迁入 `data/default-user/`
2. 将 `data/default-user/prompts.json` 拆分为 `data/default-user/prompts/index.json` + 各 `preset-*.json`

无需手动操作；若目标路径已存在则跳过对应项并打日志。
