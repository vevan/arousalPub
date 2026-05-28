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
    ├── lorebooks/           # 资料库（index.json + 各 {id}.json）
    ├── memory/              # （规划）LanceDB 对话 turn 向量索引，派生数据，可删后按 chunk 重建；见 DOC/03 §14
    └── characters/          # 角色卡库（{id}.png + index.json，id 为 8 位 hex）
```

### `lorebooks/` 资料库

- **结构**：`index.json` 索引 + 每本资料库一份 `{id}.json`（内含 `groups[]` 与 `entries[]`）。
- **默认**：首次写入时生成 `lore-default.json`。
- **API**：`GET/PUT /api/lorebooks`、`GET /api/lorebooks/:id`；会话绑定字段 `lorebookIds`（见 `chats/{conversationId}/index.json`）。
- **注入**：组装对话时按绑定顺序合并命中条目（常量 + 用户输入关键字），填入提示词预设的「资料库」槽位。详见 `DOC/03-实现细节.md` §13。

### `characters/` 角色卡文件

- **文件名**：`{id}.png`（`id` 为 8 位十六进制，与会话 id 同规则；内嵌 Character Card V2 元数据）。
- **API**：`GET /api/characters`、导入/新建/更新/删除等，见 `DOC/03-实现细节.md` §12。

## 对话记忆索引（规划）

- 路径：`memory/`（LanceDB，**非权威**）；权威对话正文仍在 `chats/` chunk。
- **Syncthing**：优先同步 `chats/`；`memory/` 建议各机本地重建，或单写者生成后再同步（见 `DOC/03-实现细节.md` §14.5）。

## 备份

拷贝整个 `data/`（或单个 `data/{userId}/`）即可备份该用户的对话、提示词、角色卡与 API 配置。若未拷贝 `memory/`，恢复后可通过 re-embed 重建向量索引。
