# arousalPub 概况与索引

## 项目概况

- 项目定位：类 SillyTavern 的现代化产品（中兼容）
- **项目阶段**：**已脱离 MVP**（2026-05 起）；按产品完整度迭代。阶段说明见 `DOC/02` §1.1、`DOC/01-架构设计.md` §0。
- 用户形态：内网多用户
- 技术栈：Vue3 + Pinia + Vuetify；Node.js（Fastify）；**提示词组装 / 宏 / tiktoken 仅服务端**；数据以可同步目录 + JSON 为主（**`data/{userId}/`** …）
- 核心能力：对话、**角色库**、**Prompt**、**资料库（世界书）**、**对话记忆 history/memory + LanceDB（§14 设计已定）**、知识库 RAG（待接）、流式输出（SSE）
- 关键原则：API 预设与密钥在服务端文件型配置中维护；对话可绑定 **`characterId` / `characterIds`**

## 文档索引

- **用户安装与启动**：根目录 `README.md`
- 架构设计：`DOC/01-架构设计.md`（**§9 运行时与部署**）
- 需求说明：`DOC/02-需求说明.md`
- 实现细节：`DOC/03-实现细节.md`（含 … **§14 对话记忆**、**§14.9 组装管线**、**§15 提示词宏（仅服务端）**）
- TODO 清单：`DOC/04-TODO.md`
- 技术栈：`DOC/05-技术栈.md`
- **工作交接（新 Agent 入口）**：`DOC/06-工作交接.md`
- 运行时数据目录说明：`data/README.md`
- 前端子项目说明：`web/README.md`

## 备注

- `cursor.md` 只保留项目概况和索引，不承载详细设计内容。
