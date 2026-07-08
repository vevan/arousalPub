# 插件沙箱化与宿主能力演进 — 设计定案（规划）

> **状态**：**Phase A + B 已落地**（2026-07-07）；Worker 默认关闭，见 `PLUGIN_SERVER_SANDBOX` · B3+ `npm run test:sandbox -w server`。  
> **关联**：`DOC/03` §1.3 插件 API 隔离 · `DOC/04` P2 · `DOC/09` · `DOC/18` §4.1 · `DOC/25` §15 · `server/src/plugin-system/loader.ts` · `server/src/plugin-host.ts`

---

## 1. 背景

当前服务端插件通过 `loadEnabledServerPlugins` → `import(pathToFileURL(server.mjs))` 与宿主**同进程**加载（`server/src/plugin-system/loader.ts`）。官方 bundled 插件仅经 `PluginServerHostApi` 访问数据；**自选第三方 `dist/server.mjs` 无沙箱**，理论上可读 `data/{userId}/api-settings.json` 等用户目录。

与此同时，组装注入 hook 已统一为描述符形态（Phase A 落地）：

| 形态 | 代表 | 状态 |
|------|------|------|
| `resolveAfterAssemblePromptsAddition` | guidance-generate · trace-keeper | ✅ 返回 `PluginPromptInjection[]`；宿主 post-user 区归并 |
| `afterAssemblePrompts` | — | escape hatch；有描述符时不再走主路径 |
| legacy `ChatMessage[]` addition | **100**（同 default） | 无单独档位；归并时用 `postUserInjectionOrder.default` |

若未来引入 Worker 沙箱，整包 messages 的 IPC 序列化将成为热路径主要开销；注入协议应先改为「描述符 + 宿主 splice」。

---

## 2. 现状：安全边界

### 2.1 已具备

| 项 | 实现 |
|----|------|
| 浏览器插件不持明文密钥 | `runPluginComplete` / `POST …/complete` 在宿主内解析 `apiConfigId` → credentials（`DOC/03` §1.3） |
| 插件 settings 分目录 | `data/plugins/{pluginId}/{userId}/settings.json` |
| manifest `permissions` | 路由层校验（conversation.read、plugin.complete 等） |
| 官方 bundled 插件 | 不直接 `readFile` 用户 API 配置；经 `api.getUserPluginSettings` 等 |

### 2.2 缺口

| 项 | 风险 |
|----|------|
| 服务端 `server.mjs` 同进程 `import`（`PLUGIN_SERVER_SANDBOX` 未开时） | 恶意插件可读盘；**设 `PLUGIN_SERVER_SANDBOX=1` 走子进程沙箱** |
| 子进程非 MicroVM | `process` 等仍存在于子进程内，但**无法读宿主 DATA_DIR**（Permission + Host API only） |
| `afterAssemblePrompts` 整表替换 | 无安全额外风险，但沙箱 IPC 成本高 |

### 2.3 目标态（定案方向）

```text
┌──────────────────────┐     IPC（process.send）      ┌─────────────────────┐
│ Plugin 子进程         │ ◄──────────────────────────► │ Host（Node 主进程）  │
│ fork(bootstrap.mjs)   │   Host API 代理 only          │ plugin-host.ts      │
│ → dist/server.mjs     │                               │ 读盘 / complete /   │
└──────────────────────┘                               │ splice messages     │
        ↑ Node --permission                             └─────────────────────┘
        （只读插件包 + bootstrap 目录）
```

- **`child_process.fork`** 独立 OS 进程；**`--permission`** 进程级禁 fs 写 / child_process / worker / addons
- **`--allow-fs-read`** 仅插件安装目录 + bootstrap 目录；用户 `data/` **不可见**
- import hook + 禁 `fetch` 为纵深防御；出站仅 Host API 代理
- invoke **串行队列**；`userId` 随 IPC 传递（并发多用户不串线）
- fork **不继承**宿主完整 `process.env`（仅 PATH/TMP 等 OS 必需项 + 入口路径）；`onClose` / SIGINT 回收子进程
- 密钥、路径解析均在宿主完成；插件 API 绑定见 §5（宿主选择器 + 用户授权 id）

---

## 3. 组装注入：对齐 §6.6 chat depth

