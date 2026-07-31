# C-03 · 启动方式对照与倒计时

完成本章后：能按场景选对启动方式，并知道倒计时里 `B` / 空格的含义。

上一章：[C-02 · 用 Docker 跑](C-02-docker.md) · 下一章：[D-01 · 群聊与分支简介](D-01-group-and-branches.md) · [目录](00-menu.md) · [English](../EN/C-03-startup-options.md)

---

## 三种方式怎么选

| 方式 | 适合谁 | 浏览器地址 |
|------|------|----------|
| **`!_start.bat` / `start.sh`** | 本机日常使用（推荐） | `config.yaml` 的 **`serverPort`**（默认 6633） |
| **Docker** | NAS / 服务器容器 | 一般为宿主机映射的 6633，见 [C-02](C-02-docker.md) |
| **`npm run dev`** | 改代码、热更新 | **`webPort`**（默认常为 **6699**），与正式端口不同 |

日常聊天请用 `!_start` 或 Docker，不要误开 dev 端口当生产入口。

开发模式示例：

```bash
npm install
npm run dev
```

`npm run dev` 还会并行跑插件源码监视（`scripts/watch-plugins.mjs`）。调试可用环境变量 `PLUGIN_WATCH_DEBUG=1`。

---

## `!_start` 倒计时

配置项：`config.yaml` → **`startCountdownSeconds`**（默认 **5**；设为 **`0`** 则跳过等待）。

倒计时期间（终端为交互 TTY 时）：

| 操作 | 效果 |
|------|------|
| **不按键** | 倒计时结束后，用已有编译结果快速启动 |
| **空格** | 立刻启动，不重新 build |
| **`B`** | 重新编译前端与后端，再启动 |

另外：

- 缺少 `web/dist` 或 `server/dist`，或 git 版本与上次编译记录不一致（例如 `git pull` 后）→ **会自动编译**。
- `package-lock.json` 等依赖清单变更 → 编译前可能自动 **`npm install`**。

**改了源码但界面没变**：关掉再开 `!_start`，倒计时期间按 **`B`**。

---

## 自检

- [ ] 能说出自己平时该用 `!_start`、Docker 还是 `npm run dev`。
- [ ] 知道按 **`B`** 是强制重编译。

进阶可选：[D-01 · 群聊与分支简介](D-01-group-and-branches.md)。
