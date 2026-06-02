# 插件系统 — 设计与实现

> **状态**：**已实现**（动态加载、`settingsSchema` 设置页、两个内置插件）。  
> **关联**：`DOC/01` §7、`DOC/03` §1.4、`DOC/03` §6.8 `turn.plugins[]`；`plugins/README.md`。

---

## 1. 原则

| 项 | 定案 |
|----|------|
| 插件代码 | **`data/plugins/<pluginId>/`** 全局安装一次（`manifest`、`dist`、`locales`、`assets`） |
| 启用 / 排序 | **`data/{userId}/plugin-registry.json`**（分用户，设置页管理） |
| 插件参数 | **`data/plugins/<pluginId>/{userId}/settings.json`**（schema 在 manifest） |
| Hook 顺序 | registry 内 **`order` 升序**；同 phase 内小者优先 |
| 轮次 state | **`turn.plugins[]`**，跟 `turnId`；不污染可见 `userText` |
| i18n | 插件自带 **`locales/{en,zh}.json`** → 宿主 merge 到 **`plugins.{pluginId}.*`** |

---

## 2. 目录布局

```text
data/
  {userId}/
    plugin-registry.json     # 该用户：enabled + order
  plugins/
    {pluginId}/
      manifest.json
      dist/server.mjs | web.mjs
      locales/en.json | zh.json
      assets/                # 可选，全局默认资源（如 default.mp3）
      {userId}/
        settings.json        # 该用户插件参数
        assets/              # fileAsset 上传（自定义 mp3 等）
        secrets/             # 可选
```

**迁移**：旧版全局 `data/plugin-registry.json` 会在用户首次访问时复制到 `data/{userId}/plugin-registry.json`。

---

## 3. manifest.json

```json
{
  "id": "guidance-generate",
  "name": "指导生成",
  "version": "1.0.0",
  "hooks": ["afterAssemblePrompts"],
  "settingsSchema": {
    "version": 1,
    "fields": [
      {
        "key": "systemPrefix",
        "type": "text",
        "labelKey": "systemPrefixLabel",
        "descriptionKey": "systemPrefixDesc",
        "default": "Please generate a reply according to this guidance together with the user's message: ",
        "maxLength": 4000
      }
    ]
  },
  "ui": {
    "slots": [
      { "name": "composer-toolbar", "entry": "./dist/web.mjs" }
    ]
  }
}
```

### 3.1 settingsSchema 字段类型

| type | 说明 | 常用属性 |
|------|------|----------|
| `boolean` | 开关 | `default` |
| `integer` / `number` | 数字 | `min`, `max`, `default` |
| `string` | 单行 | `maxLength` |
| `text` | 多行 | `maxLength` |
| `enum` | 下拉 | `enum`, `default` |
| `fileAsset` | 用户上传文件 | `accept`, `purpose`, `visibleWhen` |

可选：

- **`widget: "slider"`** — 与 `number`/`integer` 合用，设置页渲染滑块（如音量 0–1）。
- **`step`** — slider / 数字步进。
- **`visibleWhen`** — `{ "field": "soundSource", "equals": "custom" }` 条件显示。

文案键写在插件 **`locales/*.json`**，表单用 `labelKey` / `descriptionKey`（宿主 `t('plugins.{id}.{key}')`）。

---

## 4. HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins/registry` | 当前用户**已启用**插件（聊天页加载 web.mjs） |
| GET | `/api/plugins/manage` | 设置页完整列表 + `settingsSchema` |
| PUT | `/api/plugins/registry` | 保存 `{ plugins: [{ id, enabled, order }] }` |
| GET/PUT | `/api/plugins/:id/settings` | 读写合并后的 settings |
| GET | `/api/plugins/:id/dist/web.mjs` | 动态加载 Web 模块（需 JWT） |
| GET | `/api/plugins/:id/locales/:locale.json` | 插件 i18n |
| GET | `/api/plugins/:id/assets/:name` | 全局 bundled 资源 |
| GET | `/api/plugins/:id/user-assets/:name` | 用户上传资源（支持 `?access_token=`） |
| POST | `/api/plugins/:id/user-assets` | multipart 上传（`file` + 可选 `fieldKey`） |

发消息扩展（指导生成等）：

```json
{
  "plugins": {
    "guidance-generate": {
      "mode": "send",
      "guidanceText": "…"
    }
  }
}
```

---

## 5. Web 宿主

### 5.1 聊天页 PluginHost

