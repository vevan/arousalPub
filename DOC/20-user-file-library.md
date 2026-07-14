# 用户文件库与 charFile 媒体管线（定案 · P0）

> **状态**：设计定案；**M1 已落地**（2026-07-13）。**M2 已落地**（2026-07-14 · 宿主 index 绑定 + FileID/FileName 宏 + 角色预览绑定 UI）。M3–M5 未实现。  
> **定案日期**：2026-06-08（M2 细节 2026-07-14）  
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
2. **角色绑定文件 + 宏**：`{{char{k}FileID::…}}` / `{{char{k}FileName::…}}`（及 persona 对称）在 **assemble / opening 展宏前** 展开为稳定公开 URL（`/api/m/{token}`），供 LLM 在 HTML 等输出中引用。
3. **对话级媒体**：BGM（音频 `fileId`）、背景图（图片 `fileId`），存于对话 `index.json`，**不走宏**。
4. **文档式 RAG**：长文档经文件库入库 → 切片 → 独立 Lance 表 → 对话绑知识库检索；**文档不进绑定表的产品主路径**（绑定表技术上允许任意 kind，见 §3.3）。

本项 **不** 在 P3 阶段实现全功能，先以本文档固化边界与分期，避免与 P0 `api_configs`、P1 独立 RAG、插件 `fileAsset` 混用同一抽象。

---

## 2. 能力边界（定案表）

| 能力 | 定案 | 消费方 |
|------|------|--------|
| **用户文件库** | 用户级 CRUD + 二进制落盘 + 列表/筛选 UI | 全产品 |
| **角色 / persona 绑定** | **不进** `{id}.png` / `chara`；写在 **`characters/index.json` 顶层**（仿 `userCardList`） | 角色预览绑定 UI + 宏 |
| **宏** | `{{char{k}FileID::id}}` / `{{char{k}FileName::name}}`；persona：`{{userFileID::…}}` / `{{userFileName::…}}` | assemble / opening |
| **发给 LLM** | 只传 **公开 `/api/m/:token` 相对路径字符串**，**不传**图片 body、**不**拼 JWT | `assemble-messages` / 插件 complete |
| **助手 HTML 落盘** | turn **无需**再展宏；模型输出已抄写 `/api/m/…` | 气泡 `<img src>` **直接可用** |
| **展示鉴权** | 公开 media token URL（**独立路由** `/api/m/`） | Web 气泡 / 内心剧场 |
| **文档** | 文件库 kind=`document` → RAG 索引（独立 Lance 表） | `rag_generate` + 对话 `knowledgeBaseIds` |
| **对话 BGM / 背景** | `conversation.index` 存 fileId（**M3**） | 对话页 |
| **插件 `fileAsset`** | 短期保留；长期可迁到 `fileId` 引用（非必做） | plot-summary 等 |

---

## 3. 存储与数据模型

### 3.1 目录布局

```
data/{userId}/files/
  index.json          # 列表摘要（fileId、kind、name、mime、size、createdAt、updatedAt、tags?）
  {fileId}/           # fileId = 8 位 hex
    meta.json
    content
```

- **归属**：CRUD 仅靠 JWT `sub` ↔ `userId`；内容展示走 **`/api/m/:token`**。
- **索引**：`files/index.json` 损坏时可从 `{fileId}/meta.json` 重建。

### 3.2 `kind` 与 MIME

| kind | 典型 MIME | 角色绑定 | RAG | BGM | 背景 |
|------|-----------|----------|-----|-----|------|
| `image` | image/png, jpeg, webp, gif | ✅ | ❌ | ❌ | ✅ |
| `document` | text/plain, markdown, pdf, … | ✅（允许；失效自负） | ✅ | ❌ | ❌ |
| `audio` | audio/mpeg, ogg, … | ✅ | ❌ | ✅ | ❌ |
| `video` | video/mp4, … | ✅ | ❌ | ❌ | ❌ |

上传时校验 kind ↔ MIME 白名单。**展示名 `name` 允许全库重名**（唯一键仅为 `fileId`）。