### 3.1 定案 API（已落地）

插件 export `resolveAfterAssemblePromptsAddition`（或更名 `resolvePromptInjections`）返回 **注入描述符**，而非完整 `messages[]`：

```ts
type PluginPromptInjection = {
  role: 'system' | 'user' | 'assistant'
  content: string
  position: {
    kind: 'chat'
    depth: number
    /** 同 ST `injection_order` / preset `injectionOrder`；省略时默认 **100** */
    injectionOrder?: number
  }
}

// ctx 仍不含 messages（裁切前 token 预留）
resolveAfterAssemblePromptsAddition(
  ctx: { pluginId; macroContext; plugins? },
  api,
): PluginPromptInjection[] | null
```

**`position.injectionOrder` 与 ST 一致**（`DOC/03` §6.6 · preset `injectionOrder`）：**数值小 = 更靠近 user（post-user 区顶部）；数值大 = 更靠近栈底（生成前尾部）**。省略时默认 **100**（与 ST 导入 / 提示词 UI 一致）。**勿**与 preset 列表字段 `PromptEntry.order`（组内顺序）混淆；**勿**与插件 registry `order`（hook 调用顺序）混淆。

### 3.2 官方插件 injectionOrder 定案（一期可配置）

**默认值**（`shared/post-user-injection-order.ts` · 小=近 user · 大=近栈底）：

| 来源 | 默认 `injectionOrder` | 覆盖方式 |
|------|----------------------|----------|
| `guidance-generate` send/regenerate | **0** | manifest `assembleInjection.slots.send` |
| `guidance-generate` revise | assistant **0** + system **1** | `slots.reviseAssistant` / `slots.reviseSystem` |
| 群聊 `afterUserInput` | **20** | 用户偏好 `postUserInjectionOrder.afterUserInput` |
| preset chat depth 0（无元数据时） | **100** | `postUserInjectionOrder.presetChatDepth0` |
| （省略字段时） | **100** | `postUserInjectionOrder.default` |
| `trace-keeper` | **500** | manifest `assembleInjection.slots.default` |

**manifest 示例**（`guidance-generate`）：

```json
"assembleInjection": {
  "slots": { "send": 0, "reviseAssistant": 0, "reviseSystem": 1 }
}
```

**用户偏好示例**（分散入口 · v1 无集中设置页）：

- 群聊设置 → `afterUserInput`
- 设置 · 调试 → `default` / `presetChatDepth0`
- 各插件设置 → `assembleInjection.slotSettingsKeys` 映射字段

```json
"postUserInjectionOrder": { "afterUserInput": 25 }
```

宿主在 assemble 时将 manifest slots（+ 用户插件 settings 覆盖）经 `ctx.injectionOrderSlots` 传入 hook；归并器读 `postUserInjectionOrder` 覆盖隐式档位。

### 3.3 宿主两阶段（保持）

1. **裁切前** — `estimatePluginsAfterAssembleTokenReserve`：调用各插件 `resolveAfterAssemblePromptsAddition`，只对 `content` 计 token，`trimMaxTokens = contextLength - reserve`。
2. **regex 之后** — `applyPluginsAfterAssemblePrompts`：收集描述符，在 **post-user 区**按 `compareInjectionEntries` 归并 splice；共用 `additionCache` 避免重复调用。

`afterAssemblePrompts` 保留为 **escape hatch**（删除/重排/非追加编辑）；有描述符时优先走描述符路径。

### 3.4 post-user 区归并与 assemble 产物

regex 之后、`messages` 中最后一条 user 之后可能已有：

- preset **`chat` depth 0** 条目（自带 `injectionOrder`，常见 **100**）
- **`afterUserInput`**（群聊说明，assemble 专用 pass）

插件注入**晚于**上述步骤。宿主须：

1. 锚定 `lastUserIdx`；可选传入 `historySpan`（`historyStart`/`historyEnd`）供 depth > 0 使用（一期仅 depth 0）。
2. 为 assemble 阶段注入赋予**隐式 `injectionOrder`**（`afterUserInput` → **20**；无元数据的 preset tail → **100**）。
3. 将插件描述符与 tail 一并 hoist，在 post-user 区按 `compareInjectionEntries`（**`injectionOrder` → role**）归并。

