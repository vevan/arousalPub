# arousalPub 概况与索引

根目录的 `AGENTS.md` 是项目规则、易错速查与文档索引的统一入口；`.cursor/rules/` 保留 Cursor 的路径匹配规则。

## 项目概况

- 类 SillyTavern 现代化产品，已脱离 MVP。
- 技术栈：Vue 3、Pinia、Vuetify；Fastify；宏和组装仅在服务端执行；数据以 `data/{userId}/` 下的 JSON 与 chunk 存储。
- 核心能力：对话、角色、提示词、资料库、Lance turn memory、SSE 与插件系统。

## 文档

主索引：[`DOC/devNotes/README.md`](DOC/devNotes/README.md)

| 常用主题 | 路径 |
|------|------|
| 项目规则与易错速查 | `AGENTS.md` |
| 实现细节 | `DOC/devNotes/03-实现细节.md` |
| 工作交接 | `DOC/devNotes/06-工作交接.md` |
| 待办 | `DOC/devNotes/04-TODO.md` |
| 安全与 API Key | `DOC/devNotes/25-security-deployment.md` |
| 插件设计 | `DOC/devNotes/12-plugin-plot-summary.md` |
| 数据目录 | `data/README.md`、`data/README.zh.md` |
| 启动 | 根目录 `README.md` |