### 3.3 角色 / persona 文件绑定（M2 · 2026-07-14）

**不落角色卡。** 卡正文权威仍是 `{id}.png`（`chara`）；宿主元数据写在 **`characters/index.json`**，与 `userCardList` 同模式：

```json
{
  "schemaVersion": 1,
  "entries": [ /* 由 PNG 派生的列表摘要 */ ],
  "userCardList": ["…"],
  "imageFilesByCharacterId": {
    "a1b2c3d4": ["f1le0001", "f1le0002"]
  }
}
```

| 规则 | 定案 |
|------|------|
| 每角色上限 | **30** 个 `fileId` |
| 存储内容 | 仅有序 `fileId[]`（不快照 name） |
| 允许 kind | **任意**已存在文件；非图片由用户自负 |
| 导出 PNG / JSON | **不含**本字段（永不写入 `chara`） |
| rebuild index | 重写 `entries` 后 **merge** 旧 `imageFilesByCharacterId`，并丢掉已删角色 id |
| persona | 会话 `userCharacterId` 对应卡走同一 map；宏见 §5 |

**绑定时重名（同角色绑定集内）**：

1. 文件库 **允许** 全库重名。
2. **绑定 / 保存绑定列表**时：若新集合内存在 **trim + 大小写不敏感** 同名（按当前 `meta.name`），**拒绝**并提示。
3. **绑定后**在文件库改名导致集合内重名：
   - 角色绑定 UI **显示警告**（仍保持绑定，不自动解绑）；
   - `FileName` 展宏：在绑定集内按 name 匹配，**多条时取 `createdAt` 最早，并列则 `fileId` 字典序**（避免破图）；UI 文案须说明此规则。

### 3.4 对话级引用（M3）

`chats/{chatId}/index.json`：

```json
{
  "backgroundImageFileId": "…",
  "bgmFileId": "…",
  "knowledgeBaseIds": ["kb-…"]
}
```

- BGM / 背景：**直接 fileId**，不经宏。
- 知识库：RAG Phase 另定。

---

## 4. HTTP API

### 4.1 文件库（M1 ✅）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/files` | 列表（`?kind=&search=&offset=&limit=`） |
| `POST` | `/api/files` | multipart 上传 |
| `GET` | `/api/files/:fileId` | 元数据 + `contentUrl` |
| `GET` | `/api/files/:fileId/content` | 二进制（JWT） |
| `PUT` | `/api/files/:fileId/content` | 原地更新（fileId/URL 不变） |
| `PATCH` | `/api/files/:fileId` | 改名、标签（**允许**与它文件重名） |
| `DELETE` | `/api/files/:fileId` | 删除；**M2 允许删**（引用变空/404）；完整引用检查见 **M5** |
| `GET` | `/api/m/:token` | 公开内容 |

内容 URL：`fileContentUrl(fileId)` → `/api/m/{token}`（相对路径）。

**删后恢复引用（可选 · 非 M2 必做）**：换图优先 `PUT …/content` 保 id；另可后续支持「空闲 fileId 重建」以恢复误删 URL。

### 4.2 角色绑定（M2）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/characters/:id/image-files` | `{ fileIds, items[], nameConflict: boolean }`（items 含现 meta + contentUrl） |
| `PUT` | `/api/characters/:id/image-files` | Body `{ fileIds: string[] }`；**已删 fileId 自动剪除**；≤30、**集内 name 唯一**；否则 400 |

- 亦可并入 `GET/PATCH /api/characters/:id` 响应/body 扩展字段，实现时二选一，以本节路由为准。
- **禁止**把绑定列表写入 `card` 浅合并进 PNG。

---

## 5. 宏展宏（M2）

在 `prompt-macros`（CST）增加带 `::` 参数的宏（仅服务端；**assemble / opening / plugin macro-expand** 一并展）：

| 宏 | 含义 |
|----|------|
| `{{charFileID::fileId}}` / `{{char1FileID::fileId}}` | `characterIds[0]` 绑定集 |
| `{{char{k}FileID::fileId}}` | `characterIds[k-1]`（k≥1） |
| `{{char{k}FileName::name}}` | 同上，按展示名查 |
| `{{userFileID::fileId}}` / `{{userFileName::name}}` | 会话 `userCharacterId` 卡的绑定集 |

