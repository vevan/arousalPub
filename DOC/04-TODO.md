# TODO

> **项目阶段**：已脱离 MVP（见 `cursor.md`、`DOC/02` §1.1）。下列 P0/P1 为当前排期标签，**不是** MVP 裁剪清单。

### P0 完成度概览（2026-05-26 核对 · JWT/RAG 二次核实）

| 类别 | 状态 | 说明 |
|------|------|------|
| 基础工程 | ✅ | `server/` Fastify + `web/` Vue3/Pinia/Vuetify |
| **JWT 多用户认证** | ✅ | `users.index.json` + scrypt；`/api/auth/*`；全局 `/api/*` 鉴权（`auth.ts`） |
| 对话核心 | ✅ | SSE `/api/chat`、chunk 链（`DOC/08`）、角色 / Prompt / 世界书 |
| 组装与记忆 | ✅ | §14.9 管线、§14.4.1 budget trim（全局 + 会话设置 UI）、§15 宏 |
| **向量检索（部分 RAG）** | ✅ | 对话 **memory** Lance TopK；资料库 **vector** 条目 TopK（可选 `vectorEnabled`） |
| API Key 隔离 | ✅ | 定案与落地见 `DOC/13` |
| 前端对话 UI | ✅ | `HomeChat` 已拆子组件 + `useChatSession`（见 §前端工程） |
| **仍待 P0** | ⏳ | 独立知识库 RAG（见下）、§1.2 独立 `api_configs`/`feature_bindings` 集合、分支 UI、全量调用日志 |

## P0（当前优先）

### API Key 服务端隔离（已完成）

> 定案与验收：**`DOC/13-api-key-server-side-isolation.md`**（2026-06-02 定案，2026-06 落地）。

- [x] **GET 脱敏**：`/api/api-keys`、`/api/settings`、`/api/user-preferences`（embedding）不返回明文 key
- [x] **PUT merge 写**：api-keys / settings / embedding PATCH 省略 key 时保留磁盘
- [x] **`api-credential-resolve`**：`POST /api/chat`、`POST /api/models` 服务端解析 `apiPresetId` / `apiKeyId`，body 不要求 `apiKey`
- [x] **`POST /api/api-keys/:id/reveal`**：校验登录密码后一次性返回 key
- [x] **前端隔离**：`apiKeys` / `connection` / `chat-api` / `useChatSession` / `ConnectionSettingsCard` / Embedding 设置
- [x] **验收与文档**：`DOC/13` §6、`DOC/03` §4、`cursor.md`

