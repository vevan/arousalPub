# 用户文件库与 charFile 媒体管线（定案 · P3）

> **状态**：设计定案，**未实现**（列入 `DOC/04` P3）。  
> **定案日期**：2026-06-08  
> **关联**：`DOC/03` §15 宏、`DOC/19` `rag_generate` / P4.3 独立 RAG 接线、立绘鉴权 `web/src/utils/authenticated-media-url.ts`、`server/src/auth.ts` `allowsQueryAccessToken`。

---

## 1. 背景与目标

当前仓库具备：

- **角色立绘**：`GET /api/characters/:id/image`，JWT + 可选 `access_token` 查询参数展示；
- **世界书**：手工条目 + 可选条目级 vector（`lorebook-vector-store`）；
- **对话 memory**：turn 级 Lance 向量召回（§14）；
- **插件 `fileAsset`**：策展记忆等侧车 JSON 内嵌小文件，**非**统一用户媒体库。

产品缺口：

1. **用户级统一文件库**：上传与管理图片、文档、音频、视频；独立 UI（**不是**世界书编辑器）。
2. **角色绑定图片槽**：`{{charFileN}}` / `{{char2FileN}}` 在 **assemble 发送前** 展宏为稳定 **path 字符串**（无 token），供 LLM 在 HTML 等输出中引用（如内心剧场 `src`）。
3. **对话级媒体**：BGM（音频 `fileId`）、背景图（图片 `fileId`），存于对话 `index.json`，**不走宏**。
4. **文档式 RAG**：长文档经文件库入库 → 切片 → 独立 Lance 表 → 对话绑知识库检索；**文档不进 charFile**。

本项 **不** 在 P3 阶段实现全功能，先以本文档固化边界与分期，避免与 P0 `api_configs`、P1 独立 RAG、插件 `fileAsset` 混用同一抽象。

---

## 2. 能力边界（定案表）

| 能力 | 定案 | 消费方 |
|------|------|--------|
| **用户文件库** | 用户级 CRUD + 二进制落盘 + 列表/筛选 UI | 全产品 |
| **`{{charFileN}}` / `{{char2FileN}}`** | **仅图片槽**；角色字段 `imageFiles[]`（`fileId` 有序） | assemble 展宏 → LLM 上下文 |
| **发给 LLM** | 只传 **URL path 字符串**，**不传**图片 body | `assemble-messages` / 插件 complete |
| **助手 HTML 落盘** | turn **无需**再展宏；模型输出已抄写 path | `render-rich-message` 展示层鉴权 |
| **展示鉴权** | 与立绘对齐：持久化 **无** `access_token`；渲染时 `withAccessToken` | Web 气泡 / 内心剧场 |
| **文档** | 文件库 kind=`document` → RAG 索引（独立 Lance 表） | `rag_generate` + 对话 `knowledgeBaseIds`（字段名实现时定） |
| **对话 BGM** | `conversation.index` 存音频 `fileId` | 对话页播放器 |
| **对话背景** | `conversation.index` 存图片 `fileId` | 对话页样式 |
| **插件 `fileAsset`** | 短期保留；长期可迁到 `fileId` 引用（非 P3 必做） | curated-memory 等 |

---

## 3. 存储与数据模型

### 3.1 目录布局

```
data/{userId}/files/
  index.json          # 列表摘要（fileId、kind、name、mime、size、createdAt、updatedAt、tags?）
  {fileId}/           # fileId = 8 位 hex（与 character id 同风格）
    meta.json         # 元数据 + 可选 RAG 状态（indexedAt、chunkCount、embeddingModel）
    content           # 原始字节（或 content.bin；实现时二选一固定）
```

- **归属**：仅靠 JWT `sub` ↔ `userId`；**禁止**在 URL 路径中嵌入 `userId`（与 `GET /api/characters/:id/image` 一致）。
- **索引**：`index.json` 损坏时可从 `{fileId}/meta.json` 重建（与 `characters/index.json` 模式对齐）。

### 3.2 `kind` 与 MIME

