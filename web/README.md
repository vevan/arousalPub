# Web 客户端（Vue 3）

本目录为 **arousalPub** 前端：会话列表、对话页、提示词库、**角色库**、设置（语言/主题）与右侧 API 连接面板。

## 脚本

```bash
npm install
npm run dev      # 开发
npm run build    # 生产构建
npm run typecheck
```

开发与生产环境需能访问同源或代理下的 **后端 API**（如 `/api/chat/...`、`/api/characters`）；具体与根目录启动方式一致。

## 与文档的对应关系

| 主题 | 文档 |
|------|------|
| 对话页 `chat_pane`、侧栏、Markdown/思维链 | 仓库根 `DOC/03-实现细节.md` **§11** |
| **角色库页** `CharactersView`、`/characters` | 同文件 **§12** |
| 国际化、翻译文件约定 | 同文件 **§9** |
| 总体架构与技术选型 | `DOC/01-架构设计.md`、`DOC/05-技术栈.md` |

## 目录提示

- `src/views/ConversationListView.vue`：会话列表（`/`）
- `src/views/ChatConversationView.vue`：对话壳（`chat_pane`、`chat-header`）
- `src/views/PromptsView.vue`：提示词库（`/prompts`）
- `src/views/CharactersView.vue`：**角色库**（`/characters`）
- `src/components/HomeChat.vue`：`chat-body` / `chat-footer`、消息与输入
- `src/utils/render-rich-message.ts`：`renderRichMessageToHtml` / `renderReasoningMarkdownToHtml`
- `src/router/index.ts`：路由表（含 `characters`）
