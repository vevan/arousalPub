# D-06 · 常见问题排查

完成本章后：能对照常见症状快速自查；仍不行时知道该看日志或启动窗口报错。

上一章：[D-05 · 第一方插件使用指南](D-05-bundled-plugins.md) · 下一章：无 · [目录](00-menu.md) · [English](../EN/D-06-troubleshooting.md)

---

## 打不开页面

1. 启动窗口 / 容器是否还在跑？关掉就等于停服。
2. 地址端口是否与 `config.yaml` 的 **`serverPort`** 一致？（默认 `http://localhost:6633/`）
3. Docker 用户：是否误开了 **6699**？正式入口是 **6633**（见 [C-02](C-02-docker.md)）。
4. 本机 `!_start` 与 Docker **不要同时**占用同一端口。
5. Docker：`docker compose ps`、`docker compose logs -f`；`curl http://127.0.0.1:6633/health` 应返回 `{"ok":true}`。

---

## 能打开但没有 AI 回复

1. 顶栏是否警告去配 **连接**？→ [A-03 · 连接 API](A-03-connect-api.md)。
2. 打开 **连接**，确认 Base URL（含 `/v1`）、Key、模型 ID，点 **测试连接**。
3. 服务商侧额度、网络、防火墙是否拦截。

---

## 改了代码 / 更新后界面没变

1. 若项目是用 Git 克隆的：在项目根目录执行 **`git pull`** 拉最新代码（见 [A-01](A-01-install-and-start.md)），再启动。
2. 用 `!_start` 重启。
3. 倒计时期间按 **`B`** 强制重新编译（见 [C-03](C-03-startup-options.md)）。
3. 开发调试请用 `npm run dev`，并访问 **`webPort`**，不要和正式端口搞混。

---

## 忘记密码

应用**没有**邮箱重置。

- 还记得旧密码： **设置 → 账号 → 修改密码**。
- 完全忘记：只能在数据目录处理 `users.index.json` 中的用户记录，或删除该用户数据后重新注册——**会丢失该用户全部数据**。操作前请先备份 `data/`（[C-01](C-01-data-and-backup.md)）。运维细节见 `DOC/devNotes/`。

---

## 向量 / 记忆异常

1. **设置 → 向量召回**：Embeddings **测试 Embedding** 是否通过（[B-07](B-07-vector-recall.md)）。
2. **本对话设置 → 向量召回 → 重建记忆索引**。
3. 刚改过 Hybrid 分词：对各相关会话重建索引。
4. 使用内置 Embedding 时，先点 **准备模型**；已下载模型应从界面显示的固定 revision 缓存目录离线加载。
5. 重建成功但提示仍存在：刷新页面确认前后端均为最新版本；索引会记录 effective embedding profile 与 Hybrid 复合规格，二者任一仍不一致都会继续提示。

---

## 看不到审计 / 预览失败

1. **设置 → 调试** 是否打开 **「启用会话 debug 审计」**（见 [D-04](D-04-session-debug-audit.md)）。
2. 审计按钮在**助手消息**工具栏；须先对该轮 **发送** 或 **再生** 成功落盘。
3. **预览** 与 **审计** 共用同一开关；关闭后不再写入新条目。

---

## 插件不显示或无效

1. **设置 → 插件** 是否已 **启用** 对应插件（见 [D-02](D-02-plugins-intro.md)、[D-05](D-05-bundled-plugins.md)）。
2. 部分插件仅在**对话页工具栏**或消息下方出现；刷新或重新进入对话。
3. 剧情纪要 / 迹录等二次 LLM 插件是否配置了 **API 预设**。

---

## 背景 / BGM / 知识库选不到文件

1. 先到顶栏 **「文件」→ 资产库** 上传（见 [B-04](B-04-files-and-assets.md)）；绑定面板不能上传。
2. 背景需**图片**，BGM 需**音频**；类型不对时选择器可能为空。
3. 知识库召回：文档须加入 **知识库** Tab，并勾选 **本对话设置 → 绑定 → 知识库**；Embeddings 见 [B-07](B-07-vector-recall.md)。

---

## 导入失败（ST）

1. 角色请走 **角色库 → 导入**，不是设置导入 Tab 的角色批量入口。
2. 聊天 JSONL：须先选用户角色与对话角色；目标会话已有消息时可能失败（[D-03](D-03-from-sillytavern.md)）。
3. 文件是否确为对应格式（PNG/JSON / 世界书 JSON / 预设 JSON / JSONL）。
4. **正则脚本**不能走导入 Tab，需在 **设置 → 正则替换** 重建（[B-06](B-06-regex-rules.md)）。

---

## 正则改了气泡 / 历史，却不符合预期

1. 分清阶段：**显示**只改界面；**出站**改发给模型的内容；**落盘**改磁盘（[B-06](B-06-regex-rules.md)）。
2. 历史落盘要用 **本对话设置 → 正则批量**，并先 **试运行**。
3. 可开审计看 **提示词** / 性能里的正则耗时（[D-04](D-04-session-debug-audit.md)）。

---

## 构建报错：找不到 `@huggingface/transformers`

1. 症状：`server` 构建阶段 `tsc` 报 `TS2307: Cannot find module '@huggingface/transformers'`（常见于刚 `git pull` 进内置 Embedding 依赖后、本地尚未重装依赖）。
2. 在项目根执行 `npm install`，或用 `./start.sh` / `!_start.bat` 让 `ensure-deps` 自动安装，然后再 `npm run build`。
3. 版本须为锁定的 `4.0.1`（见 `server/package.json`）；勿手改成 `^` 范围。若安装脚本有待审批提示，见下一节。

---

## `npm audit` 看起来很吓人

1. 使用本应用**不必**跑 `npm audit`；按 `./start.sh` / `!_start.bat` 即可。
2. **不要**执行 `npm audit fix --force`——可能跨大版本乱升依赖并装坏。
3. 当前 `main` 已修好生产依赖（`@fastify/static`、`sharp`）与前端类型检查工具（`vue-tsc`）；`git pull` 后正常安装，`npm audit` 应干净。
4. 当前根 `package.json` 已固定批准 `esbuild@0.28.1`、`onnxruntime-node@1.24.3`、`protobufjs@7.6.5` 和 `vue-demi@0.14.10` 的安装脚本，正常安装不应再出现待审批提示。旧检出版本如有提示，应审阅当前版本后执行 `npm approve-scripts esbuild onnxruntime-node protobufjs vue-demi`；这类提示与上面的 CVE 列表不是一类问题。

---

## 仍无法解决

1. 完整复制启动窗口或 `docker compose logs` 中的报错。
2. 确认 Node ≥ 24.14.0、磁盘空间足够、`data/` 可写。
3. 开发向问题查阅 [`DOC/devNotes/`](../../devNotes/)；产品总览见 [`DOC/README.zh.md`](../../README.zh.md)。

返回目录：[00-menu.md](00-menu.md)。