- [x] 初始化后端 Fastify 项目结构（`server/`）
- [x] 初始化前端 Vue3 + Pinia + Vuetify 项目结构（`web/`）
- [x] **JWT 多用户登录**（2026-06 已实现）：`data/users.index.json` 用户表；`auth-password.ts` scrypt 哈希；`auth.ts` + `@fastify/jwt`（access + refresh、`persisted`/`ephemeral` 会话）；`/api/auth/setup|register|login|refresh|logout|status`；除公开路由外 **`/api/*` 全局 JWT**（`runRequestUser` 解析 `sub`）；Web **`AuthView`** + `stores/auth.ts` + `install-authenticated-fetch.ts`
- [ ] 建立 `api_configs` 集合与 CRUD 接口 — **当前为文件型 `api-settings.json` + `/api/settings`，非独立 api_configs 服务**
- [ ] 建立 `feature_bindings` 集合与 CRUD 接口 — **未按文档 §1.2 独立集合实现**
- [x] 对话发送与 SSE 流式返回（`/api/chat` 等，见 `server/src/index.ts`）
- [ ] 消息树结构（parentId）与「从此分支继续」— **chunk/分支目录部分按 `DOC/03` 设计，产品级分支 UI 待对齐**
- [x] **Chunk 链按轮数切分与全链读取** — **`DOC/08`** 已实现（含 head/tail 修复 API、删空 tail 回退、单测）
- [x] 角色管理（文件库）：主存 **`data/{userId}/characters/{uuid}.png`**（内嵌 ST `chara`）；遗留 **`{uuid}.json`** 首次读取时迁移为 PNG；列表/筛选/导入/表单新建/删除/导出 API + Web **`/characters`**（见 `DOC/03` §12）
- [x] Prompt 预设：服务端 `data/{userId}/prompts/`（`index.json` + 各预设 JSON）+ `GET/PUT /api/prompts`；前端 **`/prompts`**；组装仅服务端（`assemble-preview` / `assemble-messages` API）
- [x] 世界书框架：`lorebooks/` 分文件存储、`GET/PUT /api/lorebooks`、Web 编辑与对话 `lorebookIds` 绑定、关键字/恒定注入（见 `DOC/03` §13）
- [x] **对话记忆（§14）收尾**：会话设置 UI（N / TopK）、落盘增量索引、**§14.4.1 统一 token 预算裁切**（lore → memory → history）；`assemble-messages` 返回 `droppedLoreCount` / `droppedMemoryCount` / `droppedHistoryCount`
- [x] **组装管线 §14.9 主干**：`runMemoryPipeline`、`boundMemory`（`<memory>` system）、`boundRecentHistory` / `history` 分组（**user/assistant 链**，非 `<history>` XML）、`buildScanText` + lore 递归（`lorebook-resolve`）
- [x] **宏管线 §15**：server `prompt-macros/handlers`、仅服务端展宏、`POST /api/prompts/assemble-preview`、opening 服务端展宏、删除 web `prompt-macros`
- [ ] **ST 宏扩展（备忘，未排期）**：可行性分级见 `DOC/14-st-macros-porting.md`
- [x] **对话 memory 向量召回**（§14）：Lance `memory/conversations/{id}` + `createEmbedding` + `searchTurnMemoryVectors`（`memory-pipeline.ts` / `memory-store.ts`）
- [x] **资料库向量检索**（§13，可选）：`vectorEnabled` + 条目 `triggerMode=vector` → `lorebook-vector-store` / `lorebook-resolve` TopK；保存后 `scheduleLorebookVectorReindex`
- [ ] **独立知识库 RAG**（**≠ 现有世界书**）：用户上传/导入 **长文档**（PDF、Markdown、txt 等）→ 自动 **切片** → embedding → 独立 Lance 表（与 turn memory、资料库条目 **分表**）→ 对话时向量 TopK 检索注入；`rag_generate` 能力接线。**未实现**。若设定资料只靠世界书手工条目维护，本项可长期不做。
- [ ] RAG/模型调用日志（耗时、token、**命中明细**）— **部分**：turn `receive.runtime`（model/durationMs/tokens）；`assemble-messages` 返回 dropped 计数与 `memoryTurnIds`；**未达**需求 §4 全量审计

## 前端工程（当前仓库）

- [x] **npm audit 安全项**（`marked` ≥18.0.4、`fast-uri` ≥3.1.2）— 2026-05-29，见 `DOC/00-alert.md`
- [x] **vue-i18n v9 → v11**（11.4.4）— 2026-05-29，见 `DOC/07-vue-i18n-migration.md`
- [x] **拆分** `web/src/components/HomeChat.vue` **为多个子组件**（2026-05-26：`useChatSession.ts` 承载会话逻辑；`ChatMessageList` / `ChatComposer` / `ChatDeleteDialog` / `ChatAssemblePreviewDialog` / `ChatTurnPromptDialog`；`HomeChat.vue` 约 60 行壳层，根 **`chat-session`**，见 `DOC/03` §11.2、`DOC/06` §2.2）

## 角色卡（ST v2 PNG 与生态 — 当前迭代）

与讨论一致：**会话绑定始终用 UUID**；磁盘主文件目标形态为 **`data/{userId}/characters/{uuid}.png`**（内嵌 Character Card V2 JSON）；列表依赖 **`characters/index.json`** 加速（与全量扫盘互为重建来源）。

### 存储与索引

