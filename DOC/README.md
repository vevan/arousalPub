# 文档索引

> **2026-06-10 整理**：已删除完成态专项文档（i18n 迁移、API Key 定案、性能审计全文），内容并入 `DOC/25`、`DOC/03` §14、`DOC/README`。  
> **权威顺序**：代码 > `DOC/03` > 专题 > `DOC/04`（待办）。

## 快速入口

| 读者 | 先读 |
|------|------|
| 新 Agent / 接手 | [`06-工作交接.md`](06-工作交接.md) → [`03-实现细节.md`](03-实现细节.md) |
| 部署 / 安全 | [`25-security-deployment.md`](25-security-deployment.md)、[`17-admin-console.md`](17-admin-console.md)、[`data/README.md`](../data/README.md) |
| 插件开发 | [`09`](09-plugin-system-and-guidance-generate.md) → [`18`](18-plugin-host-developer-api.md) → [`38`](38-plugin-sandbox-and-host-evolution.md) · [`39`](39-plugin-context-and-prompt-assembly.md)（规划）→ [`10`](10-plugin-conversation-host.md) |
| Historian | [`12-plugin-plot-summary.md`](12-plugin-plot-summary.md) · 二次 LLM 演进 [`39`](39-plugin-context-and-prompt-assembly.md) |
| 迹录（Trace Keeper） | [`30-plugin-trace-keeper.md`](30-plugin-trace-keeper.md) |
| 主布局 / 插件 Rail | [`31-main-layout-plugin-rails.md`](31-main-layout-plugin-rails.md) |
| 全局插件 settings 缓存 | [`32-plugin-user-settings-cache.md`](32-plugin-user-settings-cache.md)（**✅ 已实现** · `a7ca4ea`） |
| 移动端兼容性 | [`33-mobile-compatibility.md`](33-mobile-compatibility.md)（**Phase 1 布局已落地**） |
| 待办 | [`04-TODO.md`](04-TODO.md) |
| 通知中心 | [`40-notification-center.md`](40-notification-center.md)（**规划** · P1） |

## 核心（01–08）

| 文档 | 内容 |
|------|------|
| [`01-架构设计.md`](01-架构设计.md) | 定位、数据单写者、Syncthing、§9 部署 |
| [`02-需求说明.md`](02-需求说明.md) | 产品需求摘要 |
| [`03-实现细节.md`](03-实现细节.md) | **主实现文档**：存储、API、§14 memory、§15 宏、§8 备份 |
| [`04-TODO.md`](04-TODO.md) | **未完成项**（已完成能力见 §14.7、各专题「已实现」） |
| [`05-技术栈.md`](05-技术栈.md) | 技术选型与启动 |
| [`06-工作交接.md`](06-工作交接.md) | Agent 速览、易错点、关键路径 |
| [`08-chunk-chain-implementation.md`](08-chunk-chain-implementation.md) | Chunk 链切分与 repair |

## 专题（09–25）