- `usePluginHost`：拉 registry → merge locales → blob 动态 import `web.mjs` → `register(host)`。
- **Slot**：`PluginSlotMount`，`data-plugin-slot` 如 `composer-toolbar`、`user-turn-footer`。
- **动作弹框**：`PluginFormDialogHost`（指导生成 send/regenerate，与 settings 表单分离）。
- **生命周期**：
  - `host.lifecycle.onAssistantReplyPersisted` — 流式结束后服务端落盘成功（SSE `arousal.persist` 或非流式 JSON 的 `persist.ok`）时触发；**早于** `loadMessages` 与 UI 全量刷新。
  - `host.lifecycle.onAssistantReplyComplete` — `send` / `regenerate` 流程结束（含 `loadMessages` 之后）；适合不依赖落盘时刻的收尾逻辑。

### 5.2 设置页 → 插件 Tab

- 列表：名称、版本、hooks；**拖曳排序**、**启用开关**。
- **设置**按钮：按 `manifest.settingsSchema` 自动生成表单（`PluginSchemaForm`）。
- **enabled** 只写在 **registry**，不写 settings。

### 5.3 对话读写宿主（规划）

批量读写在 chunk 上的 turn 字段（清理滑动、regex 等）**不**开放直接读盘；由 **`host.conversation`** 提供 read / patch / `runBatch`（单批 **≤50 轮**、批处理期间对话写锁）。详见 **`DOC/10-plugin-conversation-host.md`**（尚未实现）。

---

## 6. 服务端 PluginHost

- `loadEnabledServerPlugins(userId)`：读该用户 registry，动态 import `dist/server.mjs`。
- Hook 已实现：**`afterAssemblePrompts`**、`resolveTurnPluginEntries`（指导生成落盘）。
- **`api.getUserPluginSettings(pluginId)`**：读合并后的 `{userId}/settings.json` + schema 默认值。

---

## 7. 内置插件

### 7.1 `guidance-generate`（指导生成）

- **UI**：composer + 最后 user turn 弹框（用户文 + 指导文）。
- **Prompt**：指导 append 到 **messages 末尾** hidden system；前缀可配置 **`settings.systemPrefix`**（多行 text）。
- **落盘**：`turn.plugins[].payload.guidanceText`。

### 7.2 `reply-complete-sound`（完成提示音）

- **纯 Web**（无 server hook）；registry 启用后加载 `web.mjs`。
- **主触发**：`onAssistantReplyPersisted`（落盘成功即播，避免后台标签在 `loadMessages` / 滚动节流期间延迟数分钟）。
- **兜底**：`onAssistantReplyComplete`；同一请求的 `traceId` 已播则跳过（去重）。
- **默认音**：`assets/default.mp3`（bundled）。
- **settings**：`soundSource`（default/custom）、`soundFile`（fileAsset 上传）、`repeatCount`、`repeatGapMs`、`volume`（slider 0–1）。
- **Composer**：试听按钮（▶），非启用开关。
- **部署**：运行时加载 `data/plugins/<id>/dist/web.mjs`；改仓库 `plugins/` 后需同步到 `data/plugins/` 并刷新页面。

---

## 8. 插件作者清单

1. `plugins/{id}/manifest.json` + `dist/` + `locales/`。
2. 注册 `BUNDLED_PLUGIN_IDS`（见 `plugins/README.md`）。
3. Web：`host.pluginKey('…')` 引用文案；slot / lifecycle / 动作弹框按需注册。
4. Server：export hook；读 `api.getUserPluginSettings`。
5. 需要上传文件：`fileAsset` + `accept: [".mp3", ".wav"]`。

---

## 9. Syncthing

| 层级 | 路径 |
|------|------|
| 权威 | `{userId}/plugin-registry.json`、`plugins/*/manifest.json`、`plugins/*/{userId}/settings.json` |
| 权威 | `plugins/*/{userId}/assets/`（用户上传） |
| 权威 | `chats/**/turn-*.json`（含 `turn.plugins`） |
| 全局代码 | `data/plugins/{id}/`（manifest/dist/locales/assets，通常各节点一致） |

---

## 10. 验收参考

- [x] 设置 → 插件：列表、排序、启用、schema 表单保存。
- [x] 指导生成：弹框、注入、可配置 `systemPrefix`。
- [x] 完成提示音：默认 mp3、自定义上传、重复次数、音量 slider。
- [x] 分用户 registry 互不影响。