- [x] **`characters/index.json`**（在 `data/{userId}/characters/` 下）：维护列表摘要（`id`、`name`、`summary`、`systemPromptPreview`、`tags`、`importedAt`、`updatedAt`），创建/导入/编辑/删除后同步；缺失或损坏时从磁盘 **重建**（扫描 **`*.png`** 与遗留 **`*.json`**）。
- [x] **主存 `{uuid}.png`**：`server/src/character-png.ts` 读写 PNG `tEXt`/`zTXt` **`chara`**（Base64 的 `chara_card_v2`）；新建/导入/编辑均落盘 PNG；**`normalizeTavernCardV2Data`** 补全 TavernCardV2 `data` 约定字段（含 `creator`、`alternate_greetings`、`extensions` 等）。
- [x] **服务端默认头像资源**：打包路径 **`server/assets/characters/default-avatar.png`**（非 `data/`）；无用户图或 JSON 迁移时用其打底写入 `chara`。

### 导入 / 导出

- [x] **导入 v2 角色卡 PNG**：`POST /api/characters/import-png`（multipart 字段 **`file`**）；解析 `chara` → 新 **`uuid`** → 原字节落盘 `{uuid}.png` + 更新索引。（大文件需服务端 **`bodyLimit`** 与 multipart `fileSize` 上限一致，见 `server/src/index.ts`。）
- [x] **导入 JSON / 表单新建**：经同一套规范化后写入 **`{uuid}.png`**；可选 **`multipart`**：`payload`（JSON 字符串）+ **`portrait`**（PNG）→ `POST /api/characters`。
- [x] **导出 v2 PNG**：`GET /api/characters/:id/export-png` 流式返回，`Content-Disposition` 文件名 **`charName.png`**（`card.name` slug + 冲突加时间戳）；体为 `{uuid}.png` 字节。
- [x] **导出整包 JSON**：`GET /api/characters/:id/export-json`（`schemaVersion` + ST v2 `card` 形态）；保留作调试或与 ST JSON 通道并存。

### 编辑与绑定

- [x] **在线编辑 `card`**：`PATCH /api/characters/:id`（`{ card }` 浅合并）；写回 **`{uuid}.png`** 内 `chara` 并刷新索引。
- [x] **立绘 / 头像上传**：`POST /api/characters/:id/portrait`（multipart **`portrait`**，须 PNG）；保留当前 `card` 重嵌图像；`GET /api/characters/:id/image` 供前端展示。
- [ ] **会话侧栏**：从角色库选卡写回 **`characterIds`**（替代仅 Snackbar 引导）。

### 其它

- [ ] **extensions / Character Hub 全字段**：与 ST 完全对齐的导入导出策略（按需迭代）；当前写入侧已保证 **`extensions`** 对象存在，Hub 级扩展仍待产品定义。
- [x] **角色库排序 / 筛选计数**：`GET /api/characters?sort=&order=`（默认 `name` + `asc`；名称按拉丁优先 + 中文拼音）；响应 `filterCounts`（搜索后、used/unused 筛选前统计）；Web 侧栏三项计数与排序 UI（见 `DOC/03` §12）
- [x] **PNG chunk 读写**：当前为 **`crc-32` + 手写 chunk 组装**（`character-png.ts`），未引入 `pngjs`/`sharp`；超大 `chara` 可考虑后续改 `zTXt` 写入以控体积。

### 对话列表与对话页（2026-05-26）

- [x] **会话列表卡片**：展示 user / 主角色头像（`userCharacterId` + `characterIds[0]`）；新建对话弹窗输入标题（非默认「新对话」）；选主角色可自动填标题
- [x] **`chat.index` 快查冗余**：`userName`、`characterNames`、`searchTags`；`enrichChatListEntry` + 角色 PATCH/删除刷新；`readChatList` 缺字段迁移（见 `DOC/03` §7.1）
- [x] **会话列表快查 UI**：`ConversationListView` 搜索框（标题 + 冗余名/标签）
- [x] **首页双视图**：对话列表 / 角色网格切换；**仅设置页**持久 `homeListMode`、`homeCharacterSource`（`usedInChats` / `allLibrary`）；进 `/` 重置 toggle 与快查框
- [x] **角色视图快查**：网格复用 `GET /api/characters?search=`；点角色 → 关联会话弹窗 → `/chat/:id`
- [x] **记忆向量重建提示**：仅当会话**已有** `memoryEmbeddingModel` 且与全局 embedding 配置不一致时弹窗（新建会话不触发）
- [x] **思维链复制**：reasoning summary 旁一键复制纯文本
- [x] **输入框草稿**：各会话 `localStorage` 持久化未发送内容（`composer-draft-storage.ts`）

