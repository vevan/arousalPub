# 内置插件包（源码）

仓库内 `plugins/{pluginId}/` 为**打包源**；首次运行或 seed 时复制到 **`data/plugins/{pluginId}/`**（全局安装，全用户共用代码）。

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
| `guidance-generate` | 指导生成：send/regenerate/revise 三模式 + `afterAssemblePrompts` 注入 hidden system；设置页 `systemPrefix` / `reviseSystemPrefix` |
| `reply-complete-sound` | 完成提示音：LLM 回复结束后播放音频（默认 `assets/default.mp3`） |
| `swipe-cleaner` | 滑动清理：删除未选中的 swipe 候选（轮次级 / 整聊） |
| `conversation-export` | 对话导出 HTML（分批 read、`runScope`、导出对话框） |
| `plot-summary` | Historian：剧情纪要摘要、sidecar、预览确认、`prepareContextBlocks` / `completeWithContext` |
| `custom-styles` | 自定义样式注入：全局 CSS 样式表 + 对话级开关覆盖，`registerStyles` |
| `trace-keeper` | **迹录**：RP 场景状态追踪、Together + Separate、左栏 HTML 面板；见 **`DOC/30-plugin-trace-keeper.md`** |

**插件作者主文档（宿主 API 单一入口）**：**`DOC/18-plugin-host-developer-api.md`**。

**插件出站 API 解析**（`complete` / `preflight` / `complete-with-context`）：`对话 apiPreset.plugins[pluginId]` → `apiPreset.plugin` → **插件设置页 `apiConfigId`**。连接设置无全局 plugin binding。实现：`server/src/plugin-api-resolve.ts`。

**插件系统**（manifest、懒加载、设置页）：**`DOC/09-plugin-system-and-guidance-generate.md`**。

**业务示例**：Historian **`DOC/12-plugin-plot-summary.md`**；对话 read/patch 细节 **`DOC/10-plugin-conversation-host.md`**；补全/lorebook 产品定案 **`DOC/11-plugin-host-completion-and-lorebook.md`**。

## 新增 bundled 插件

1. 在本目录新增 `{pluginId}/` 并写好 `manifest.json`、`dist/`。
2. 在 `server/src/plugin-system/loader.ts` 的 `BUNDLED_PLUGIN_IDS` 与 `BUNDLED_PLUGIN_ORDERS` 中注册。
3. 在 `scripts/sync-bundled-plugins.mjs` 的 `BUNDLED_PLUGIN_IDS` 中加入 id。
4. 重启服务 / 跑 sync 后安装到 `data/plugins/`；各用户 registry 会自动补条目。
5. **`manifest.ui.slots` 列齐所有用到的 slot 名**，否则宿主不会懒加载你的 `web.mjs`。