| kind | 典型 MIME | charFile | RAG | BGM | 背景 |
|------|-----------|----------|-----|-----|------|
| `image` | image/png, image/jpeg, image/webp, image/gif | ✅ | ❌ | ❌ | ✅ |
| `document` | text/plain, text/markdown, application/pdf, … | ❌ | ✅ | ❌ | ❌ |
| `audio` | audio/mpeg, audio/ogg, … | ❌ | ❌ | ✅ | ❌ |
| `video` | video/mp4, … | ❌ | ❌ | ❌ | ❌ |

上传时校验 kind ↔ MIME 白名单；超大文件受 Fastify `bodyLimit` / multipart 上限约束（与角色 PNG 导入同级策略）。

### 3.3 角色 `imageFiles`

角色卡（ST v2 `card` 或扩展字段，实现时写入 `extensions.arousalPub.imageFiles` 或并列顶层字段，**以实现定案为准**）：

```json
{
  "imageFiles": [
    { "fileId": "a1b2c3d4", "label": "立绘变体", "slot": 1 },
    { "fileId": "e5f6a7b8", "slot": 2 }
  ]
}
```

- **槽位 N** 对应宏 `{{charFileN}}`（主角色）/ `{{char2FileN}}`（会话 `characterIds[1]`，与现有 `char2` 宏序号一致）。
- 未绑定或 file 已删：展宏为空字符串或占位文案（与 `{{char}}` 缺失策略对齐，实现时单测锁定）。

### 3.4 对话级引用

`data/{userId}/chats/{chatId}/index.json`（字段名实现时与 `DOC/03` §7 对齐）：

```json
{
  "backgroundImageFileId": "…",
  "bgmFileId": "…",
  "knowledgeBaseIds": ["kb-…"]
}
```

- BGM / 背景：**直接 fileId**，不经宏。
- 知识库：指向「文档集合」或「文件子集」配置（RAG Phase 与 `DOC/19` P4.3 一并定案）。

---

## 4. HTTP API（规划）

