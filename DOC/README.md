# 文档索引

> **2026-06-10 整理**：已删除完成态专项文档（i18n 迁移、API Key 定案、性能审计全文），内容并入 `DOC/25`、`DOC/03` §14、`DOC/README`。  
> **权威顺序**：代码 > `DOC/03` > 专题 > `DOC/04`（待办）。

## 快速入口

| 读者 | 先读 |
|------|------|
| 新 Agent / 接手 | [`06-工作交接.md`](06-工作交接.md) → [`03-实现细节.md`](03-实现细节.md) |
| 部署 / 安全 | [`25-security-deployment.md`](25-security-deployment.md)、[`17-admin-console.md`](17-admin-console.md)、[`data/README.md`](../data/README.md) |
| 插件开发 | [`09`](09-plugin-system-and-guidance-generate.md) → [`18`](18-plugin-host-developer-api.md) → [`10`](10-plugin-conversation-host.md) |
| Historian | [`12-plugin-plot-summary.md`](12-plugin-plot-summary.md) |
| 待办 | [`04-TODO.md`](04-TODO.md) |

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
| [`15`](15-conversation-messages-lazy-load.md) | 部分 | 消息 UI 懒加载（服务端原语 ✅） |
| [`17`](17-admin-console.md) | ✅ | 本机运维台、DEK 轮换 |
| [`18`](18-plugin-host-developer-api.md) | ✅ | 插件 API 表 |
| [`20`](20-user-file-library.md) | 定案 | 用户文件库 / charFile（未实现） |
| [`21`](21-conversation-plugin-settings.md) | ✅ | 会话插件 Tab schema |
| [`23`](23-conversation-branches.md) | 部分 | 分支磁盘 + memory；UI 待做 |
| [`24`](24-regex-and-session-audit.md) | 主体 ✅ | 正则三阶段、debug 审计 |
| [`25`](25-security-deployment.md) | ✅ | 部署硬化、**API Key 隔离与磁盘加密** §15 |

## 已归档（勿再新建同级文档）

| 原文件 | 去向 |
|--------|------|
| `07-vue-i18n-migration.md` | 已完成 → `00-alert.md` 一行 |
| `13-api-key-server-side-isolation.md` | → `25` §15.1 |
| `16-api-key-disk-encryption.md` | → `25` §15.2 |
| `22-performance-audit-and-optimization.md` | P0–P3 已落地 → `03` §14.5–14.7、`06` 摘要 |

## 运维备忘

- **单 `DATA_DIR` 只跑一个 server**（勿 prod + dev 双开）；Lance 无跨进程写锁。
- **`memory/` 勿 Syncthing 同步**；损坏时设置页「重建远期记忆索引」。错误码 `memory_vector_index_corrupt`（503）。
- 用户规则：未明确要求不 git commit/push。
