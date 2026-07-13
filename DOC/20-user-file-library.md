# 用户文件库与 charFile 媒体管线（定案 · P0）

> **状态**：设计定案；**M1 已落地**（`files/` 落盘 + REST + **公开 `/api/m/:token`** + `/files` UI · 2026-07-13；内容 URL **独立于**立绘 `/api/i/`，不拼 query `access_token`）。M2–M5 未实现。  
> **定案日期**：2026-06-08  
> **关联**：`DOC/03` §15 宏、§17 文件库、`shared/file-media-token.ts`、`web/src/utils/authenticated-media-url.ts`。

---

## 1. 背景与目标

当前仓库具备：

- **角色立绘**：`GET /api/i/:token`（公开 token URL；Query `size` 缩放）；用户头像仍 **`GET /api/users/:id/avatar`** + JWT / `access_token`；
- **世界书**：手工条目 + 可选条目级 vector（`lorebook-vector-store`）；
- **对话 memory**：turn 级 Lance 向量召回（§14）；
- **插件 `fileAsset`**：Historian（剧情纪要）等侧车 JSON 内嵌小文件，**非**统一用户媒体库。

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
| **发给 LLM** | 只传 **公开 `/api/m/:token` 字符串**（token 内编码 userId+fileId），**不传**图片 body | `assemble-messages` / 插件 complete |
| **助手 HTML 落盘** | turn **无需**再展宏；模型输出已抄写 `/api/m/…` | 气泡 `<img src>` **直接可用**（公开 GET） |
| **展示鉴权** | 公开 media token URL（**独立路由** `/api/m/`，不复用立绘 `/api/i/`）；**不**拼 JWT `access_token` | Web 气泡 / 内心剧场 |
| **文档** | 文件库 kind=`document` → RAG 索引（独立 Lance 表） | `rag_generate` + 对话 `knowledgeBaseIds`（字段名实现时定） |
| **对话 BGM** | `conversation.index` 存音频 `fileId` | 对话页播放器 |
| **对话背景** | `conversation.index` 存图片 `fileId` | 对话页样式 |
| **插件 `fileAsset`** | 短期保留；长期可迁到 `fileId` 引用（非 P3 必做） | plot-summary 等 |

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

- **归属**：CRUD 仅靠 JWT `sub` ↔ `userId`；**禁止**在 REST 路径中嵌入 `userId`。内容展示走 **`/api/m/:token`**（token 内编码 `userId` + `fileId`，公开 GET；**不**复用立绘 `/api/i/`）。
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
- 知识库：指向「文档集合」或「文件子集」配置（RAG Phase 与连接 / 对话 API 设定一并定案）。

---

## 4. HTTP API（规划）

