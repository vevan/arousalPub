# Composer Slash 命令 — 实现说明

> **状态**：S0–S4 **已实现**（S3 插件命令路由 2026-07-20）  
> **定案**：群聊 `/@` 语义见 [`DOC/35`](35-group-chat.md) §2.3  
> **待办**：无（S0–S4 已关闭；见 [`DOC/04`](04-TODO.md) 已勾项）

---

## 1. 能力概览

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **S0** | ✅ | `submitComposerParse` 统一解析 raw → 命令 + LLM 可见正文 |
| **S1** | ✅ | `/goto N` 跳转章回（`scrollToTurnOrdinal`，不足则 `loadOlderMessages`） |
| **S2** | ✅ | `/@ Name …` 解析 + strip；`speakerQueue` 待群聊 G1 接入 API |
| **S3** | ✅ | 插件经 `host.registerComposerSlashCommand(name, handler, spec)` 注册；submit 路由执行 handler（**宿主零插件 id 特化**） |
| **S4** | ✅ | 首行 `/` 补全浮层（见 §2） |

**硬规则（与 DOC/35 一致）：**

- 仅 **行首 slash 行**（首行）为命令；正文裸 `@` **不参与**选人。
- 输入历史、落盘 user 行：发送时存 **raw**；发往 LLM 的 user 正文为 **strip 后** `body`。

---

## 2. S4 补全浮层

### 2.1 布局

- **Teleport** → `#composer-slash-layer`（`index.html`，与 `#app` 同级；`pointer-events: none`，面板自身可点）。
- **锚点**：`.composer--slash-anchor` → `anchor-name: --composer-slash-anchor`（菜单打开时挂在 `.composer` 上）。
- **面板**：`position: fixed` + `position-anchor: --composer-slash-anchor`；`left: anchor(left)`；`bottom: anchor(top)`；`width: anchor-size(width)`；**向上**展开（`translate: 0 -0.375rem`）。
- **高度**：`max-height: 60dvh`；`overflow-y: auto`。

### 2.2 列表项（两行）

| 行 | 内容 |
|----|------|
| 第一行 | `example`（如 `/goto 3`、`/@ Alice Betty`），mono |
| 第二行 | i18n 简介（`chat.slash.commands.*.description`） |

### 2.3 交互

| 操作 | 行为 |
|------|------|
| 显示条件 | 光标在**首行**且行以 `/` 开头；按 `commandQuery`（`/` 后至首个空格）筛选 |
| ↑ / ↓ | 移动选中；**仅 `commandQuery` 变化时**重置选中项（避免 keyup 跳回第一项） |
| Tab / Enter | 插入选中 `example` + 尾随空格 |
| Esc | 关闭 |
| Enter（菜单开） | 插入命令，**不发送** |
| 纯 `/goto` 无正文 | 允许发送钮（导航，不要求 API Key） |

---

## 3. 代码路径

| 模块 | 路径 |
|------|------|
| 提交解析 | `web/src/utils/composer-slash.ts` |
| 补全上下文 | `web/src/utils/composer-slash-menu.ts` |
| 命令目录 | `web/src/utils/composer-slash-catalog.ts` |
| 插件注册 | `web/src/utils/composer-slash-registry.ts` |
| 菜单 composable | `web/src/composables/chat-session/use-composer-slash-menu.ts` |
| 发送入口 | `web/src/composables/chat-session/use-chat-outbound.ts` → `send()` |
| UI | `ChatComposer.vue` · `ChatComposerSlashMenu.vue` |
| 测试 | `web/test/utils/composer-slash*.test.ts` |

### 3.1 插件扩展（S3）

```ts
// 插件 register(host) 内；name 为命令头（单 token）
host.registerComposerSlashCommand('plot', async (ctx) => {
  // ctx: { conversationId, raw, args } — args 为 head 之后原文，子语法由插件自解析
}, {
  example: '/plot summary 99-150',
  descriptionKey: host.pluginKey('slashPlotDescription'),
})
```

- 注册后进入 S4 补全（`mergeComposerSlashCatalog`）。
- 提交时：已注册命令行从 body **剥离**；`runSlashCommands` 调用 handler。
- **未注册**的 `/foo` 仍整行保留为正文（与旧行为一致）。
- **插件命令不得与正文同条发送**：若解析出 `kind: 'plugin'` 且 body 非空，宿主提示并中止（不清空输入）。
- 宿主**不得**按插件 id 分支；子参数（如 `summary` / `sidecar "name" N-M`）全部在插件内解析。
- **i18n**：补全 `descriptionKey` 文案**勿含** `|`（vue-i18n 复数分隔符，会导致描述截断）。
- 需要进聊天即注册命令时，manifest 声明 `ui.eagerOnRoutes: ["chat"]`；禁用后若 public registry 刷新，宿主会 `unregisterComposerSlashCommandsForPlugin`。

Historian（`plot-summary`）示例：

| 输入 | 行为 |
|------|------|
| `/plot` | 打开默认手动摘要 modal |
| `/plot summary [N-M]` | 预填 memory 任务（+ 可选区间）；确认后才跑 |
| `/plot sidecar <name 或 "name with spaces"> [N-M]` | 预填该 sidecar（按 **name**，trim 后**大小写敏感**）；含空格须引号；重名/未找到报错 |

---

## 4. 交叉引用

- 群聊 `speakerQueue` / G1：[`DOC/35`](35-group-chat.md)  
- 对话 Composer 壳层：[`DOC/03`](03-实现细节.md) §11.2、§11.5
