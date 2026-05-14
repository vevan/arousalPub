# arousalPub 概况与索引

## 项目概况

- 项目定位：类 SillyTavern 的现代化产品（中兼容）
- MVP 周期：1-2 周，优先打通核心链路
- 用户形态：内网多用户
- 技术栈：Vue3 + Pinia + Vuetify；Node.js（Fastify）；数据以可同步目录 + JSON 为主（对话 chunk / `index.json`、**`data/characters/{uuid}.png`（内嵌角色卡）+ `index.json`**、`prompts.json` 等）
- 核心能力：对话、**角色库（列表 / JSON·PNG 导入 / 表单新建·立绘 / 导出 JSON）**、Prompt、知识库/RAG（骨架与文档先行）、流式输出（SSE）
- 关键原则：API 预设与密钥在服务端文件型配置中维护；对话可绑定 **`characterId` / `characterIds`**

## 文档索引

- 架构设计：`DOC/01-架构设计.md`
- 需求说明：`DOC/02-需求说明.md`
- 实现细节：`DOC/03-实现细节.md`（含对话存储、提示词组装、swipe、`index.json`、备份、**§11 对话页前端**、**§12 角色库**）
- TODO 清单：`DOC/04-TODO.md`
- 技术栈：`DOC/05-技术栈.md`
- **工作交接（新 Agent 入口）**：`DOC/06-工作交接.md`
- 运行时数据目录说明：`data/README.md`
- 前端子项目说明：`web/README.md`

## 备注

- `cursor.md` 只保留项目概况和索引，不承载详细设计内容。