所有路由在全局 JWT 之后；`sub` 必须等于文件 owner。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/files` | 列表（`?kind=&search=&page=`） |
| `POST` | `/api/files` | multipart 上传（`file` + 可选 `kind`、`name`、`tags`） |
| `GET` | `/api/files/:fileId` | 元数据 |
| `GET` | `/api/files/:fileId/content` | 流式二进制（**需 JWT Bearer**；供 API/工具）；浏览器展示请用下方公开 URL |
| `PUT` | `/api/files/:fileId/content` | **原地更新**二进制（multipart `file`）；`fileId` / 公开 URL **不变**；默认同 kind；展示名默认跟新文件名（可不同，如 `avatar-v2.png`）；可选 `keepName` / `name` |
| `PATCH` | `/api/files/:fileId` | 改名、标签 |
| `DELETE` | `/api/files/:fileId` | 删除；需引用检查（角色槽、对话 BGM/背景、RAG 索引） |

**内容 URL（展宏 / 模型抄写 / 气泡 `src`）**：

```
/api/m/{token}
```

- `token` = base64url(userId 4B + fileId 4B)，见 `shared/file-media-token.ts`（**独立于**立绘 `portrait-media-token`）。
- assemble、落盘、气泡 **均使用该公开 URL**；**不**拼 `access_token`。
- 图片可带 `?size=xs|s|m|l|xl`。

### 4.1 鉴权说明

- **CRUD**（列表/上传/meta/PATCH/DELETE）与 **`GET /api/files/:id/content`**：全局 JWT。
- **展示**：`GET /api/m/:token` 为公开路由（`isPublicRoute`），**不**走 `allowsQueryAccessToken`。
- 立绘仍为 `GET /api/i/:token`；二者路由与 token 格式分离。

### 4.2 服务端辅助

```ts
// server/src/file-content-url.ts
export function fileContentUrl(fileId: string, userId?: string): string {
  // → /api/m/{encodeFileMediaToken({ userId, fileId })}
}
```

与立绘 URL 辅助对称，但 **path 前缀为 `/api/m/`**。---

## 5. 宏展宏（assemble 前）

在 `server/src/prompt-macros/` 增加 handler（名称实现时定）：

1. 解析当前会话 `characterIds`；
2. 读取各角色 `imageFiles[slot]`；
3. 将 `{{charFileN}}` / `{{char2FileN}}` 替换为 `fileContentUrl(fileId)`（公开 `/api/m/…`）；
4. 仅影响 **发往模型的 messages**；**不**改写已落盘历史（历史 assistant 内容已是模型生成的 URL）。

与 §15 一致：**仅服务端展宏**；Web 不保留宏展开副本。

---

## 6. 展示层（Web）

1. `fileLibraryContentUrl(userId, fileId)` → `/api/m/{token}`（**无** `access_token`）；
2. 气泡 HTML 中的 `/api/m/…` **无需** `render-rich-message` 再改写；
3. 对话页 BGM / 背景组件直接使用该 URL。

---

## 7. 文档 RAG（与文件库的关系）

- **入口**：用户在文件库上传文档 → 可选「加入知识库」→ 后台切片 + embedding → **独立 Lance 表**（与 `memory/conversations/*`、`lorebook-vector` **分表**）。
- **检索**：对话绑定 `knowledgeBaseIds`；assemble 时 TopK 注入（`resolveFeatureApi('rag_generate')`，API 在功能设置或对话 `apiPreset.rag` 配置）。
- **明确不做**：PDF/txt **不** 进入 `{{charFileN}}`；世界书手工条目仍走现有 `lorebook-resolve`。

P1「独立知识库 RAG」的**文档管线**依赖本文件库 **M1 + M4**；`rag_generate` 在 RAG 功能设置页或对话 API 设定中接线。

---

## 8. 与现有能力的关系

| 现有 | 关系 |
|------|------|
| 角色立绘 `/api/i/:token` | 公开立绘 URL；文件库用 **独立** `/api/m/:token`，不复用立绘路由；charFile 为附加图片槽，不替换立绘 |
| 世界书 vector | 条目级触发；与文档 RAG **并存、分表** |
| turn memory Lance | 对话摘要向量；与文档 RAG **分表** |
| 插件 `host.fileAsset` | 小文件侧车；P3 不强制迁移 |
| 连接 / 对话 API 设定 | `rag_generate` 绑定独立；与 chat 主 API 分离 |

---

## 9. 前端 UI（规划）

- **路由**：`/files`（或 `/library`），侧栏与「角色」「资料库」并列。
- **能力**：网格/列表、按 kind 筛选、上传、预览、**更新内容**（`PUT …/content`，URL 不变）、删除、复制内容 URL（**相对 path** `/api/m/…`）；详情「内容 URL」为可点击超链接；详情操作区为 **图标按钮**（tooltip：复制 / 更新 / 重命名 / 删除）；文档项显示 RAG 索引状态。
- **角色编辑**：在角色表单中「图片槽」从文件库选择图片（写 `imageFiles`）。
- **对话设置**：背景 / BGM / 知识库选择器（引用 fileId / kbId）。

**不是**：在世界书编辑器内嵌通用上传区。

---

## 10. 实施分期（建议）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **M1** ✅ 2026-07-13 | `files/` 落盘 + REST + 公开 `/api/m` + `/files` UI | — |
| **M2** | 角色 `imageFiles` + `{{charFileN}}` 宏 + `fileContentUrl` | M1 |
| **M3** | 对话 BGM·背景绑定 fileId（URL 已公开，无需 withAccessToken） | M1 |
| **M4** | 文档切片 + 独立 Lance + 对话绑知识库 | M1、RAG API 设定 |
| **M5** | 引用检查、批量导入、视频预览优化 | M1–M3 |

P0 排期：**至少完成 M1–M3** 可交付「文件库 + charFile + 展示」闭环；M4（独立文档 RAG）同列 P0，与 RAG API 设定一并推进。

---

## 11. 验收要点（实现后）

- [ ] 上传图片后，角色槽 N 绑定，`assemble-preview` 中可见 `/api/m/{token}` **且无** `access_token`
- [ ] 模型返回含该 URL 的 HTML，刷新页面后图片仍可显示（公开 GET，无需前端拼 token）
- [ ] 改密或 session 失效后，**历史 turn 内 `/api/m/…` 不变且仍可显示**（删文件则 404）
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
- RAG 功能设置与 `resolveFeatureApi('rag_generate')` 引用本文档为前置。