规则：

1. 解析 `characterIds` / `userCharacterId` → 读 `imageFilesByCharacterId`。
2. **FileID**：参数为 8 位 hex；须在该角色绑定集内且文件仍存在 → `fileContentUrl`；否则 `""`。
3. **FileName**：在绑定集内按 name（trim、大小写不敏感）匹配；0 → `""`；1 → URL；**>1 → 最早 `createdAt`（并列 `fileId`）**。
4. 展开结果仅为 **相对** `/api/m/…`（无 host、无 `access_token`、默认无 `?size=`）。
5. 不改写已落盘历史 turn。

---

## 6. 展示层（Web）

1. `fileLibraryContentUrl(userId, fileId)` → `/api/m/{token}`。
2. 气泡 `/api/m/…` 无需再改写。
3. **M2 UI**：角色预览按钮组「文件库绑定」——**仅从已有文件库多选**（不在此上传）；显示集内重名警告；保存走 §4.2。

---

## 7. 文档 RAG（与文件库的关系）

- **入口**：文件库上传文档 → 可选「加入知识库」→ 切片 + embedding → **独立 Lance 表**。
- **明确不做**：文档管线 **不**替代世界书；绑定表与 RAG 索引分离。
- **索引策略**：先 FTS + flat；ANN 行数门控见 `DOC/03` §14.4.2 / M4。

---

## 8. 与现有能力的关系

| 现有 | 关系 |
|------|------|
| 角色立绘 `/api/i/:token` | 不复用；绑定文件是附加资源，不替换立绘 |
| `userCardList` | 同文件宿主元数据模式 |
| 世界书 / turn memory Lance | 与文档 RAG 分表 |
| 插件 `host.fileAsset` | 短期保留 |

---

## 9. 前端 UI

- **M1 ✅**：`/files` 网格、kind、上传、更新内容、标签、删除、复制 URL。
- **M2**：角色预览「文件库绑定」对话框（文件库选择器 + 重名警告）；persona 卡同能力。
- **M3**：对话设置背景 / BGM 选择器。

**不是**：在世界书编辑器内嵌通用上传区。

---

## 10. 实施分期

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **M1** ✅ 2026-07-13 | `files/` + REST + `/api/m` + `/files` UI | — |
| **M2** ✅ 2026-07-14 | `imageFilesByCharacterId` + FileID/FileName 宏 + 角色绑定 UI | M1 |
| **M3** | 对话 BGM·背景 fileId | M1 |
| **M4** | 文档切片 + 独立 Lance + 知识库 | M1、RAG API |
| **M5** | 引用检查、批量导入、视频预览；可选指定 id 重建 | M1–M3 |

---

## 11. 验收要点（M2）

- [ ] 角色绑定 ≤30；集内同名拒绝保存
- [ ] `assemble` / opening / plugin-macro-expand 中 `FileID`/`FileName` 展开为 `/api/m/{token}` 且无 `access_token`（`assemble-preview` 用样例卡、无真实绑定）
- [ ] 缺失 / 未绑 / 已删 → `""`；PUT 自动剪除缺失 id
- [ ] 事后改名致重名：绑定页警告；FileName 取最早文件 URL
- [ ] 导出 PNG/JSON **不含**绑定列表
- [ ] 删文件允许；宏变空；历史 turn 内旧 URL 可 404

---

## 12. 开放问题

1. ~~`imageFiles` 写入角色卡 vs 宿主字段~~ → **已定：宿主 `characters/index.json`**。
2. 知识库实体形态（M4）。
3. PDF 切片器选型（M4）。
4. 单用户文件配额（内网默认可不设）。
5. 删后指定 fileId 重建（可选，非 M2 阻塞）。

---

## 13. 文档维护

- 落地后更新 `DOC/03` §17（M2 小节）；`DOC/04` 勾选 M2。
- `data/README.md` 补充 `imageFilesByCharacterId`。
