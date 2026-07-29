# Graphify 图谱审计 — 可优化与需修复项

> **状态**：待办中（2026-07-29）  
> **来源**：`/graphify` 对 `server` / `web` / `plugins` 分别建图；`server` 已用 **directed + 完整 AST 重抽** 重建  
> **待办索引**：[`DOC/devNotes/04`](04-TODO.md) §P0（server / web / plugins 全项）  
> **图谱产物**（本地，勿当权威业务文档）：
>
> | 范围 | 路径 |
> |------|------|
> | server | `server/graphify-out/`（`graph.html` · `GRAPH_REPORT.md` · `graph.json`） |
> | web | `web/graphify-out/` |
> | plugins | `plugins/graphify-out/` |

---

## 1. 结论摘要

| 仓 | 节点 / 边（约） | 主要发现 |
|----|-----------------|----------|
| **server**（directed） | 3089 / 10525 | **20 组 Import Cycles**；`chat-storage.ts` 出现在 19 组中；运行时枢纽清晰 |
| **web** | 3554 / 4547 | 巨型 Vue 单文件；大社区 cohesion≈0.02；多页面状态模式重复 |
| **plugins** | 722 / 1811 | `plot-summary` / `trace-keeper` 度质量和占主导；短名 `k()` 多实例 |

**说明**：首轮 server 无向图曾出现「几乎无边」——属 AST 抽取不完整事故，**不是**业务稀疏；以 directed 重建图为准。

---

## 2. 需修复 — Import Cycles（建议最先做）

目标：打断环依赖，使存储 / 群聊 / 插件沙箱依赖方向单向化。验收：重建 server directed 图后，下列 cycle **不再出现**（或仅剩有意的类型-only 边且有文档说明）。

### 2.1 CS-P0a — `chat-storage` 中心环（最高优先）

`src/chat-storage.ts` 参与 **19/20** 个 cycle；文件出度约 231、入度约 70。

| ID | Cycle | 建议打断方式 |
|----|-------|--------------|
| CS1 | `chat-storage` ↔ `chunk-chain` | 共享类型 → `*-types`；回调用参数/接口下传，storage 不 import chain 实现 |
| CS2 | `chat-storage` ↔ `memory-index` | 同上；memory 写路径经窄 API |
| CS3 | `chat-storage` ↔ `turn-patch-body` | patch DTO / 校验与 storage 读写分层 |
| CS4 | `chat-storage` → `memory-index` → `memory-corpus` → `chat-storage` | corpus 只依赖只读 turn API |
| CS5 | `chat-storage` → `memory-index` → `chunk-chain` → `chat-storage` | 与 CS1/CS2 一并解 |
| CS6–CS9 | `chat-storage` → `group-chat-turn` → `group-chat/index` → `{audit,continue,outbound,resolve}` → `chat-storage` | **group-chat 只依赖 storage 窄 API**；storage **禁止**反向 import `group-chat/*` 实现 |

**拆分方向（建议，实现时可微调）**：

1. `chat-storage-types` / index 读写 / turn 持久化 / branch·plugin entries 分文件  
2. group-chat、memory、chunk 仅依赖「读 index + 读/写 turn」facade  
3. 保留高频入度 API 为公开面：`readConversationIndex`、`getCurrentUserId`、`normalizeBranchPath`、`getUserDataDir` 等（图上已是事实内核）

### 2.2 CS-P0b — 插件沙箱环

| ID | Cycle | 建议打断方式 |
|----|-------|--------------|
| PS1 | `plugin-system/host-api` → `loader` → `plugin-sandbox-module` → `plugin-worker-client` → `host-api` | 将 `readPluginPackageFile`（及同类）抽到**无 host 依赖**的小模块；host 与 loader 均依赖该模块 |
| PS2 | `plugin-complete-with-context` ↔ `host-api` | complete 只依赖协议/类型，或 host 侧延迟加载 |

### 2.3 子任务勾选（实现时用）