**`afterUserInput` 识别（regex 之后）**：群聊说明在 assemble 阶段注入，宏展与 outgoing regex 可能改写正文；depth 0 作者注在物理序上亦可能位于群聊之前。宿主在 **regex 之后**调用 `resolveAssembledBlockContentAfterRegex`（synthetic 探测）解析 post-regex 正文，再经 `buildPluginAfterUserInputHintFromMessages` 精确匹配 tail；无法命中时不赋予 order **20**，避免误标 preset / authorsNote。

**一期不实现** preset 级 `relative` 锚点；ST 扩展类插件场景以 **chat depth 0** 为主。

### 3.5 与 `afterAssemblePrompts` 对比

| | 描述符 + 宿主 splice | `afterAssemblePrompts` |
|--|---------------------|------------------------|
| 插件是否读 messages 正文 | 否 | 是（整表） |
| 裁切前 token 预留 | ✅ | 仅 addition 路径 |
| 沙箱 IPC 载荷 | `{ role, content, position }[]` 小 | 整包 messages 大 |
| guidance 所需 | ✅ depth 0 + `injectionOrder` | 过重 |

---

## 4. 沙箱化：性能粗估与优先级

相对 LLM 延迟可忽略；相对组装热路径需关注 **messages 序列化**。

| 场景 | 同进程现状 | Worker + IPC（粗估） |
|------|-----------|---------------------|
| trace-keeper 类 hook（settings → 一条 system） | ~0 ms 级 | +1～10 ms |
| guidance 类（若仍整包 messages） | 内存 slice | +5～50 ms（与 messages 体积线性） |
| `completeWithContext` / Separate | 主要等 LLM | 可忽略 |

**结论**：先做 **§3 注入描述符改造**，再上 Worker 沙箱；否则沙箱化会放大 guidance 路径开销。

---

## 5. 插件 API 绑定（定案 · 宿主选择器）

**不做** manifest `allowedApiPresets` 白名单；由宿主 UI 授权、插件只见 id：

| 步骤 | 宿主职责 |
|------|----------|
| 设置页 | `settingsSchema` 字段 `type: "apiPreset"` → 宿主 `PluginSchemaForm` 渲染下拉（`loadApiPresetSelectItems`） |
| 持久化 | 用户选择写入插件 `settings.json` 的 `apiConfigId`（或对话 `apiPreset.plugins[pluginId]`）；**仅存 id** |
| 运行时 | 插件经 Host API `complete` / `getUserPluginSettings` 使用已绑定 id；**不**暴露 `api_configs` 列表与其它 preset |
| 出站 | 宿主解析密钥；插件永远不见明文 |

解析链：`对话 apiPreset.plugins[pluginId]` → `apiPreset.plugin` → 插件 settings `apiConfigId`（`plugin-api-resolve.ts`）。

---

## 6. 实现分期

### Phase A — 注入描述符（P2 · 优先）

- [x] `PluginPromptInjection` 类型 · `plugin-prompt-injection-merge.ts` 归并器（复用 `resolveChatDepthInsertIndex` / `compareInjectionEntries`）
- [x] `chat-assemble` 向 apply 传入 post-user / `historySpan` 元数据；`applyPluginsAfterAssemblePrompts` 归并 `PluginPromptInjection`
- [x] 迁移 `guidance-generate` → 描述符；移除整表 `afterAssemblePrompts` 主路径
- [x] 迁移 `trace-keeper` → depth 0 `injectionOrder` **500**（显式描述符）
- [x] 单测：多插件 `injectionOrder`、群聊 `afterUserInput` 共存、revise 双条、token 预留 cache

### Phase B — 服务端沙箱（P2）

- [x] **子进程** `fork(bootstrap)` 加载 `server.mjs`；结构化 IPC（`plugin-worker-protocol.ts`）
- [x] **Node `--permission`** — 只读插件包 + bootstrap；禁 fs 写 / child_process / worker / addons（`plugin-worker-permissions.ts`）
- [x] Host API 代理；import hook + 禁 raw `fetch` 纵深防御
- [x] B3+ 全量回归 · B4 userId IPC / 串行 / 超时 / STRICT

