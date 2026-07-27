# 12 · 用 Docker 跑

完成本章后：能用 Docker Compose 构建并启动，浏览器访问健康服务，并知道数据挂在哪。

上一章：[11 · 数据在哪、怎么备份](11-data-and-backup.md) · 下一章：[13 · 启动方式对照与倒计时](13-startup-options.md) · [目录](00-menu.md)

---

## 适用场景

NAS、Linux 服务器，或你更习惯容器部署时。本机日常开发/使用仍可用 `!_start.bat` / `!_start.sh`（见 [01](01-install-and-start.md)）。

需要已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose。

---

## 构建并启动

在项目根目录执行：

```bash
docker compose up -d --build
```

首次或代码更新后请带 **`--build`**。本地没有镜像时 Compose 会自行构建，**不会**从 Docker Hub 拉取名为 `arousalpub:local` 的远程镜像。

浏览器打开：

```text
http://127.0.0.1:6633/
```

注意：这是 **`serverPort`（6633）**，**不是**开发模式的 `webPort`（常为 6699）。

改宿主机端口示例：

```bash
AROUSALPUB_PORT=8080 docker compose up -d --build
```

---

## 数据

默认把项目内 **`./data`** 挂到容器 **`/data`**，与本地 `!_start` 使用同一套目录布局，便于备份（[11](11-data-and-backup.md)）。

**不要**让多个容器实例同时读写同一数据目录。  
也**不要**本机 `!_start` 与 Docker 同时占用 **6633**。

---

## 打不开时快速排查

1. 地址是否为 `http://127.0.0.1:6633/`（带 `http://`，勿用 https，勿用 6699）。
2. `docker compose ps`：应看到端口映射且状态 **Up (healthy)**。
3. 本机是否还有 `!_start` 占着端口——有则先关掉。
4. `docker compose logs -f`：应有 `static web:` / `listening on` 一类日志。
5. `curl http://127.0.0.1:6633/health` 应返回 `{"ok":true}`。

---

## 常用命令

| 命令 | 作用 |
|------|------|
| `docker compose logs -f` | 看日志 |
| `docker compose down` | 停止并移除容器 |
| `docker compose up -d --build` | 更新后重建启动 |

镜像内已预编译；升级请重新 `--build` 或换新镜像，容器启动时**不会**替你 `git pull`。

可选环境变量（在 `docker-compose.yml` 的 `environment`）：`JWT_SECRET`、`DATA_DIR`、`PORT` 等。

---

## 自检

- [ ] `docker compose ps` 为 healthy。
- [ ] 浏览器能打开 6633（或你改过的端口）。
- [ ] 明白 `./data` 即持久化数据。

下一步：[13 · 启动方式对照与倒计时](13-startup-options.md)。
