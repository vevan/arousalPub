# arousalPub

本地 AI 角色对话应用：管理角色卡、提示词预设、资料库（世界书），在浏览器里与模型流式对话。数据保存在本机目录，可备份或同步。

[中文教程](manual/CN/00-menu.md) · [English guide](manual/EN/00-menu.md) · [English README](../README.md)

---

## 项目特点

- **便于同步的 Chunk 落盘** — 对话按轮次切成链式 chunk 文件保存，长对话也更利于备份与 Syncthing 一类同步（请勿两台机器同时写同一数据目录）。
- **完备且易读的会话审计** — 开启 debug 审计后，可在助手消息的 **审计** 面板查看提示词组装、正则阶段、群聊选人等（[教程](manual/CN/D-04-session-debug-audit.md)）。
- **原生正则管线** — 用户级 **显示 / 出站 / 落盘** 规则，并支持对历史批量套用（[教程](manual/CN/B-06-regex-rules.md)）。
- **可拖曳的分组提示词** — 提示词预设按分组 / 条目组织，支持拖拽排序，注入与触发方式一目了然（[教程](manual/CN/B-02-prompts-intro.md)）。
- **群聊选人模式** — 同轮多段接龙：顺序、掷骰竞标、LLM `[NEXT@]`，以及优先于模式的 `/@` 点名（[教程](manual/CN/D-01-group-and-branches.md)）。
- **隔离的 API Key** — 密钥留在服务端，不进浏览器界面；列表接口只返回是否已配置，查看明文需校验登录密码。
- **插件沙盒与宿主边界** — 插件经宿主调用模型与读写盘，浏览器侧插件不持明文密钥；可选服务端 Worker 沙箱加强隔离（[教程](manual/CN/D-02-plugins-intro.md)）。
- **对话分支** — 从某条消息分叉剧情，不毁掉主线（[同一章](manual/CN/D-01-group-and-branches.md)）。

日常操作步骤见 [新手教程目录](manual/CN/00-menu.md)。

---

## 环境要求

