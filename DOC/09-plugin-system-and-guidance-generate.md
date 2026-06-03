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
| GET | `/api/plugins/registry` | 当前用户**已启用**插件元数据（含 `slots`、`webEntry`；**不**执行 web 模块） |
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

- `usePluginHost`：**进聊天页只拉 registry**；`web.mjs` 按 **manifest 声明的 slot 懒加载**（见 §5.4）。
- **Slot**：`PluginSlotMount` 在 `onMounted` 时对该 slot 调用 `ensureSlotPlugins(slotName)`，再渲染已注册按钮。
- **动作弹框**：`PluginFormDialogHost`（指导生成 send/regenerate、对话导出等；与 settings 表单分离）。
- **生命周期**：
  - `host.lifecycle.onAssistantReplyPersisted` — 流式结束后服务端落盘成功（SSE `arousal.persist` 或非流式 JSON 的 `persist.ok`）时触发；**早于** `loadMessages` 与 UI 全量刷新。
  - `host.lifecycle.onAssistantReplyComplete` — `send` / `regenerate` 流程结束（含 `loadMessages` 之后）；适合不依赖落盘时刻的收尾逻辑。

### 5.4 Web 模块加载策略（slot 级懒加载）

| 时机 | 行为 |
|------|------|
| 进聊天页 `onMounted` | `GET /api/plugins/registry`；**不**立即 import 全部 `web.mjs` |
| 无 slot、仅 lifecycle 的 web 插件 | registry 就绪后 **eager** 加载（须在 `register()` 里挂 lifecycle） |
| `PluginSlotMount` 挂载某 slot | `ensureSlotPlugins(slotName)`：并行加载 manifest `ui.slots` **含该 name** 且已启用的插件 |
| 同一插件多 slot | 只 import / `register` **一次**（按 `pluginId` 去重） |
| locales | 与对应插件 **首次加载时** merge，非进页全量 merge |

**对作者的含义**：

1. **`manifest.ui.slots[].name` 必须列齐**本插件用到的 slot（如 `composer-toolbar`、`assistant-turn-footer`）；漏声明则该 slot 出现时**不会**加载你的 `web.mjs`。
2. **`register(host)` 必须轻量**：只注册 slot 按钮 / 表单 / lifecycle；重逻辑放在 `onClick`、`onSubmit`、`runScope` 等 handler 内。
3. **大依赖**在 handler 里再 `import()`，不要写在模块顶层。
4. **仅 lifecycle、无 slot** 的插件（未来）：manifest 不写 slots → 进聊天即加载；适合 `reply-complete-sound` 若去掉 composer 试听钮仍要听音的场景。
5. 首帧某 slot 按钮可能 **短暂空白**（await 加载）；加载完成后 `slotButtonRevision` 触发重绘。

宿主 API（聊天页 inject `PLUGIN_HOST_KEY`）：

- `ensureSlotPlugins(slotName: string): Promise<void>`
- `ensurePluginById(pluginId: string): Promise<void>` — 极少用；表单等需确保已 register 时
- `registryLoaded` — registry 是否已拉取（原 `loaded` 别名仍保留）

### 5.2 设置页 → 插件 Tab

- 列表：名称、版本、hooks；**拖曳排序**、**启用开关**。
- **设置**按钮：按 `manifest.settingsSchema` 自动生成表单（`PluginSchemaForm`）。
- **enabled** 只写在 **registry**，不写 settings。

### 5.3 对话读写宿主

批量 read/patch 见 **`DOC/10-plugin-conversation-host.md`**（`host.conversation`、`runScope`、`render`、`ui.progress` 等）。

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

- **纯 Web**（无 server hook）；声明 `composer-toolbar` 时随输入区 slot 懒加载 `web.mjs`。
- **主触发**：`onAssistantReplyPersisted`（落盘成功即播，避免后台标签在 `loadMessages` / 滚动节流期间延迟数分钟）。
- **兜底**：`onAssistantReplyComplete`；同一请求的 `traceId` 已播则跳过（去重）。
- **默认音**：`assets/default.mp3`（bundled）。
- **settings**：`soundSource`（default/custom）、`soundFile`（fileAsset 上传）、`repeatCount`、`repeatGapMs`、`volume`（slider 0–1）。
- **Composer**：试听按钮（▶），非启用开关。
- **部署**：运行时加载 `data/plugins/<id>/dist/web.mjs`；改仓库 `plugins/` 后需同步到 `data/plugins/` 并刷新页面。

---

### 7.3 `swipe-cleaner` / `conversation-export`

见 **`DOC/10-plugin-conversation-host.md`** §6。

---

## 8. 插件作者指南

### 8.1 仓库与注册

