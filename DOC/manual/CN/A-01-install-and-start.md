# A-01 · 安装与启动

完成本章后：本机能跑起 arousalPub，浏览器能打开界面。

上一章：无（本篇为起点） · 下一章：[A-02 · 首次登录与账户](A-02-first-login.md) · [目录](00-menu.md) · [English](../EN/A-01-install-and-start.md)

---

## 你需要准备

1. **Node.js 22 或更高**（建议从 [nodejs.org](https://nodejs.org/) 安装 LTS）。
2. 现代浏览器（Chrome、Edge、Firefox 等）。
3. **Git**（用命令行从仓库下载 / 更新时需要；可从 [git-scm.com](https://git-scm.com/) 安装）。
4. 本项目文件夹（见下方「获取代码」）。

在终端执行 `node -v`，版本号应 ≥ `v22`。若过低，请先升级再继续。可再执行 `git -v`（或 `git --version`）确认 Git 可用。

---

## 步骤

### 1. 获取代码（命令行）

打开终端（Windows 可用「命令提示符」「PowerShell」或 Git Bash），进入你想放项目的目录，然后：

**第一次安装 —— 克隆仓库**

```bash
git clone https://github.com/vevan/arousalPub.git
cd arousalPub
```

克隆完成后，后续步骤都在 **`arousalPub` 项目根目录** 里做（能看到 `!_start.bat` / `start.sh` 的那一层）。

**以后更新 —— 拉取最新代码**

先进入项目目录，再执行：

```bash
cd arousalPub
git pull
```

`git pull` 成功后重新启动即可。若依赖或构建有变，启动时通常会自动安装依赖并编译，一般不必手动 `npm install`。

**不想用 Git？** 也可在 GitHub 页面下载 ZIP 并解压；ZIP 安装无法用 `git pull` 更新，需重新下载 ZIP，或改用上面的 `git clone`。

### 2. 准备配置文件（可选）

项目根目录若还没有 `config.yaml`：

- 可把 `config.example.yaml` **复制**为 `config.yaml`；或
- 什么都不做——**首次启动时程序会自动从示例生成**。

新手一般不用改配置。默认浏览器端口是 **`6633`**。

### 3. 启动

| 系统 | 做法 |
|------|------|
| Windows | 双击项目根目录的 **`!_start.bat`** |
| macOS / Linux | 在项目根目录执行 **`./start.sh`** |

首次运行会自动安装依赖；缺少前端/后端构建产物时会自动编译。请**保持启动窗口不要关闭**——关掉窗口等于关掉服务。

### 4. 倒计时（了解即可）

启动前可能有几秒倒计时（默认 5 秒，可在 `config.yaml` 的 `startCountdownSeconds` 修改；设为 `0` 则跳过）：

- **不按键**：倒计时结束后用已有编译结果启动。
- **按空格**：立刻启动（不重新编译）。
- **按 `B`**：重新编译后再启动（改过程序代码时再用）。

第一次安装：不按键或按空格都可以。刚执行过 `git pull` 时，若启动脚本检测到需要编译，也会自动处理。

### 5. 打开页面

启动成功后，终端会显示地址，一般为：

```text
http://localhost:6633/
```

用浏览器打开即可。若你改过 `config.yaml` 里的 `serverPort`，地址里的端口要与之一致。

---

## 自检

- [ ] 已用 `git clone`（或解压 ZIP）得到项目文件夹。
- [ ] 启动窗口仍在运行，没有立刻报错退出。
- [ ] 浏览器能打开上述地址，看到登录或「欢迎使用」界面。

都勾上后，进入 [A-02 · 首次登录与账户](A-02-first-login.md)。

---

## 若打不开

见 [D-06 · 常见问题排查](D-06-troubleshooting.md)。常见原因：窗口已关、端口被占用、地址端口写错。

`git clone` / `git pull` 报错时：确认已安装 Git、网络可访问 GitHub，并确认当前目录是否正确（更新时须在已有的 `arousalPub` 目录内执行 `git pull`，而不是再 `clone` 一次叠一层）。
