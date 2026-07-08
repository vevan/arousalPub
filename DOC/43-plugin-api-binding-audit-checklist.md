# Sandbox 交叉项 — 插件 API 绑定 · 审计 · Fallback Checklist



> **状态**：**进行中**（2026-07-08）  

> **索引**：[`DOC/04`](04-TODO.md) §Sandbox「相关（与 Sandbox 交叉 · 仍开放）」  

> **关联**：[`DOC/38`](38-plugin-sandbox-and-host-evolution.md) §5 · [`DOC/03`](03-实现细节.md) §1.2–§1.3 · [`DOC/18`](18-plugin-host-developer-api.md) · [`DOC/21`](21-conversation-plugin-settings.md) · [`DOC/10`](10-plugin-conversation-host.md) · [`DOC/24`](24-regex-and-session-audit.md) §3.6  



---



## 1. 范围



Phase A（注入描述符）与 Phase B（Worker 沙箱）已落地。本节跟踪 **与 Sandbox 交叉、仍未闭合** 的两块：



| 块 | 摘要 |

|----|------|

| **A. 插件 API 绑定** | 三层解析链 + 插件 Tab UI；**无** `connection.policy` / `apiPreset.plugin` |

| **B. 插件审计** | 插件出站 LLM 写入 `chat-audit.json`、Web `host.conversation` 权限 enforce |



**Fallback（C1）**：未绑 API preset 时回退 **全局默认预设**（`activePresetId`）— **已实现**。



**非目标（v1）**：`manifest.connection.policy`（`userPreset` / `userFirst` / `embedded` 策略矩阵）、`index.apiPreset.plugin` 对话级泛化默认、`host.capabilities` 跨插件 RPC、浏览器 Worker 沙箱。



### 1.1 插件出站 API 解析链（定案 · 2026-07-08）



每层均为 **自维护 API**（包内连接，未落地）**或** 用户 **`apiPreset` 下拉**；选定自维护则用自维护，否则看该层 `apiConfigId`，再向下一层。



```text

① 对话 pluginSettings.apiConfigId     （对话齿轮 → 插件 Tab · schema type: apiPreset）

  ↓ 未配置

② 全局 settings.json apiConfigId        （系统设置 → 插件 Tab）

  ↓ 未配置

③ 全局 activePresetId                   （连接设置「全局默认预设」）

```



- **主对话** `apiPreset.chat` **不参与**插件解析（与插件出站分离）。

- **不**使用 `index.apiPreset.plugin` / `index.apiPreset.plugins[pluginId]`（已删除，无读兼容）。

- 实现：`server/src/plugin-api-resolve.ts` · `server/src/feature-binding-resolve.ts`



### 1.2 UI 定案



| 层级 | 入口 | 落盘 |

|------|------|------|

| 全局 | 系统设置 → **插件** → 配置 | `settings.json` → `apiConfigId` |

| 对话 | 对话齿轮 → **插件 Tab** → 配置 | `index.json` → **`pluginSettings[pluginId].apiConfigId`** |



对话 **API Tab** 仅 **主 chat**；**不**在此做 per-plugin 控件。



---



## 2. 现状对照



| 能力 | 读（运行时） | 写（PATCH/UI） |

|------|-------------|----------------|

| 对话 `pluginSettings[id].apiConfigId` | ✅ | ✅ 对话插件 Tab（`apiPreset` 字段 → 同 bag） |

| 全局 `settings.json` `apiConfigId` | ✅ | ✅ 系统设置 → 插件 |

| 全局 `activePresetId` fallback | ✅ | ✅ 连接设置 |

| 包内自维护 API | ❌ 未实现 | — |



---



## 3. A — 插件 API 绑定



### A1 对话 pluginSettings 写 apiConfigId（P0）



- [x] **A1.1** 运行时读 `pluginSettings[pluginId].apiConfigId`（`resolvePluginCompleteApi`）

- [x] **A1.2** 三层链 + 全局默认 fallback（`feature-binding-resolve`）

- [x] **A1.3** 移除 `apiPreset.plugins` 读兼容（用户盘无旧数据）

- [x] **A1.4** 删除 preset 时引用扫描含 `pluginSettings.*.apiConfigId`（`api-config-references`）



**验收**：PATCH `pluginSettings` 内 `apiConfigId` 后 complete 走对话级 preset。



### A2 插件 Tab UI（P0）



- [ ] **A2.1** 需出站 LLM 的插件：`settingsSchema` + `conversationSettingsSchema` 含 `type: "apiPreset"`（可 `conversationInherit`）

- [ ] **A2.2** 表单 hint：effective 来源（本对话 / 全局插件 / 全局默认）

- [ ] **A2.3** i18n

- [ ] **A2.4** **禁止**对话 API Tab per-plugin 控件



### A3 包内自维护 API（P2 · 可选）



- [ ] **A3.1** 插件设置可选「使用包内 API」+ 宿主保管密钥

- [ ] **A3.2** 选定自维护时短路 ①–③ 的 preset 链



### A4 Web scoped 收口（P0）



- [ ] **A4.1** `complete*` 均带 `conversationId`，解析走 §1.1 链

- [ ] **A4.2** 单测矩阵（对话覆盖 > 全局 > activePresetId）



---



## 4. B — 插件审计



（与 v1 清单相同，略）



### B1 产品定案（P1）



- [ ] **B1.1** 哪些插件 LLM 进 audit

- [x] **B1.2** **定案**：所有插件 debug/审计（`captureDebug` / `debugCapture`、响应 `debug` 字段）**仅**在会话 **`auditDebug.enabled && maxStored ≥ 1`** 时启用；宿主服务端门控（`plugin-audit-gate.ts`），非常开

- [x] **B1.3** 更新 [`DOC/24`](24-regex-and-session-audit.md) §3.6



### B2 `plugin.complete` 审计写入（P1）



- [ ] **B2.1**–**B2.4**（见原 checklist）



### B3 审计 UI（P2）



- [ ] **B3.1**–**B3.2**



### B4 Web conversation 权限（P1）



- [ ] **B4.1**–**B4.4** · 交叉 [`DOC/10`](10-plugin-conversation-host.md) §9



---



## 5. C — Fallback



### C1 全局默认 preset（P0 · ✅ 2026-07-08）



- [x] **C1.1** 未绑 ①–② 时回退 `activePresetId`（**非**对话 `apiPreset.chat`）

- [x] **C1.2** `fallbackToChat: false` 关闭回退（请求字段名保留）

- [x] **C1.3** 单测 + 文档



### C2 沙箱 Worker fallback（P2）



- [ ] **C2.1** 运维矩阵：`PLUGIN_SERVER_SANDBOX` / `STRICT`（见 [`DOC/38`](38-plugin-sandbox-and-host-evolution.md)）



---



## 6. 建议实施顺序



```text

P0   A2 插件 Tab apiPreset 字段 + hint

     A4 单测 / scoped 收口

P1   B* 审计 + B4 权限

P2   A3 包内自维护 API · C2 沙箱运维

```



---



## 7. DoD



- [ ] **D1** 对话 / 全局插件 Tab 可选 preset；effective 符合 §1.1

- [x] **D2** 皆留空时用全局默认 preset（**C1**）

- [ ] **D3**–**D5**（审计 / 权限 / CI）



---



## 8. 修订记录



| 日期 | 说明 |

|------|------|

| 2026-07-08 | 首版 checklist |

| 2026-07-08 | **C1** fallback → 全局 activePresetId |

| 2026-07-08 | **§1.1 简化**：三层 pluginSettings 链；删除 `apiPreset.plugin` / `connection.policy`；UI 仅插件 Tab |


