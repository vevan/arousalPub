# Runtime data

本目录由服务端运行时维护，**整体被 .gitignore 忽略**，只有这份 README 进 git。

实际位置可在仓库根 `config.json` 里通过 `dataDir` 字段更改，或通过环境变量 `DATA_DIR` 覆盖。优先级：`DATA_DIR` > `config.json#dataDir` > 默认 `./data`（相对仓库根，见 `server/src/config.ts`）。

## 目录结构

```
data/
├── api-settings.json    # API 预设（可内联 API Key，或引用 api-keys.json#keys[].id），GET/PUT /api/settings
├── api-keys.json        # API Key 别名库，GET/PUT /api/api-keys
├── prompts.json         # 提示词预设（preset/group/entry），GET/PUT /api/prompts
├── chat/                # 对话历史（chat.index.json + 每会话子目录 chunk / index）
├── lorebook/            # 世界书（lorebook）— 骨架目录，预留
└── character/           # 角色卡库：每卡一个 {uuid}.json，见下
```

### `character/` 角色卡文件

- **文件名**：`{uuid}.json`（与卡内顶层 `id` 一致）。
- **存储文档**（服务端写入）：`schemaVersion: 1`，含 `id`、`importedAt`、`updatedAt`、`card`（Character Card V2 兼容对象）。
- **API**：`GET /api/characters`（列表与筛选）、`POST /api/characters/import`、`POST /api/characters`（表单新建）、`GET|DELETE /api/characters/:id`。详见仓库根 **`DOC/03-实现细节.md` §12**。

## 备份

整目录拷走即可——所有用户态都在这里（含对话、提示词、角色卡、API 配置）。

## 从旧版本（v0：server/data/）迁移

```sh
# 在仓库根执行
mv server/data/api-settings.json data/api-settings.json
mv server/data/chat              data/chat
```

提示词无需手动搬：前端首次启动会自动把 localStorage 里的旧数据上传到 `data/prompts.json`，并清掉浏览器副本。
