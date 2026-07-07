# 插件宿主通用性原则 — 定案（强制）

> **状态**：**定案 · 强制**（2026-07）。  
> **适用范围**：`server/src` 宿主核心、`web/src/plugins` 与 Web 宿主桥接、`shared/` 跨端契约、上述路径的单测。  
> **关联**：[`DOC/18`](18-plugin-host-developer-api.md)（插件 API）· [`DOC/09`](09-plugin-system-and-guidance-generate.md) · [`DOC/04`](04-TODO.md) §宿主去特化

---

## 1. 核心原则（一条）

**宿主只提供 generic 能力；不得针对任何一个插件（含 bundled）特化。**

- 宿主可以把 `pluginId` 当作 **opaque string**（路由参数、循环变量、JSON 键）。
- 宿主 **不得** 识别具体 id 的语义，也 **不得** 因某个 id 走不同代码路径。
- 插件差异 **100%** 由 **插件包 + manifest 声明 + 通用 hook / action 分发** 表达。

**类比**：宿主 = 操作系统；插件 = 应用。内核只提供 syscall，**不得** 内建 `if (app === 'wechat')`。

---

## 2. 宿主边界

| 属于宿主（须遵守本章） | 不属于宿主（允许出现插件 id） |
|------------------------|------------------------------|
| `server/src/**`（运行时核心；`scripts/` 一次性迁移除外） | `plugins/<id>/` 插件源码与 manifest |
| `web/src/plugins/**`、`web/src/utils/persist-display.ts`、`web/src/utils/chat-api.ts`（宿主桥接） | `plugins/bundled-registry.json`（**构建生成**的数据） |
| `shared/*.ts` 跨端契约 | 用户 data、`pluginSettings[pluginId]` 运行时 JSON |
| 宿主单测 `server/test/**`、`web/**` 中与宿主行为相关的用例 | 专题产品文档 `DOC/12`、`DOC/30` 等 |

---

## 3. 明确禁止（零例外）

以下任一出现在 **宿主源码** 中，视为违反原则：

| # | 禁止项 | 示例（违规） |
|---|--------|--------------|
| F1 | **插件 id 字面量** | `'trace-keeper'`、`"plot-summary"`、`'guidance-generate'` |
| F2 | **按 id 分支** | `if (pluginId === '…')`、`switch (pluginId)` 针对已知插件 |
| F3 | **产品语义命名** | `TraceKeeper*`、`PlotSummary*`、`Historian*`、`patchTraceKeeper*`、`regenerateSeparate*` |
| F4 | **专用路由 / 文件名** | `trace-keeper-regenerate-route.ts`、`POST …/regenerate-separate` |
| F5 | **宿主内嵌插件业务** | Historian 选条/XML、trace 块解析、某插件 payload 的 TS 类型 |
| F6 | **硬编码内置插件列表** | `loader.ts` 内 `['guidance-generate', …]` |
| F7 | **注释 / 示例绑真实 bundled id** | 「见 trace-keeper §…」出现在 `server/src` |
| F8 | **单测使用真实 bundled id** | 应用 `fixture-plugin-*` |

**块标签名**（如 `<ex-trace-keeper>`）是 assistant **消息格式**，不是 pluginId。宿主若处理剥离，须来自 manifest 聚合的 `memory.stripBlockTags`，**不得**在宿主写死标签字符串。

---

## 4. 允许的 generic 能力

宿主提供的管道须满足：**删掉全部 bundled 插件后，代码仍有意义**（仅服务 manifest + hook 调度）。

| 域 | 通用能力 |
|----|----------|
| 插件系统 | 扫描安装、registry、权限、加载 `server.mjs` / `web.mjs` |
| 对话组装 | assemble、regex、宏、token 裁切、**描述符注入归并**（`DOC/38`） |
| 二次 LLM | `ContextBlockSpec` catalog、两步拼 prompt、`completeWithContext`（`DOC/39`） |
| 出站 | `complete`、preflight、API 解析 |
| 存储 | chunk / lorebook / settings 通用 read/write |
| turn 扩展 | `turn.plugins[]` **策略化 merge**（策略来自 manifest） |
| 扩展调用 | 统一 hook 分发、**`POST …/actions/:action`**、lifecycle 事件 |
| Web 桥接 | proxy Server、schema 表单、slot、按 manifest 懒/ eager 加载 |

---