| 文档 | 状态 | 内容 |
|------|------|------|
| [`09`](09-plugin-system-and-guidance-generate.md) | ✅ | 插件系统、guidance-generate |
| [`10`](10-plugin-conversation-host.md) | ✅ | 对话 host、批量 read/patch |
| [`11`](11-plugin-host-completion-and-lorebook.md) | ✅ | complete、lorebook API |
| [`12`](12-plugin-plot-summary.md) | ✅ v1.6+ | Historian / plot-summary |
| [`14`](14-st-macros-porting.md) | 备忘 | ST 宏扩展可行性 |
| [`26`](26-st-macros-compatibility.md) | ✅ A/B/C + CST | **ST ↔ 本地宏兼容对照表** |
| [`29`](29-cst-macros-compatibility.md) | ✅ D4 | **CST 宏引擎**（路线图 D0–D4 完成） |
| [`27`](27-embedded-character-book.md) | 定案 P2 | 角色卡内嵌 `character_book` 组装与 UI |
| [`28`](28-authors-note-layers.md) | ✅ Phase 1 | 作者注：default seed / 会话 / 角色 AN（Phase 2） |
| [`15`](15-conversation-messages-lazy-load.md) | ✅ | 消息 UI 懒加载 + virtua 虚拟列表 |
| [`17`](17-admin-console.md) | ✅ | 本机运维台、DEK 轮换 |
| [`18`](18-plugin-host-developer-api.md) | ✅ | 插件 API 表 |
| [`38`](38-plugin-sandbox-and-host-evolution.md) | 规划 | 插件沙箱、注入描述符、complete 白名单 |
| [`39`](39-plugin-context-and-prompt-assembly.md) | 规划 | 二次 LLM 上下文块、prompt 组装（§5 定案） |
| [`40`](40-notification-center.md) | 规划 P1 | **通知中心**：统一发送、存储、已读/未读、删除、列表 UI |
| [`20`](20-user-file-library.md) | 定案 | 用户文件库 / charFile（未实现） |
| [`21`](21-conversation-plugin-settings.md) | ✅ | 会话插件 Tab schema |
| [`23`](23-conversation-branches.md) | ✅ | S1–S5 + 顶栏分支树；persist `turnId` patch；from/to/total 副标题；§9.3 审计已关闭 |
| [`24`](24-regex-and-session-audit.md) | 主体 ✅ | 正则三阶段、debug 审计 |
| [`25`](25-security-deployment.md) | ✅ | 部署硬化、**API Key 隔离与磁盘加密** §15 |
| [`30`](30-plugin-trace-keeper.md) | ✅ v1 | **迹录** `trace-keeper`：Together、Separate、TraceBundle、左栏 HTML 面板 |
| [`31`](31-main-layout-plugin-rails.md) | ✅ | **主布局三列 Grid**、插件 left/right rail、`routes` 路由门控、`hidden`、统一空态 |
| [`32`](32-plugin-user-settings-cache.md) | ✅ | 全局 `getUserSettings` 缓存 + 订阅（对齐 `DOC/21` 会话 store · `a7ca4ea`） |
| [`33`](33-mobile-compatibility.md) | **Phase 1** | 40rem rail overlay + hidden 持久化；余 composer/安全区验收 |
| [`35`](35-group-chat.md) | ✅ **G0–G5** | **群聊**：segment、`speakerMode`、宏、`preset-group-chat` 种子 |
| [`36`](36-composer-slash.md) | ✅ S0–S2/S4 | **Composer Slash**：submitComposer、`/goto`、`/@` 补全浮层 |
| [`37`](37-st-import-settings-tab.md) | 定案 **P2** | **设置「导入」Tab**：ST 聊天记录 / 世界书 / 提示词预设（预设委托 `PromptsView` 原流程） |

## 已归档（勿再新建同级文档）

| 原文件 | 去向 |
|--------|------|
| `07-vue-i18n-migration.md` | 已完成 → `00-alert.md` 一行 |
| `13-api-key-server-side-isolation.md` | → `25` §15.1 |
| `16-api-key-disk-encryption.md` | → `25` §15.2 |
| `22-performance-audit-and-optimization.md` | P0–P3 已落地 → `03` §14.5–14.7、`06` 摘要 |
| `DOC/04` 对话分支 S1–S5 实现清单 | 2026-06-18 完成 → [`23`](23-conversation-branches.md) |
| `DOC/04` P0 落盘 persist 缺 turnId | 2026-06-23 · `15c7900` → [`23`](23-conversation-branches.md) §6.4、[`03`](03-实现细节.md) §6.8 |

## 运维备忘

- **单 `DATA_DIR` 只跑一个 server**（勿 prod + dev 双开）；Lance 无跨进程写锁。
- **`memory/` 勿 Syncthing 同步**；损坏时设置页「重建远期记忆索引」。错误码 `memory_vector_index_corrupt`（503）。
- 用户规则：未明确要求不 git commit/push。
