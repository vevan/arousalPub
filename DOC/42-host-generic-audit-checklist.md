# 宿主零特化 — 代码审计与迁移 Checklist



> **状态**：**迁移完成 · 审计项已修复**（2026-07-07）。  

> **原则**：[`DOC/41`](41-plugin-host-generic-principles.md) · Cursor `.cursor/rules/plugin-host-generic.mdc`  

> **待办索引**：[`DOC/04`](04-TODO.md) §已归档（宿主去特化）  

> **可选本地 CI**：`npm run check:ci`（shared 校验 + 门禁 + D.2 + build:plugins + typecheck + server 测试）



---



## 1. 迁移后摘要



| 指标 | 结果 |

|------|------|

| 门禁 `check:host-no-plugin-ids` | **0 处违规** |

| server 测试 | **706/706** |

| web typecheck | **通过** |

| Phase 0–3 checklist | **全部勾选**（见 §6） |

| §8.2 审计跟进 | **已全部修复** |
| DoD D.2 | **`npm run verify:host-no-bundled`** |
| 本地校验 | **`npm run check:ci`**（合入 main 前手动跑即可） |



**已交付能力**：



- 通用 **`POST /api/plugins/:pluginId/actions/:action`** + manifest `serverActions` + 插件 `runPluginAction`

- Web **`host.plugin.runAction(action, body)`**

- **`shared/turn-plugin-merge.ts`** + manifest `turnPlugins`（receive-scoped merge）

- **`plugins/bundled-registry.json`**

- 设置壳：schema **`bundleSelect` / `inheritTriMode` / `inheritTriModeSheetList` / `companionPanel`**

- **`draft.kind: string`**；sidecar 等 lore 语义仅在插件 **`pluginSettings`** 内传递



**门禁未覆盖（有意）**：



- `web/src/locales/*.json` — 用户提示示例（非分支逻辑）

- `plugins/**` — 插件内 id **合法**



---



## 5. 第一方插件（迁移后）



| 插件 | 宿主耦合 |

|------|----------|

| trace-keeper | ✅ actions API + turnPlugins + lifecycle |

| plot-summary | ✅ sidecar 名经 `pluginSettings`；`parseCompleteDraftContent` 插件内解释 |

| guidance-generate | ✅ hook only |

| custom-styles | ✅ 对话设置 `inheritTriMode*` schema widget |

| conversation-export / reply-complete-sound / swipe-cleaner | ✅ |



---



## 6. 迁移 Checklist（执行顺序）



### Phase 0 — 门禁与注释



- [x] **0.1** `scripts/check-host-no-plugin-ids.mjs` + `npm run check:host-no-plugin-ids`

- [ ] **0.2** GitHub Actions CI（可选；当前用本地 **`npm run check:ci`**）

- [x] **0.3** 注释 sweep

- [x] **0.4** legacy 已删



### Phase 1–3 / DoD



- [x] Phase 1–3 全部项（见历史版本）

- [x] **D.1** 门禁零命中

- [x] **D.2** 无 bundled 插件时宿主仍可编译 — `npm run verify:host-no-bundled`

- [x] **D.3** server + web 测试绿



---



## 8. 迁移后代码审计



### 8.1 已通过项



| 项 | 说明 |

|----|------|

| 宿主 id 字面量 | 门禁 **0 命中**（含 settings 组件） |

| 专用 HTTP 路由 | 无 trace 专用路由 |

| Web / Server actions | 通用 dispatcher |

| 设置表单 | schema 驱动；无 bundled id 分支 |

| `draft` 契约 | 无 `sidecarName`；插件私有字段走 `pluginSettings` |



### 8.2 审计跟进（已全部修复 · 2026-07-07）



| 原问题 | 修复 |

|--------|------|

| 迁移脚本 seed 后 no-op | （2026-07 脚本已移除）历史：`userNeedsMigration` 检测 registry / 会话 `pluginSettings` / userData |

| registry-only 残留 | （历史）registry 含 `curated-memory` 时需手动改为 `plot-summary` |

| `mergeTurnPluginEntries` 按 pluginId 替换 | → 逐条 `mergeTurnPluginEntry`（receive-scoped 策略） |

| `turnMerge` 缺 conversationId | 空 id 时 **400** |

| `turn-plugin-policies` 仅 bundled | 并集 **已安装插件目录** + bundled catalog；seed **后** refresh |

| `custom-styles` 宿主分支 | → manifest `inheritTriMode` / `inheritTriModeSheetList` widget |

| 门禁未扫 settings | 扫描根增加 `web/src/components/settings` |



### 8.3 非问题澄清



- **`plugins/**` 内 TraceKeeper / `ex-trace-keeper`**：插件包内合法。

- **locale 块标签示例**：已改为泛化 `my-plugin-block`。



### 8.4 二次审计（2026-07-07）

**方法**：`npm run check:ci` + 门禁 + 宿主目录扫尾 + git 工作区核对。

| 指标 | 结果 |
|------|------|
| `check:ci` | **通过** |
| 门禁 | **0 违规** |
| shared 同步 | **ok** |

**§8.1 / §8.2 结论仍成立**；无新增阻塞项。

| 严重度 | 项 | 说明 |
|--------|-----|------|
| **低** | `companionPanel === 'auto-summarize-progress'` | opaque companion id，非 pluginId（DOC/18 允许） |
| **低** | 门禁未扫 `web/src/components`（settings 外） | 当前 spot-check **0 命中** |
| **运维** | 工作区 **未提交** | 删文件（legacy 特化）在 git 中为 `D`，合入 main 前需 commit |



---



## 7. 修订记录



| 日期 | 说明 |

|------|------|

| 2026-07-07 | 首版 |

| 2026-07-07 | 迁移完成 + §8 审计 |

| 2026-07-07 | §8.2 全部修复；剥离 `draft.sidecarName`；settings 门禁扩展 |
| 2026-07-07 | D.2 `verify:host-no-bundled` + 本地 `check:ci` |
| 2026-07-07 | **§8.4 二次审计**：check:ci 全绿；无新阻塞项 |

