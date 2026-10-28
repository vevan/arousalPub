# 内置插件包（源码）

仓库内 `plugins/{pluginId}/` 为**打包源**；首次运行或 seed 时复制到 **`data/plugins/{pluginId}/`**（全局安装，全用户共用代码）。

**`dist/` 不入库**：由各插件 `build.mjs` 生成；`npm run build`（全量 `--force`）、`npm start` / `npm run dev`（缺或 stale 时 `ensurePluginDist`）会先编再同步。

**Build 同步**：`npm run build` 末尾会执行 `scripts/sync-bundled-plugins.mjs`，从仓库 `plugins/{id}/` **全量覆盖** `{dataDir}/plugins/{id}/` 的 manifest、dist、locales、assets（**不**覆盖各用户的 `settings.json`）。服务启动时也会再同步一次，避免漏跑 build。

**plot-summary 共享模块**：`plugins/plot-summary/src/shared/` 为 Historian 排序、prepare-context 块与 layout 之**源码**（不再同步至 `server/src/plot-summary/`）。

## 目录结构（单插件）

```text
plugins/{pluginId}/
  manifest.json       # id、hooks、ui.slots、settingsSchema
  settings.json       # 新用户 settings 模板（seed 到 data/plugins/{id}/{userId}/）
  locales/
    en.json
    zh.json
  assets/             # 可选：全局静态资源（如 default.mp3）
  dist/
    server.mjs        # 服务端 hook（可选，纯 Web 插件可留空）
    web.mjs           # export register(host)
```

## 当前内置插件

| id | 说明 |
|----|------|
| `guidance-generate` | 指导生成：send/regenerate/revise 三模式 + `resolveAfterAssemblePromptsAddition` 注入描述符；设置页 `systemPrefix` / `reviseSystemPrefix` |
| `reply-complete-sound` | 完成提示音：LLM 回复结束后播放音频（默认 `assets/default.mp3`） |
| `swipe-cleaner` | 滑动清理：删除未选中的 swipe 候选（轮次级 / 整聊） |
| `conversation-export` | 对话导出 HTML（分批 read、`runScope`、导出对话框） |
| `plot-summary` | Historian：剧情纪要摘要、sidecar、预览确认、`prepareContextBlocks` / `completeWithContext` |
| `custom-styles` | 自定义样式注入：全局 CSS 样式表 + 对话级开关覆盖，`registerStyles` |
| `trace-keeper` | **迹录**：RP 场景状态追踪、Together + Separate（`completeWithContext`）、左栏 HTML 面板；见 **`DOC/devNotes/30`** |

**插件作者主文档（宿主 API 单一入口）**：**`DOC/devNotes/18-plugin-host-developer-api.md`**。

**插件出站 API 解析**：`对话 pluginSettings.apiConfigId` → `全局 settings.apiConfigId` → `activePresetId`。实现：`server/src/plugin-api-resolve.ts` · [`DOC/devNotes/43`](43-plugin-api-binding-audit-checklist.md) §1.1。

**插件系统**（manifest、懒加载、设置页）：**`DOC/devNotes/09-plugin-system-and-guidance-generate.md`**。

**业务示例**：Historian **`DOC/devNotes/12-plugin-plot-summary.md`**；对话 read/patch 细节 **`DOC/devNotes/10-plugin-conversation-host.md`**；补全/lorebook 产品定案 **`DOC/devNotes/11-plugin-host-completion-and-lorebook.md`**。

## 新增 bundled 插件

1. 在本目录新增 `{pluginId}/`：`manifest.json`、`src/`、`build.mjs`（产出 `dist/`）。
2. 写入 `plugins/bundled-registry.json`（或跑 `generate:bundled-registry`）。
3. `npm run build:plugins -- --force` 或 `npm start` / `npm run build` 生成 dist 并 sync 到 `data/plugins/`；各用户 registry 会自动补条目。
4. **`manifest.ui.slots` 列齐所有用到的 slot 名**，否则宿主不会懒加载你的 `web.mjs`。