- [ ] CS1–CS5：storage ↔ chunk / memory / turn-patch 解环  
- [ ] CS6–CS9：storage ↔ group-chat 四环解环  
- [ ] PS1：host-api ↔ loader ↔ sandbox ↔ worker 解环  
- [ ] PS2：complete-with-context ↔ host-api 解环  
- [ ] 回归：`npm run check:ci`（或至少 server 测试 + typecheck）  
- [ ] 验收：`graphify` 重跑 `server`（`--directed`）确认 Import Cycles 消失或仅剩已文档化例外  

---

## 3. 需修复 / server 跟进

| ID | 项 | 图谱证据 | 建议 |
|----|----|----------|------|
| SR1 | 小 2-file cycles | `regex-persist`↔`regex-persist-patch`；`st-preset-import`↔`limits`；`assemble-prompts`↔`system-binding-slots`；preferences memo 三角；prompt-macros 多环 | 类型下沉 / 单向调用，逐个打断 |
| SR2 | `src/index.ts` 过肥 | 出度约 **445** | 路由/注册分文件，index 只装配 |
| GF1 | 建图排除 `test/**` | server/web 多条 INFERRED `indirect_call` 指向测试（假边） | `.graphifyignore` 或抽取时跳过 test；避免误导重构 |

---

## 4. 可优化（体量与可维护性）

### 4.1 web — 巨型单文件

度最高（约）：

| 文件 | 度（约） |
|------|----------|
| `ConversationContextSettings.vue` | 154 |
| `PromptsView.vue` | 143 |
| `CharactersView.vue` | 110 |
| `ConversationListView.vue` | 97 |
| `ChatConversationView.vue` | 96 |
| `PluginSchemaForm.vue` | 95 |
| `LorebooksView.vue` | 95 |

建议：按列表 / 表单 / 对话框 / composables 拆分；抽公共 `auth` / `loading` / `delete-dialog` / i18n 模式（`props`/`emit`/`errorText` 等跨数十社区重复）。

### 4.2 plugins

| 项 | 证据 | 建议 |
|----|------|------|
| `plot-summary` 过重 | 度质量和 ≈1838 | 继续拆 `dialogs` / `pipeline` / `settings` / `review` |
| `trace-keeper` 次重 | ≈1240 | 保持 panel / separate / server 边界 |
| 短名 `k()` | God node；3 插件各一份 | 改为可读名 |
| `isAutoSummarizeEnabled` 双处 | `dialogs.ts` + `index.ts` | 单点导出 |

### 4.3 server（cycles 解完之后）

- 大社区 cohesion 仍低（~0.06–0.10）：配合目录分层（storage / assemble / plugin / macros）  
- 组装热点：`buildConversationOutboundMessages`、`invokeCstMacro` — 文档化调用序即可，非必须立刻拆  

---

## 5. 明确「先别当 bug」

| 现象 | 说明 |
|------|------|
| 首轮 server 几乎无边 | 抽取事故；以 §1 directed 重建为准 |
| Knowledge Gaps 的 `name`/`private`/`version` | package.json / manifest 字段噪声 |
| Surprising → `test/**` 的 `indirect_call` | 抽取假阳性（见 GF1） |
| `compilerOptions` 进 web God Nodes | tsconfig 噪声，非业务枢纽 |

---

## 6. 建议落地顺序（均记入 `04` §P0）

1. §2 `chat-storage` 环 → 插件沙箱环  
2. §3 小环 + index 瘦身 + 建图 ignore test  
3. §4.1 web Top Vue 拆分 → §4.2 plugins 分包/`k()` 命名  

---

## 7. 复现建图（备忘）

```text
# 解释器：uv tools graphifyy
# server（推荐 directed；完整 AST，勿用不完整并行 Job 半成品）
graphify extract server   # 或按 skill 流水线；建图时 directed=True
# 产物目录：server/graphify-out/
```

外部 `node:*` / npm 包 import 无本地节点属正常 dangling，建图前可剪掉（重建脚本已剪 751 条）。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-29 | 首版：三仓图谱审计；记入 `DOC/devNotes/04` §P0 |
| 2026-07-29 | server / web / plugins 及 server 跟进项全部升为 `04` §P0 |