## P1（次优先）

- [x] **单端口生产启动（`DOC/01` §9）**：`npm start` / `run-prod.mjs`、`static-web.ts`、`start.bat`/`start.sh`、`README.md`；根目录 `build`（web + server）；保留 `npm run dev`
- [x] API 配置连通性测试接口（test）— `POST /api/settings/presets/:id/test`（两阶段：models + chat）
- [x] API 配置引用检查与安全删除 — `GET/DELETE …/presets/:id`、`GET/DELETE /api/api-keys/:id`；PUT api-keys 拦截被引用 key 删除
- [x] **对话级 API 覆盖**（`DOC/03` §1.2.2）：主 API = 选已有 preset + 采样参数覆盖（**不可**自定义连接）；Embedding = 继承全局连接 + 可覆盖 model/dimensions；`ConversationContextSettings` + 服务端 resolve
- [ ] RAG 参数调优面板（TopK、阈值等）
- [ ] 导入导出（会话全量、角色批量等）— **单卡 PNG/JSON 导出已有；批量见 P1**
- [ ] 数据目录备份示例脚本与说明（规范见 `DOC/03` §8.7；**全量 zip 冷备见 §8.8，优先级靠后**）

## P2（V2）

- [x] 插件系统最小框架 — **`DOC/09-plugin-system-and-guidance-generate.md`**（2026-05-26 已实现：registry、settingsSchema、设置页）
- [x] 内置插件 `guidance-generate`、`reply-complete-sound` — **同上 §7**
- [ ] **`host.conversation` 对话读写 API**（单批 ≤50 轮、批处理写锁）— **`DOC/10-plugin-conversation-host.md`**
- [ ] 插件实例与 API 配置绑定
- [ ] 插件调用审计日志
- [ ] fallback 与健康检查策略

## P3（备忘 / 最低优先级）

> 来自实现与选型讨论，**不排期**；细节见 `DOC/03` **§14.10**、**§8.8**。

- [ ] **全量冷备 zip（`data/backups`）**：启动时若距上次成功备份 > N 天 → 服务端流式打包整棵 `data`（含 `memory/`）→ 冻 UI + 503 写锁；`backupIntervalDays` / `backupMaxKept`；Syncthing **ignore `backups`**；无下载。见 **`DOC/03` §8.8**。
- [ ] **Embedding MRL / 降维**：系统设置已支持 `embeddingDimensions`（留空=不传 OpenAI `dimensions`）；部分本地网关会忽略该参数仍返回满维。备选：换 TEI/vLLM 等支持 MRL 的推理端，或客户端截断前 N 维 + L2 归一化后入库。
- [ ] **Reranker 精排（P3 · 低优先级）**：cross-encoder 二阶段精排；`api-settings.json` 已预留 `rerank` capability，组装管线未接。**当前 memoryTopK / 资料库 vector TopK 较小，收益有限，不排期**（见 P3）。
- [ ] **Qwen query instruct**：官方建议 query 侧加任务指令前缀（约 +1～5% 检索），索引与检索均未实现。

## 文档维护 TODO

- [x] **API Key 隔离需求定案** — `DOC/13-api-key-server-side-isolation.md`（2026-06-02）
- [x] 原独立草稿已合并至 `DOC/02`、`DOC/03`
- [ ] 每次架构决策变更后更新 `DOC/01-架构设计.md`
- [x] 每次需求变更后更新 `DOC/02-需求说明.md` — 2026-06 会话列表快查冗余（§7）
- [x] 每次接口变更后更新 `DOC/03-实现细节.md`（**含 §7.1 列表冗余、§11.6 快查、§14.4.1 budget trim**）— 2026-06
- [x] 插件系统与指导生成定案 — `DOC/09-plugin-system-and-guidance-generate.md`（2026-05-26）
- [x] 插件系统实现文档 — `DOC/09`、`plugins/README.md`、`data/README.md` §插件（2026-05-26）
