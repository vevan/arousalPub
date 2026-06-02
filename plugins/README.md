# 内置插件包（源码）

仓库内 `plugins/{pluginId}/` 为**打包源**；首次运行或 seed 时复制到 **`data/plugins/{pluginId}/`**（全局安装，全用户共用代码）。

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
| `guidance-generate` | 指导生成：弹框双输入 + `afterAssemblePrompts` 注入 hidden system |
| `reply-complete-sound` | 完成提示音：LLM 回复结束后播放音频（默认 `assets/default.mp3`） |

详见 **`DOC/09-plugin-system-and-guidance-generate.md`**。

对话批量 read/patch（清理滑动、regex 等）规划见 **`DOC/10-plugin-conversation-host.md`**（尚未实现）。

## 新增 bundled 插件

1. 在本目录新增 `{pluginId}/` 并写好 `manifest.json`、`dist/`。
2. 在 `server/src/plugin-system/loader.ts` 的 `BUNDLED_PLUGIN_IDS` 与 `BUNDLED_PLUGIN_ORDERS` 中注册。
3. 在 `server/src/plugin-system/registry.ts` 的 `DEFAULT_REGISTRY` 中加入默认条目。
4. 重启服务后 seed 会安装到 `data/plugins/`；各用户 registry 会自动补条目。