- **Node.js 22 或更高**（[nodejs.org](https://nodejs.org/) 安装 LTS 即可；与 `vue-i18n` 等依赖要求一致）
- 现代浏览器（Chrome、Edge、Firefox 等）
- Windows 可直接双击 `!_start.bat`；macOS / Linux 使用 `start.sh`

---

## 快速开始

### 0. 用命令行获取 / 更新代码

若尚未安装 [Git](https://git-scm.com/)，请先安装。打开终端后：

**第一次：从仓库克隆**

```bash
git clone https://github.com/vevan/arousalPub.git
cd arousalPub
```

**以后：拉取最新版本**（在项目目录内执行）

```bash
cd arousalPub
git pull
```

然后按平时方式启动（`!_start.bat` / `./start.sh`）。`git pull` 之后若依赖或构建有变，启动脚本通常会自动 `npm install` / 重新编译。

也可以从 GitHub 下载 ZIP 再解压；ZIP 方式**不能**用 `git pull` 更新，需重新下 ZIP，或改用上面的 `git clone`。

逐步说明见教程：[A-01 · 安装与启动](manual/CN/A-01-install-and-start.md)。

### 1. 首次运行

1. 准备好本项目文件夹（见上方 **§0**，或解压 ZIP）。
2. 若尚无 `config.yaml`，将 **`config.example.yaml`** 复制为 **`config.yaml`**（也可在首次启动时由程序自动从示例生成）。
3. 双击 **`!_start.bat`**（Windows）或终端执行 **`./start.sh`**。

首次运行会自动安装依赖；**`git pull` 等更新后若 `package-lock.json` 或 workspace 的 `package.json` 有变，启动时也会自动 `npm install`**。若缺少构建产物，会自动编译后再启动。**请保持启动窗口不要关闭**，关闭即停止服务。

### 2. 打开页面

启动成功后，终端会显示可点击的地址，一般为：

```text
http://localhost:6633/
```

端口由 `config.yaml` 里的 **`serverPort`** 决定（示例默认为 `6633`）。

### 3. 首次登录

- 第一次打开会引导**设置管理员账号**（用户名与密码）。
- 登录后可勾选 **「设为默认用户」**：本机下次可免密进入（数据仍保存在本地）。
- 可在 **设置 → 账户** 中修改密码或注册更多用户。

---

## 启动说明

| 方式 | 适用 |
|------|------|
| **`!_start.bat` / `start.sh`** | 日常使用（推荐） |
| **Docker** | NAS / Linux 服务器等容器环境 |
| **`npm run dev`** | 开发者改代码时使用（双端口 + 热更新） |

### 启动倒计时

`!_start.bat` 启动前有 **`startCountdownSeconds`** 秒倒计时（默认 5 秒，可在 `config.yaml` 修改；设为 `0` 则跳过）。

- **不按键**：倒计时结束后使用已有编译结果快速启动。
- **按 `B`**：重新编译前端与后端后再启动（改过程序代码后建议按 B）。
- **按空格**：跳过倒计时，立即启动（不重新 build）。

若缺少 `web/dist` 或 `server/dist`，或当前 git 版本与上次编译记录不一致（例如 `git pull` 更新后），会自动编译。依赖清单变更时会在编译前自动 `npm install`（一般无需手动执行）。开发者本地改代码未提交时，倒计时期间按 **B** 手动重新编译即可。

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
3. 若本机 **`!_start.bat` 已在跑**，可能占用 6633：先关掉 bat 窗口，再 `docker compose up -d`。
4. 查看日志：**`docker compose logs -f`**，应有 `static web:` 与 `listening on`。
5. 快速自检：**`curl http://127.0.0.1:6633/health`** 应返回 `{"ok":true}`。

### 数据持久化

默认将项目内的 **`./data`** 挂载到容器内 `/data`（对话、角色、API 密钥等），与 `!_start.bat` 使用本地 `data/` 时路径一致，便于直接备份或 Syncthing 同步。

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
- **对话历史 / 资料库 / 向量召回**：历史轮数、资料库递归、远期记忆与 Embeddings API、Hybrid 分词等（向量相关项集中在「向量召回」Tab）。
- **语言**：界面中/英文切换。
- **主题、字号** 等显示选项。

API 密钥保存在本机数据目录，不会写入浏览器公开存储。

---

## 配置（`config.yaml`）

常用项：

| 配置项 | 说明 |
|--------|------|
| `dataDir` | 数据目录，默认 `./data` |
| `serverPort` | 启动后浏览器访问端口（`!_start.bat` 使用） |
| `startCountdownSeconds` | 启动前倒计时秒数；`0` = 不等待 |
| `authIdleMinutes` 等 | 登录会话超时（可选） |

完整说明见 `config.example.yaml` 中的注释。

---

## 数据与备份

所有对话、角色、提示词、资料库、API 配置等均在 **`dataDir`** 下（默认项目内的 **`data/`** 文件夹），按用户分子目录。

- **备份**：复制整个 `data/` 目录即可。
- **换机恢复**：在新机器安装程序后，用备份的 `data/` 替换即可。
- **同步**（如 Syncthing）：请避免两台机器**同时**写入同一数据目录，以免文件冲突。

更细的路径说明见 [`data/README.zh.md`](../data/README.zh.md)（[English](../data/README.md)）。

---

## 常见问题

**打不开页面**

- 确认启动窗口仍在运行，且端口未被其它程序占用。
- 检查 `config.yaml` 的 `serverPort` 与浏览器地址是否一致。

**改代码后界面没变化**

- 重新 `!_start.bat`，倒计时期间按 **`B`** 强制重新编译。

**忘记密码**

- 需在数据目录中处理用户记录，或删除对应用户数据后重新注册（会丢失该用户数据）。开发/运维细节见 `DOC/devNotes/` 文档。

**生产环境 JWT**

- 首次 `!_start.bat` 启动会在 `data/.jwt-secret` 自动生成密钥；也可在 `config.yaml` 设置 `jwtSecret`（≥16 字符）。

**`npm audit` 报 high / 提示 `--force`**

- 终端用户只需 `./start.sh` / `!_start.bat`（或 `npm start`），**不必**跑 `npm audit`，也**不要**执行 `npm audit fix --force`（会跨大版本升级，容易装坏）。
- 当前 `main` 已固定修补后的 **`@fastify/static`**、**`sharp`**、**`vue-tsc`**。`git pull` 后正常安装，`npm audit` 应为 **0 vulnerabilities**；旧克隆可能仍显示过期告警，更新即可。
- `allow-scripts` 关于 esbuild / sharp 安装脚本的提示属于正常原生依赖安装，与上述 CVE 不是一类问题。

---

## 开发者文档

架构、接口与实现细节见 **`DOC/devNotes/`** 目录；项目索引见 [`cursor.md`](../cursor.md)。新手教程：[中文](manual/CN/00-menu.md) · [English](manual/EN/00-menu.md)。文档总览见 [`DOC/README.md`](README.md)。

开发模式：

```bash
npm install
npm run dev
```

`npm run dev` 会并行启动 **`scripts/watch-plugins.mjs`**：监听仓库 `plugins/*/src` 等，仅在源码新于 `dist` 时重建（避免 Windows 监听误报）。调试：`PLUGIN_WATCH_DEBUG=1`。

浏览器访问 `config.yaml` 中的 **`webPort`**（默认与 `serverPort` 不同）。

---

## 致谢

特别感谢以下先驱作者与软件带来的灵感与启示：

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — SillyTavern 团队
- [SillyTavern Memory Books (STMB)](https://github.com/aikohanasaki/SillyTavern-MemoryBooks) — aikohanasaki
- [SillyTavern WTracker](https://github.com/bmen25124/SillyTavern-WTracker) — bmen25124
- [Guided Generations](https://github.com/Samueras/GuidedGenerations-Extension) — Samueras
- [All But This Swipe](https://github.com/Avilnetro/all-but-this-swipe) — Avilnetro
