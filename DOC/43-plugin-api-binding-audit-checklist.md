# Sandbox 交叉项 — 插件 API 绑定 · 审计 · Fallback Checklist

> **状态**：**已闭合**（2026-07-08）；**A3 包内自维护 API** 延后（无插件需求）  
> **索引**：[`DOC/04`](04-TODO.md) §Sandbox「相关（与 Sandbox 交叉）」  
> **关联**：[`DOC/38`](38-plugin-sandbox-and-host-evolution.md) §5 · [`DOC/03`](03-实现细节.md) §1.2–§1.3 · [`DOC/18`](18-plugin-host-developer-api.md) · [`DOC/21`](21-conversation-plugin-settings.md) · [`DOC/10`](10-plugin-conversation-host.md) §7 · [`DOC/24`](24-regex-and-session-audit.md) §3.6

---

## 1. 范围

Phase A（注入描述符）与 Phase B（Worker 沙箱）已落地。本节 checklist **已闭合**（B4 权限 enforce 已落地）。

| 块 | 摘要 | 状态 |
|----|------|------|
| **A. 插件 API 绑定** | 三层解析链 + 插件 Tab UI | **✅ P0** |
| **B. 插件审计 + 权限** | 审计定案 + Web `host.conversation` enforce | **✅** |
| **A3 包内自维护 API** | 无插件使用 | **延后**（见 §3 A3） |

**Fallback（C1）**：未绑 API preset 时回退 **全局默认预设**（`activePresetId`）— **已实现**。

**非目标 / 不再跟踪**：

- `manifest.connection.policy`、`index.apiPreset.plugin`、audit 出站 LLM 落盘（B2）
- `host.capabilities` 跨插件 RPC、浏览器 Worker 沙箱
- **C2** 沙箱运维 — 见 [`DOC/38`](38-plugin-sandbox-and-host-evolution.md) §5 Phase B

### 1.1 插件出站 API 解析链（定案 · 2026-07-08）

```text
① 对话 pluginSettings.apiConfigId
  ↓ 未配置
② 全局 settings.json apiConfigId
  ↓ 未配置
③ 全局 activePresetId
```

- **主对话** `apiPreset.chat` **不参与**插件解析。
- 实现：`server/src/plugin-api-resolve.ts` · `server/src/feature-binding-resolve.ts`

### 1.2 UI 定案

| 层级 | 入口 | 落盘 | UI 行为 |
|------|------|------|---------|
| 全局 | 系统设置 → 插件 | `settings.json` → `apiConfigId` | 非必填 `apiPreset` 可清空；hint「当前生效预设：来源 - 预设名」 |
| 对话 | 对话齿轮 → 插件 Tab | `pluginSettings[pluginId].apiConfigId` | `conversationInherit`；清空 PATCH `null` |

实现：`PluginSchemaForm.vue` · `plugin-api-preset-effective.ts`

### 1.3 插件与对话审计（定案）

见 §4 B1；[`DOC/24`](24-regex-and-session-audit.md) §3.6。

### 1.4 Web `host.conversation` 权限（定案 · B4）

`GET /api/plugins/registry` 下发 **`permissions`**；`createScopedPluginHost` 经 **`conversation-host-gate.ts`** enforce：

| API | 所需权限 |
|-----|----------|
| `getMeta` / `runScope`·`read` / `refresh` / `getPluginSettings*` | `conversation.read` |
| `patchPluginSettings` | `conversation.read`（作用域已限定本插件 `pluginSettings` bag；含运行时键） |
| `ctx.patchTurns` | 按 DOC/10 §7 字段级：`turn.send.write` · `turn.receive.content.write` · `turn.receive.reasoning.write` · `turn.receive.prune` |

缺权限抛 **`PluginPermissionDeniedError`**（`plugin_permission_denied:{pluginId}:{permission}`）。

实现：`web/src/plugins/conversation-host-gate.ts` · `conversation-turn-patch-permissions.ts` · `stores/plugin-permissions.ts`

---

## 2. 现状对照

| 能力 | 读 | 写 |
|------|----|----|
| 对话/全局 `apiConfigId` + effective hint | ✅ | ✅ |
| 全局 `activePresetId` fallback | ✅ | ✅ |
| Web `host.conversation` 权限 | ✅ enforce | ✅ turn 字段级 + pluginSettings |
| 包内自维护 API（A3） | — | **延后** |

---

## 3. A — 插件 API 绑定（✅）

### A1–A2 · A4 · A2.5

- [x] 三层链、对话/全局 Tab UI、effective hint、全局可清空、单测（见历史条目）

### A3 包内自维护 API（~~P2~~ **延后**）

> **2026-07-08**：当前 **无** 自维护 API 插件；暂不排期。若新增插件再开 A3.1–A3.2。

- [ ] **A3.1** 插件设置「使用包内 API」+ 宿主保管密钥 — **延后**
- [ ] **A3.2** 选定自维护时短路 ①–③ — **延后**

---

## 4. B — 插件审计 + 权限（✅）

### B1–B3

- [x] 审计三分法 · audit gate · plot-summary dryRun 预览 · DOC/24 §3.6

### B4 Web conversation 权限（P1 · ✅）

- [x] **B4.1** `conversation.read` → `getMeta` / `runScope`·`read` / `refresh` / pluginSettings 读
- [x] **B4.2** `patchPluginSettings` 需 `conversation.read`（本插件 bag）
- [x] **B4.3** `patchTurns` 按 DOC/10 §7 字段级校验（对比 patch 前 turn 快照）
- [x] **B4.4** 单测：`web/test/plugin-conversation-permissions.test.ts`

---

## 5. C — Fallback（✅）

- [x] **C1** 全局默认 preset
- [x] **C2.N/A** 见 DOC/38

---

## 6. 建议实施顺序

```text
✅ P0  A1–A2 · A4 · C1
✅ P1  B4  Web host.conversation 权限
—   A3  延后（无自维护 API 插件）
```

---

## 7. DoD（✅）

- [x] **D1**–**D5**（含 **D4** B4 enforce）

**归档**：本 checklist 可归档；**A3** 单列议题待有插件时再开。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-08 | 首版 · C1 · A2/A4 · P0 闭合 |
| 2026-07-08 | **B4** Web 权限 enforce；**A3 延后**；清单 **归档** |