1. `plugins/{id}/`：`manifest.json`、`dist/`、`locales/`、`settings.json` 模板。
2. 加入 `server/src/plugin-system/loader.ts` 的 `BUNDLED_PLUGIN_IDS` / `BUNDLED_PLUGIN_ORDERS` 与 `scripts/sync-bundled-plugins.mjs`。
3. Server hook（可选）：`dist/server.mjs` export `afterAssemblePrompts` 等；读 `api.getUserPluginSettings`。

### 8.2 manifest 与 slot 声明

```json
"ui": {
  "slots": [
    { "name": "composer-toolbar", "entry": "./dist/web.mjs" },
    { "name": "assistant-turn-footer", "entry": "./dist/web.mjs" }
  ]
}
```

- **`name`** 必须与宿主 DOM 上的 slot 一致（`PluginSlotMount` 的 `slot-name` / `data-plugin-slot`）。
- 同一插件多个 slot 可共用一条 `entry`；宿主对每个 slot **懒加载**，但 `register()` 只执行一次。
- **漏写 slot** → 该位置的按钮/逻辑永远不会加载。

### 8.3 `register(host)` 性能约定

| 应该 | 不应该 |
|------|--------|
| `registerSlotButton` / `registerFormDialog` / `lifecycle.on*` | 顶层 fetch 全量对话、拼大 HTML、读大文件 |
| handler 内按需 `await` 重活 | 模块加载时 `for` 循环处理全部 turns |
| 大库在 `onClick` 里 dynamic import | 顶层 import 巨型第三方库 |
| `host.pluginKey('tooltip')` 引用 i18n | 硬编码中文（settings 页除外） |

### 8.4 Web 能力速查

- **Slot 按钮**：`host.registerSlotButton(slot, { id, icon, tooltipKey, when, disabled, onClick })`
- **动作弹框**：`host.registerFormDialog` + `host.openFormDialog`（字段类型见 §3.1；宿主 `PluginFormDialogHost` 支持 `radio` / `integer` / `textarea`）
- **对话批处理**：`host.conversation.runScope` / `runBatch`、`getMeta`、`host.render.*`、`host.ui.progress` — 见 DOC/10
- **Toast / Confirm**：`host.ui.toast` / `host.ui.confirm`
- **发消息扩展**：`host.chat.sendWithPlugins` / `regenerateWithPlugins` + server `resolveTurnPluginEntries`

### 8.5 加载时机（避免「我的插件没反应」）

| 插件类型 | 何时加载 `web.mjs` |
|----------|-------------------|
| 声明了 `composer-toolbar` | 输入区挂载时（进聊天即有） |
| 仅 `assistant-turn-footer` | 助手气泡 footer 首次渲染时 |
| 仅 `user-turn-footer` | 用户气泡 footer 首次渲染时 |
| `slots: []` 且无 slot 名 | 进聊天页 registry 后 eager |
| registry `enabled: false` | 永不加载 |

### 8.6 验收自检

- [ ] manifest `slots` 与代码里 `registerSlotButton` 的 slot 名一致
- [ ] `register()` 在 DevTools Performance 里 < 几 ms 级
- [ ] 禁用插件后聊天页无该插件请求（Network 无对应 `web.mjs`）
- [ ] locales 键在 `locales/en.json` 与 `zh.json` 成对存在

---

## 9. 插件作者清单（简表）

1. `plugins/{id}/manifest.json` + `dist/` + `locales/`。
2. 注册 `BUNDLED_PLUGIN_IDS`（见 `plugins/README.md`）。
3. Web：`host.pluginKey('…')`；slot / lifecycle / 表单按需注册；**遵守 §8.3 轻量 register**。
4. Server：export hook；读 `api.getUserPluginSettings`。
5. 需要上传文件：`fileAsset` + `accept`。

---

## 10. Syncthing

| 层级 | 路径 |
|------|------|
| 权威 | `{userId}/plugin-registry.json`、`plugins/*/manifest.json`、`plugins/*/{userId}/settings.json` |
| 权威 | `plugins/*/{userId}/assets/`（用户上传） |
| 权威 | `chats/**/turn-*.json`（含 `turn.plugins`） |
| 全局代码 | `data/plugins/{id}/`（manifest/dist/locales/assets，通常各节点一致） |

## 11. 验收参考

- [x] 设置 → 插件：列表、排序、启用、schema 表单保存。
- [x] 指导生成：弹框、注入、可配置 `systemPrefix`。
- [x] 完成提示音：默认 mp3、自定义上传、重复次数、音量 slider。
- [x] 分用户 registry 互不影响。
- [x] slot 级懒加载：进聊天仅 registry；`assistant-turn-footer` 等 slot 首次挂载才拉对应 `web.mjs`。
