# 12 · 数据在哪、怎么备份

完成本章后：知道数据默认在哪个文件夹、怎么整包备份与换机恢复，以及不要同时双写同一目录。

上一章：[11 · 向量召回](11-vector-recall.md) · 下一章：[13 · 用 Docker 跑](13-docker.md) · [目录](00-menu.md) · [English](../EN/12-data-and-backup.md)

---

## 默认位置

所有用户数据默认在项目下的 **`data/`** 目录（可用 `config.yaml` 的 `dataDir` 改路径）。

大致结构（只需建立印象）：

```text
data/
  users.index.json          # 用户列表
  .jwt-secret               # 登录相关密钥（可自动生成）
  .data-encryption-key      # API Key 磁盘加密密钥
  backups/                  # 产品内自动冷备 zip
  {8位用户ID}/
    chats/                  # 对话
    characters/             # 角色
    prompts/                # 提示词
    lorebooks/              # 资料库
    api-settings.json       # 连接配置
    ...
```

更细的路径说明见仓库 [`data/README.md`](../../../data/README.md)。

---

## 手动备份（推荐你亲自做的）

1. **先停止**正在跑的 arousalPub（关掉 `!_start` 窗口，或停掉 Docker 容器），避免拷到一半还在写文件。
2. **复制整个 `data/` 文件夹**到安全位置（U 盘、另一块盘、网盘等）。
3. 备份里含密码哈希与 API Key 密文，请当作敏感数据保管。

### 换机恢复

1. 在新机器装好并跑通程序（[01](01-install-and-start.md)）。
2. 停服后，用备份的 `data/` **替换**新机器上的 `data/`。
3. 再启动。

---

## 产品内自动冷备

默认大约每 **7 天**会把整棵 `data/` 打成 zip，放到 **`data/backups/`**（可用 `config.yaml` 的 `backupEnabled` / `backupIntervalDays` / `backupMaxKept` 调整）。

备份进行中界面可能全屏进度，短暂无法写入。这是正常现象。

用 Syncthing 等同步时：**不要**让两台机器同时写同一 `dataDir`；并建议忽略同步 `backups/`、各用户下的 `memory/`（索引可重建）。

---

## 自检

- [ ] 能在资源管理器 / Finder 里找到项目下的 `data/`。
- [ ] 知道「整目录复制」就是主备份方式。

下一步（按需）：[13 · 用 Docker 跑](13-docker.md)。