## 5. 插件扩展的唯一合法路径

```text
manifest 声明  →  宿主读声明  →  通用 dispatcher  →  plugin hook / runPluginAction
                       ↑
                 pluginId 仅为键，无语义
```

| 需求 | manifest / hook（规划或部分已实现） |
|------|-------------------------------------|
| 组装注入 | `hooks` + `resolveAfterAssemblePromptsAddition` |
| 二次 LLM 块格式 | `formatPluginContextBlocks` |
| 出站 JSON 解析 | `parseCompleteDraftContent` |
| 自定义 Server 动作 | `serverActions[]` + `runPluginAction(action, …)` |
| turn.plugins 多 receive | `turnPlugins.mergeMode: receive-scoped` + `receiveIdKey` |
| 会话绑定变更 | `lifecycle.onCharacterPrimaryChanged` + 插件 hook |
| 设置页扩展 UI | `ui.conversationSettingsExtensions` |
| 聊天 plugins 载荷 | `Record<string, unknown>`；类型定义在插件包内 |

**禁止**：为某个插件在宿主 `index.ts` 增路由、增 DTO 字段、增 if 分支。

---

## 6. 内置插件与 id 存放

| 位置 | 是否可有 id |
|------|-------------|
| `plugins/<id>/manifest.json` | ✅ |
| `plugins/bundled-registry.json`（`scripts/build-plugins.mjs` 生成） | ✅ 纯数据 |
| `server/src/**/*.ts` | ❌ |
| `loader.ts` 内数组字面量 | ❌ → 只读 JSON |

宿主 loader **只读** `bundled-registry.json`，按 `path` 安装；**不在 TypeScript 中列举 id**。

---

## 7. 判定标准（PR 三问）

1. **删掉所有 bundled 插件后，这段宿主代码是否仍有意义？** 否 → 移入插件或 manifest。
2. **换一个从未见过的 `pluginId`，行为是否仅由 manifest/hook 决定？** 否 → 存在特化，须重构。
3. **CI grep 能否在宿主目录搜到任何 bundled 插件 id？** 能 → 未达标。

---

## 8. CI 门禁（目标态）

```bash
npm run check:host-no-plugin-ids
```

实现：`scripts/check-host-no-plugin-ids.mjs`（扫描路径与 DOC/42 一致）。  
手工等价：

```bash
PATTERN='trace-keeper|plot-summary|guidance-generate|curated-memory'

rg -n "$PATTERN" \
  server/src \
  web/src/plugins \
  web/src/utils/persist-display.ts \
  web/src/utils/chat-api.ts \
  web/src/types/chat-turn.ts \
  shared \
  server/test \
  --glob '!**/fixture-plugin-*/**' \
  --glob '!**/*.md'
```

文件名不得含 bundled 插件 id（如 `trace-keeper-*-route.ts`）。

宿主单测仅使用 **`fixture-plugin-*`** id。

---

## 9. 与 DOC/18 示例的关系

- **DOC/18** 面向插件作者，**可以**用 bundled 插件作**说明性示例**（帮助对照真实产品）。
- **宿主实现代码**不得复制 DOC/18 示例中的 id；实现须符合本章。
- 新增宿主 API 的文档示例统一使用 **`example-plugin`** / **`fixture-plugin-a`**。

---

## 10. 现状差距与迁移（TODO）

**完整审计与可勾选清单**：[`DOC/42-host-generic-audit-checklist.md`](42-host-generic-audit-checklist.md)  
**迁移状态（2026-07-07）**：Phase 0–3 **已完成**；§8.2 **已全部修复**；D.2 **`npm run verify:host-no-bundled`**；合入前本地 **`npm run check:ci`**。

| 已符合 | 备注 |
|--------|------|
| DOC/39 上下文块 catalog | |
| DOC/38 描述符归并 | |
| hook 化 `completeWithContext` | |
| 通用 `serverActions` + Web `runAction` | |
| bundled-registry + turnPlugins manifest | |
| Web 设置 schema widget | |

---

## 11. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | 首版：宿主零特化、零 pluginId 字面量、manifest 扩展方向、CI 门禁 |
| 2026-07-07 | 链入 DOC/42 审计清单；门禁脚本 `npm run check:host-no-plugin-ids` |
| 2026-07-07 | **迁移完成**：Phase 0–3；DOC/42 §8 迁移后审计 |
