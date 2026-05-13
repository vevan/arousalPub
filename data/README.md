# Runtime data

本目录由服务端运行时维护，**整体被 .gitignore 忽略**，只有这份 README 进 git。

实际位置可在仓库根 `config.json` 里通过 `dataDir` 字段更改，或通过环境变量 `DATA_DIR` 覆盖。优先级：`DATA_DIR` > `config.json#dataDir` > 默认 `./data`。

## 目录结构

```
data/
├── api-settings.json    # API 预设（含密钥），由 GET/PUT /api/settings 读写
├── prompts.json         # 提示词预设（preset/group/entry 三层），由 GET/PUT /api/prompts 读写
├── chat/                # 对话历史（每个会话一个子目录）
│   └── <conversationId>/...
├── lorebook/            # 世界书（lorebook）— 当前为空骨架，预留
└── character/           # 角色卡 — 当前为空骨架，预留
```

## 备份

整目录拷走即可——所有用户态都在这里。

## 从旧版本（v0：server/data/）迁移

```sh
# 在仓库根执行
mv server/data/api-settings.json data/api-settings.json
mv server/data/chat              data/chat
```

提示词无需手动搬：前端首次启动会自动把 localStorage 里的旧数据上传到 `data/prompts.json`，并清掉浏览器副本。