所有路由在全局 JWT 之后；`sub` 必须等于文件 owner。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/files` | 列表（`?kind=&search=&page=`） |
| `POST` | `/api/files` | multipart 上传（`file` + 可选 `kind`、`name`、`tags`） |
| `GET` | `/api/files/:fileId` | 元数据 |
| `GET` | `/api/files/:fileId/content` | 流式二进制；`Content-Type` 来自 meta |
| `PATCH` | `/api/files/:fileId` | 改名、标签 |
| `DELETE` | `/api/files/:fileId` | 删除；需引用检查（角色槽、对话 BGM/背景、RAG 索引） |

**内容 URL（展宏与模型抄写）**：

```
/api/files/{fileId}/content
```

- assemble 与落盘 chunk 中 **不得** 拼接 `access_token` 或 `userId` 路径段。
- 理由：JWT 默认约 30 分钟过期；改密 `revokeAllSessionsForUser` 会使烙进历史的带 token URL 永久破图。

### 4.1 查询 token 白名单

扩展 `server/src/auth.ts` 中 `allowsQueryAccessToken`，将  
`/api/files/` + `/content` 与现有 `/api/characters/` + `/image` **同规则**（仅 GET、仅 content 子路径）。

### 4.2 服务端辅助

```ts
// 规划：server/src/file-content-url.ts
export function fileContentUrl(fileId: string): string {
  return `/api/files/${fileId}/content`;
}
```

与 `characterImageUrl(characterId)` 对称，供 `prompt-macros` 与测试使用。

---

## 5. 宏展宏（assemble 前）

在 `server/src/prompt-macros/` 增加 handler（名称实现时定）：

1. 解析当前会话 `characterIds`；
2. 读取各角色 `imageFiles[slot]`；
3. 将 `{{charFileN}}` / `{{char2FileN}}` 替换为 `fileContentUrl(fileId)` **纯 path**；
4. 仅影响 **发往模型的 messages**；**不**改写已落盘历史（历史 assistant 内容已是模型生成的 path）。

与 §15 一致：**仅服务端展宏**；Web 不保留宏展开副本。

---

## 6. 展示层鉴权（Web）

对齐 `web/src/utils/authenticated-media-url.ts`：

1. 新增 `fileLibraryContentUrl(fileId)` → `/api/files/{id}/content`；
2. 在 `render-rich-message.ts`（及内心剧场 HTML 管道）中，对 `src` / `href` 匹配 `/api/files/.../content` 时走 `withAccessToken`；
3. `<img>` / `<audio>` / `<video>` 与立绘相同：`access_token` 仅存在于**运行时 DOM**，不进 Pinia 持久化、不进 turn JSON。

对话页 BGM / 背景组件同样使用 `withAccessToken` 包装 content URL。

---

## 7. 文档 RAG（与文件库的关系）

- **入口**：用户在文件库上传文档 → 可选「加入知识库」→ 后台切片 + embedding → **独立 Lance 表**（与 `memory/conversations/*`、`lorebook-vector` **分表**）。
- **检索**：对话绑定 `knowledgeBaseIds`；assemble 时 TopK 注入（`DOC/19` `rag_generate` 能力 + `resolveFeatureApi('rag_generate')`）。
- **明确不做**：PDF/txt **不** 进入 `{{charFileN}}`；世界书手工条目仍走现有 `lorebook-resolve`。

P1「独立知识库 RAG」的**文档管线**依赖本文件库 **M1 + M4**；`rag_generate` 接线见 `DOC/19` Phase 4.3。

---

## 8. 与现有能力的关系

| 现有 | 关系 |
|------|------|
| 角色立绘 `/api/characters/:id/image` | 展示鉴权范本；charFile 为**附加**图片槽，不替换立绘 |
| 世界书 vector | 条目级触发；与文档 RAG **并存、分表** |
| turn memory Lance | 对话摘要向量；与文档 RAG **分表** |
| 插件 `host.fileAsset` | 小文件侧车；P3 不强制迁移 |
| `DOC/19` feature_bindings | `rag_generate` 绑定独立；与 chat 主 API 分离 |

---

## 9. 前端 UI（规划）

- **路由**：`/files`（或 `/library`），侧栏与「角色」「资料库」并列。
- **能力**：网格/列表、按 kind 筛选、上传、预览、删除、复制「内容 path」（供调试）；文档项显示 RAG 索引状态。
- **角色编辑**：在角色表单中「图片槽」从文件库选择图片（写 `imageFiles`）。
- **对话设置**：背景 / BGM / 知识库选择器（引用 fileId / kbId）。

**不是**：在世界书编辑器内嵌通用上传区。

---

## 10. 实施分期（建议）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **M1** | `files/` 落盘 + REST + `allowsQueryAccessToken` + `/files` 基础 UI | — |
| **M2** | 角色 `imageFiles` + `{{charFileN}}` 宏 + `fileContentUrl` | M1 |
| **M3** | `render-rich-message` / 对话 BGM·背景 + `withAccessToken` | M1 |
| **M4** | 文档切片 + 独立 Lance + 对话绑知识库 | M1、`DOC/19` P4.3 |
| **M5** | 引用检查、批量导入、视频预览优化 | M1–M3 |

P3 排期：**至少完成 M1–M3** 可交付「文件库 + charFile + 展示」闭环；M4 与 P1 独立 RAG 合并推进。

---

## 11. 验收要点（实现后）

- [ ] 上传图片后，角色槽 N 绑定，`assemble-preview` 中可见 `/api/files/{id}/content` **且无** `access_token`
- [ ] 模型返回含该 path 的 HTML，刷新页面后图片仍可显示（token 由前端临时拼接）
- [ ] 改密或 token 过期后，**历史 turn 内 path 不变**，重新登录后展示恢复
- [ ] 文档上传不出现在 charFile 宏；RAG 检索命中来自独立 Lance 表
- [ ] 删除被角色/对话引用的文件时返回 409 或明确错误码

---

## 12. 开放问题（实现前定案）

1. `imageFiles` 写入角色卡 ST `extensions` 命名空间 vs 宿主并列字段；
2. 知识库实体是「文件多选」还是独立 `knowledge-bases/` 目录；
3. PDF 切片器选型（纯文本提取 vs 外部工具）；
4. 单用户文件配额与总容量提示（内网默认可不设）。

---

## 13. 文档维护

- 接口落地后更新 `DOC/03` 新章节（建议 §16 或并入 §6 媒体）；
- `data/README.md` 补充 `files/` 说明；
- `DOC/04` P3 条目勾选进度；
- `DOC/19` P4.3 引用本文档为前置。