**启用**：`PLUGIN_SERVER_SANDBOX=1`（默认 off）。**严格模式**：`PLUGIN_SERVER_SANDBOX_STRICT=1`。**调试关闭 Permission**：`PLUGIN_SERVER_SANDBOX_NO_PERMISSION=1`。

### 非目标（v1 沙箱）

- 浏览器 `web.mjs` 沙箱（已受 CSP / 宿主 API 约束；另议题）
- 插件 capabilities 跨插件 RPC（见 `DOC/09` §8.7）

---

## 8. 插件二次 LLM 上下文与拼 prompt

> **详案**：[`DOC/39-plugin-context-and-prompt-assembly.md`](39-plugin-context-and-prompt-assembly.md)  
> **状态**：**Phase 1–3 已落地**（2026-07）；Sandbox Phase A 的前置依赖已满足。

与 §3 chat 注入**不同管线**；Worker 沙箱化前应避免 IPC 传递整段自拼 messages（已由 DOC/39 解决）。

---

## 9. 代码索引

| 路径 | 说明 |
|------|------|
| `server/src/plugin-system/loader.ts` | `loadPluginServerModule`：sandbox 启用 → Worker，否则同进程 `import` |
| `server/src/plugin-system/plugin-worker-protocol.ts` | IPC 类型 · `PLUGIN_SERVER_SANDBOX` 开关 |
| `server/src/plugin-system/plugin-worker-bootstrap.mjs` | Worker 入口，加载 `dist/server.mjs` |
| `server/src/plugin-system/plugin-worker-client.ts` | Host 侧 fork 客户端 · Host API 分发 |
| `server/src/plugin-system/plugin-worker-permissions.ts` | 子进程 `--permission` / `--allow-fs-read` 参数 |
| `server/src/plugin-system/plugin-worker-env.ts` | 子进程最小 env（不继承宿主密钥） |
| `server/src/plugin-system/plugin-worker-import-hook.mjs` | Worker import hook（禁 fs / 原生 HTTP 等） |
| `server/src/plugin-system/plugin-sandbox-module.ts` | 按导出 hooks 包装为 `PluginServerModule` |
| `shared/plugin-prompt-injection.ts` | 注入描述符契约（同步 server/web） |
| `server/src/plugin-prompt-injection-merge.ts` | post-user 区归并 · `buildPluginAfterUserInputHintFromMessages` |
| `server/src/plugin-host.ts` | `resolvePluginAddition` · `applyPluginsAfterAssemblePrompts` |
| `server/src/plugin-system/host-api.ts` | `PluginServerHostApi` |
| `server/src/plugin-complete.ts` | complete 密钥解析 |
| `server/src/assemble-prompts.ts` | `resolveChatDepthInsertIndex` · `compareInjectionEntries` |
| `server/src/chat-assemble.ts` | 两阶段 token 预留 · regex 后 `resolveAssembledBlockContentAfterRegex` · apply |
| `plugins/guidance-generate/src/server/index.ts` | `resolveAfterAssemblePromptsAddition` · send **0** / revise **0+1** |
| `plugins/trace-keeper/src/server/index.ts` | `resolveAfterAssemblePromptsAddition` · `injectionOrder` 500 |

---

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：沙箱目标态、注入描述符定案、order 定案、性能粗估、分期清单 |
| 2026-07-07 | §8：链至 `DOC/39`；标注 DOC/39 前置已落地 |
| 2026-07-07 | **Phase A0**：`PluginPromptInjection` 契约 + `mergePluginPromptInjectionsIntoMessages` |
| 2026-07-07 | **Phase A1**：`chat-assemble` 传 historySpan；apply 路径归并 legacy / 描述符 |
| 2026-07-07 | **Phase A2–A3**：`guidance-generate` / `trace-keeper` 迁显式 `PluginPromptInjection` |
| 2026-07-07 | **Phase A4**：单测 + `afterUserInput` 与插件注入同空间归并 |
| 2026-07-07 | 契约：`position.injectionOrder`（≡ ST）；默认 **100**；官方档 **10 / 20 / 500**（revise **11+12**） |
| 2026-07-07 | **Phase B**：Worker 沙箱 + Host API 代理 + loader fallback；`PLUGIN_SERVER_SANDBOX` 默认 off |
| 2026-07-07 | **Phase C**：`worker_threads` → `child_process.fork` + Node `--permission` |
