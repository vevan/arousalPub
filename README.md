# arousalPub

类 SillyTavern 的本地 AI 角色对话应用：管理角色卡、提示词预设、资料库（世界书），在浏览器里与模型流式对话。数据保存在本机目录，可备份或同步。

---

## 环境要求

- **Node.js 22 或更高**（[nodejs.org](https://nodejs.org/) 安装 LTS 即可；与 `vue-i18n` 等依赖要求一致）
- 现代浏览器（Chrome、Edge、Firefox 等）
- Windows 可直接双击 `start.bat`；macOS / Linux 使用 `start.sh`

---

## 快速开始

### 1. 首次运行

1. 解压或克隆本项目到本地目录。
2. 若尚无 `config.json`，将 **`config.example.json`** 复制为 **`config.json`**（也可在首次启动时由程序自动从示例生成）。
3. 双击 **`start.bat`**（Windows）或终端执行 **`./start.sh`**。

首次运行会自动安装依赖；若缺少构建产物，会自动编译后再启动。**请保持启动窗口不要关闭**，关闭即停止服务。

### 2. 打开页面

启动成功后，终端会显示可点击的地址，一般为：

```text
http://localhost:6633/
```

端口由 `config.json` 里的 **`serverPort`** 决定（示例默认为 `6633`）。

### 3. 首次登录

- 第一次打开会引导**设置管理员账号**（用户名与密码）。
- 登录后可勾选 **「设为默认用户」**：本机下次可免密进入（数据仍保存在本地）。
- 可在 **设置 → 账户** 中修改密码或注册更多用户。

---

## 启动说明

| 方式 | 适用 |
|------|------|
| **`start.bat` / `start.sh`** | 日常使用（推荐） |
| **Docker** | NAS / Linux 服务器等容器环境 |
| **`npm run dev`** | 开发者改代码时使用（双端口 + 热更新） |

### 启动倒计时

`start.bat` 启动前有 **`startCountdownSeconds`** 秒倒计时（默认 5 秒，可在 `config.json` 修改；设为 `0` 则跳过）。

- **不按键**：倒计时结束后使用已有编译结果快速启动。
- **按 `B`**：重新编译前端与后端后再启动（改过程序代码后建议按 B）。
- **按空格**：跳过倒计时，立即启动（不重新 build）。

若缺少 `web/dist` 或 `server/dist`，或当前 git 版本与上次编译记录不一致（例如 `git pull` 更新后），会自动编译。开发者本地改代码未提交时，倒计时期间按 **B** 手动重新编译即可。

---

## Docker 部署

需要已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose。

### 构建并启动

```bash
docker compose up -d --build
```

首次或代码更新后请带 **`--build`**。若本地还没有镜像，Compose 会自行构建，**不会**从 Docker Hub 拉取 `arousalpub:local`（该 tag 仅用于本地）。

浏览器访问 **`http://127.0.0.1:6633/`**（**不是** dev 的 `webPort` 6699）。改端口：`AROUSALPUB_PORT=8080 docker compose up -d --build`

### 浏览器打不开？

1. 确认地址为 **`http://127.0.0.1:6633/`**（带 `http://`，勿用 https；勿用 6699）。
2. 运行 **`docker compose ps`**，应看到 `0.0.0.0:6633->6633/tcp` 且状态为 **Up**（healthy）。
3. 若本机 **`start.bat` 已在跑**，可能占用 6633：先关掉 bat 窗口，再 `docker compose up -d`。
4. 查看日志：**`docker compose logs -f`**，应有 `static web:` 与 `listening on`。
5. 快速自检：**`curl http://127.0.0.1:6633/health`** 应返回 `{"ok":true}`。

### 数据持久化

默认将项目内的 **`./data`** 挂载到容器内 `/data`（对话、角色、API 密钥等），与 `start.bat` 使用本地 `data/` 时路径一致，便于直接备份或 Syncthing 同步。

**请勿**让多个容器实例同时读写同一数据目录。

### 常用命令

| 命令 | 说明 |
|------|------|
| `docker compose logs -f` | 查看日志 |
| `docker compose down` | 停止并移除容器 |
| `docker compose up -d --build` | 更新镜像后重建并启动 |

镜像内已预编译前端与后端，**不会**在容器启动时执行 `git pull` 或本地 rebuild。升级版本请重新 `docker compose up -d --build` 或拉取新镜像。

可选环境变量（在 `docker-compose.yml` 的 `environment` 中设置）：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 密钥（≥16 字符）；未设时首次启动写入 `/data/.jwt-secret` |
| `DATA_DIR` | 数据目录，默认 `/data` |
| `PORT` | 监听端口，默认 `6633` |

---

## 基本使用

### 对话

1. 首页 **「新建对话」**：选择用户角色卡、主角色卡，可填对话标题并勾选资料库。
2. 进入对话后输入消息发送；支持流式回复、思维链展示、重新生成与多版本滑动（swipe）。
3. 侧栏可绑定/更换角色、资料库，并调整本对话的提示词与记忆等选项。

### 角色库

顶栏 **「角色」**：导入 SillyTavern PNG/JSON、新建或编辑角色卡，导出 PNG/JSON。会话内绑定的角色在对话侧栏设置。

### 提示词

顶栏 **「提示词」**：管理预设与分组条目，控制注入顺序与触发方式；对话可绑定某一预设。

### 资料库（世界书）

顶栏 **「资料库」**：按资料库 → 分组 → 条目组织设定；对话创建或侧栏中勾选要注入的资料库。

### 设置

顶栏 **「设置」**：

- **连接 / API**：填写 OpenAI 兼容接口的地址、密钥、模型等。
- **语言**：界面中/英文切换。
- **主题、字号** 等显示选项。

API 密钥保存在本机数据目录，不会写入浏览器公开存储。

---

## 配置（`config.json`）

常用项：

| 配置项 | 说明 |
|--------|------|
| `dataDir` | 数据目录，默认 `./data` |
| `serverPort` | 启动后浏览器访问端口（`start.bat` 使用） |
| `startCountdownSeconds` | 启动前倒计时秒数；`0` = 不等待 |
| `authIdleMinutes` 等 | 登录会话超时（可选） |

完整说明见 `config.example.json` 中的 `_comment` 字段。

---

## 数据与备份

所有对话、角色、提示词、资料库、API 配置等均在 **`dataDir`** 下（默认项目内的 **`data/`** 文件夹），按用户分子目录。

- **备份**：复制整个 `data/` 目录即可。
- **换机恢复**：在新机器安装程序后，用备份的 `data/` 替换即可。
- **同步**（如 Syncthing）：请避免两台机器**同时**写入同一数据目录，以免文件冲突。

更细的路径说明见 [`data/README.md`](data/README.md)。

---

## 常见问题

**打不开页面**

- 确认启动窗口仍在运行，且端口未被其它程序占用。
- 检查 `config.json` 的 `serverPort` 与浏览器地址是否一致。

**改代码后界面没变化**

- 重新 `start.bat`，倒计时期间按 **`B`** 强制重新编译。

**忘记密码**

- 需在数据目录中处理用户记录，或删除对应用户数据后重新注册（会丢失该用户数据）。开发/运维细节见 `DOC/` 文档。

**生产环境 JWT**

- 首次 `start.bat` 启动会在 `data/.jwt-secret` 自动生成密钥；也可在 `config.json` 设置 `jwtSecret`（≥16 字符）。

---

## 开发者文档

架构、接口与实现细节见 **`DOC/`** 目录；项目索引见 [`cursor.md`](cursor.md)。

开发模式：

```bash
npm install
npm run dev
```

浏览器访问 `config.json` 中的 **`webPort`**（默认与 `serverPort` 不同）。
