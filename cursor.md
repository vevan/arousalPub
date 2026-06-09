# arousalPub 概况与索引

## 项目概况

- 项目定位：类 SillyTavern 的现代化产品（中兼容）
- **项目阶段**：**已脱离 MVP**（2026-05 起）；按产品完整度迭代。阶段说明见 `DOC/02` §1.1、`DOC/01-架构设计.md` §0。
- 用户形态：内网多用户
- 技术栈：Vue3 + Pinia + Vuetify；Node.js（Fastify）；**提示词组装 / 宏 / tiktoken 仅服务端**；数据以可同步目录 + JSON 为主（**`data/{userId}/`** …）
- 核心能力：对话、**角色库**、**Prompt**、**资料库（世界书，手工条目 + 可选 vector）**、**对话 memory/history + Lance 向量召回（§14）**、流式输出（SSE）；**用户上传文档式知识库 RAG / Rerank 未接（后者低优先级）**
- 关键原则：API 预设与密钥在服务端文件型配置中维护；对话可绑定 **`characterId` / `characterIds`**

## 文档索引

- **API Key 服务端隔离（已实现）**：`DOC/13-api-key-server-side-isolation.md`
- **API Key 磁盘加密（已实现）**：`DOC/16-api-key-disk-encryption.md`
- **用户文件库与 charFile（P3 定案）**：`DOC/20-user-file-library.md`
- **用户安装与启动**：根目录 `README.md`
- 架构设计：`DOC/01-架构设计.md`（**§9 运行时与部署**）
- 需求说明：`DOC/02-需求说明.md`
- 实现细节：`DOC/03-实现细节.md`（含 … **§14 对话记忆**、**§14.9 组装管线**、**§15 提示词宏（仅服务端）**）
- TODO 清单：`DOC/04-TODO.md`
- 技术栈：`DOC/05-技术栈.md`
- **工作交接（新 Agent 入口）**：`DOC/06-工作交接.md`
- **Chunk 链切分（已实现）**：`DOC/08-chunk-chain-implementation.md`
- **会话消息分页与懒加载（P1 规划）**：`DOC/15-conversation-messages-lazy-load.md`
- **性能审计与 Memory v2 优化（P0–P3 已落地）**：`DOC/22-performance-audit-and-optimization.md`
- **对话分支（服务端原语已落地 · UI/写入待做）**：`DOC/23-conversation-branches.md`
- **正则原生 + 会话 debug 审计（P0 定案 · 未实现）**：`DOC/24-regex-and-session-audit.md`
- **本机运维台（已实现）**：`DOC/17-admin-console.md`（loopback + `00000000`；用户管理 + DEK 轮换）
- 运行时数据目录说明：`data/README.md`
- 前端子项目说明：`web/README.md`

## 备注

- `cursor.md` 只保留项目概况和索引，不承载详细设计内容。
