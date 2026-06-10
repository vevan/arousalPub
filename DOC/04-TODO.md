# TODO

> **项目阶段**：已脱离 MVP（见 `cursor.md`、`DOC/02` §1.1）。下列 P0/P1 为当前排期标签，**不是** MVP 裁剪清单。

### P0 完成度概览（2026-06-10 核对）

| 类别 | 状态 | 说明 |
|------|------|------|
| 基础工程 | ✅ | `server/` Fastify + `web/` Vue3/Pinia/Vuetify |
| **JWT 多用户认证** | ✅ | `users.index.json` + scrypt；`/api/auth/*`；全局 `/api/*` 鉴权（`auth.ts`） |
| 对话核心 | ✅ | SSE `/api/chat`、chunk 链（`DOC/08`）、角色 / Prompt / 世界书 |
| 组装与记忆 | ✅ | §14.9 管线、§14.4.1 budget trim（全局 + 会话设置 UI）、§15 宏 |
| **向量检索（部分 RAG）** | ✅ | 对话 **memory** Lance TopK；资料库 **vector** 条目 TopK（可选 `vectorEnabled`） |
| API Key 隔离（不出浏览器） | ✅ | 定案与落地见 `DOC/13` |
| API Key 磁盘加密 | ✅ | AES-256-GCM 落盘 + 运维台 DEK 轮换（`DOC/16`、`DOC/17`） |
| **全量冷备 + 备份边界** | ✅ | §8.8 产品内 zip；Syncthing ignore + 恢复见 `data/README.md`、`DOC/03` §8.5 |
| **会话 debug 审计** | ✅ | `chat-audit.json`、三 Tab UI（`DOC/24` §3，2026-06-09 验收） |
| 前端对话 UI | ✅ | `HomeChat` 已拆子组件 + `useChatSession`（见 §前端工程） |
| **仍待 P0** | ⏳ | **原生正则替换**（`DOC/24` §2） |

## P0（当前优先）

### API Key 服务端隔离（已完成）

> 定案与验收：**`DOC/13-api-key-server-side-isolation.md`**（2026-06-02 定案，2026-06 落地）。

- [x] **GET 脱敏**：`/api/api-keys`、`/api/settings`、`/api/user-preferences`（embedding）不返回明文 key
- [x] **PUT merge 写**：api-keys / settings / embedding PATCH 省略 key 时保留磁盘
- [x] **`api-credential-resolve`**：`POST /api/chat`、`POST /api/models` 服务端解析 `apiPresetId` / `apiKeyId`，body 不要求 `apiKey`
- [x] **`POST /api/api-keys/:id/reveal`**：校验登录密码后一次性返回 key
- [x] **前端隔离**：`apiKeys` / `connection` / `chat-api` / `useChatSession` / `ConnectionSettingsCard` / Embedding 设置
- [x] **验收与文档**：`DOC/13` §6、`DOC/03` §4、`cursor.md`

### API Key 磁盘加密（P0 · **`DOC/16`**）

> **前置已完成**：`DOC/13` 服务端隔离。**2026-06 落地**：`api-keys.json` / `api-settings.json` 内联 key / `user-preferences.json` embedding key 落盘 **AES-256-GCM**（`keyEnc` / `apiKeyEnc`）；惰性迁移（读明文、写密文）。

- [x] **定案**：服务端 DEK（`DATA_ENCRYPTION_KEY` → `config.json` → `data/.data-encryption-key`）；AAD 绑定 `userId`；reveal 仍校验登录密码
- [x] **磁盘格式**：`EncryptedSecretV1`（`v/iv/tag/ct`）；`secret-encryption.ts` + 三处 file 读写
- [x] **迁移**：首次写入后加密；读路径兼容 legacy 明文
- [x] **DEK 轮换**：运维台 `rotate-data-key` + `suggest-key`（`DOC/17`）
- [x] **全量冷备 zip（§8.8）**：`backupIntervalDays` / `backupMaxKept`、启动检查、冻 UI + 503 写锁
- [x] **备份边界**：`data/backups` Syncthing ignore 与恢复说明（`data/README.md` §备份、`DOC/03` §8.5）
- [x] ~~对话轮次增量备份（§8.4）~~：**无限期延后**，不实现


- [x] 初始化后端 Fastify 项目结构（`server/`）
- [x] 初始化前端 Vue3 + Pinia + Vuetify 项目结构（`web/`）
- [x] **JWT 多用户登录**（2026-06 已实现）：`data/users.index.json` 用户表；`auth-password.ts` scrypt 哈希；`auth.ts` + `@fastify/jwt`（access + refresh、`persisted`/`ephemeral` 会话）；`/api/auth/setup|register|login|refresh|logout|status`；除公开路由外 **`/api/*` 全局 JWT**（`runRequestUser` 解析 `sub`）；Web **`AuthView`** + `stores/auth.ts` + `install-authenticated-fetch.ts`
- [x] API 预设登记与 CRUD — 文件型 `api-settings.json` + `/api/settings`（`presets[]` + `activePresetId`）
- [x] 出站 API 解析 — `feature-binding-resolve.ts` / `conversation-api-resolve.ts`；chat 用 `activePresetId` + 对话覆盖；插件/RAG 等在各功能页或对话 `apiPreset` 维护（无全局 `featureBindings[]`）
- [x] 对话发送与 SSE 流式返回（`/api/chat` 等，见 `server/src/index.ts`）
- [x] **Chunk 链按轮数切分与全链读取** — **`DOC/08`** 已实现（含 head/tail 修复 API、删空 tail 回退、单测）
- [x] 角色管理（文件库）：主存 **`data/{userId}/characters/{id}.png`**（`id` 为 8 位 hex，见 `DOC/03` §6.7；内嵌 ST `chara`）；遗留 **`{id}.json`** 首次读取时迁移为 PNG；列表/筛选/导入/表单新建/删除/导出 API + Web **`/characters`**（见 `DOC/03` §12）
- [x] Prompt 预设：服务端 `data/{userId}/prompts/`（`index.json` + 各预设 JSON）+ `GET/PUT /api/prompts`；前端 **`/prompts`**；组装仅服务端（`assemble-preview` / `assemble-messages` API）
- [x] 世界书框架：`lorebooks/` 分文件存储、`GET/PUT /api/lorebooks`、Web 编辑与对话 `lorebookIds` 绑定、关键字/恒定注入（见 `DOC/03` §13）
- [x] **对话记忆（§14）收尾**：会话设置 UI（N / TopK）、落盘增量索引、**§14.4.1 统一 token 预算裁切**（lore → memory → history）；`assemble-messages` 返回 `droppedLoreCount` / `droppedMemoryCount` / `droppedHistoryCount`
- [x] **组装管线 §14.9 主干**：`runMemoryPipeline`、`boundMemory`（`<memory>` system）、`boundRecentHistory` / `history` 分组（**user/assistant 链**，非 `<history>` XML）、`buildScanText` + lore 递归（`lorebook-resolve`）
- [x] **宏管线 §15**：server `prompt-macros/handlers`、仅服务端展宏、`POST /api/prompts/assemble-preview`、opening 服务端展宏、删除 web `prompt-macros`
- [ ] **ST 宏扩展（备忘，未排期）**：可行性分级见 `DOC/14-st-macros-porting.md`
- [x] **对话 memory 向量召回**（§14）：Lance `memory/conversations/{id}` + `createEmbedding` + `searchTurnMemoryVectors`（`memory-pipeline.ts` / `memory-store.ts`）
- [x] **资料库向量检索**（§13，可选）：`vectorEnabled` + 条目 `triggerMode=vector` → `lorebook-vector-store` / `lorebook-resolve` TopK；保存后 `scheduleLorebookVectorReindex`
- [x] **会话 debug 审计**（`DOC/24` §3）— **P0 已验收**：`chat-audit.json`、`assembly`、`chat`+`embedding` `calls[]`、服务端自写 `messages`、审计 UI 三 Tab；**未排期**：`plugin.complete` / `plugins[]`（见 `DOC/24` §3.6）

### 正则替换（原生 · P0 · **`DOC/24`** §2）

> **废止**：`regex-transform` 插件与 `host.capabilities` regex 试点（`DOC/09` §8.7、`DOC/10` 原 §6.3）。

- [ ] **规则存储**：`data/{userId}/regex-rules.json`；`order` / `phases` / `fields` / `skipLastNTurns`；`GET/PUT /api/regex-rules` — **Phase 0 已落地**（2026-06-10）
- [ ] **三阶段**：`display` / `outgoing`（含 **system**）/ `persist`；outgoing 在 budget trim 之后、`afterAssemblePrompts` 之前 — **outgoing 已落地**（Phase 1 · 2026-06-10）
- [ ] **近轮保留**：`skipLastNTurns` 为**规则级**选项，与 outgoing/persist/display 配合（tracker 等）
- [ ] **写盘合并**：多规则内存串联后一次提交；历史批量 `batchUpdateConversationTurns`（**禁止**一条规则写一次盘）
- [x] **流式落盘**：persist 完成后 SSE `final*` 回传；前端用 final 更新 UI、跳过读盘（Phase 2 · 2026-06-10）
- [ ] **拖曳优先级**：设置页拖曳调整 `order`；debounce **1 次**写规则文件
- [ ] **`host.regex` / server `api.regex`**：供 `conversation-export`、插件只读/改文
- [ ] **历史批量**：`POST .../regex/apply`（dry-run、区间、写锁）；导出可选规则

### 会话 debug 审计（P0 · **`DOC/24`** §3）

- [x] **`chat-audit.json`**：合并原 `chat-prompt.json`（`messages`）+ `assembly` + `calls`；废止 `chat-prompt` 新写入；读盘兼容旧文件
- [x] **双开关**：`auditDebug.enabled` + `auditDebug.maxStored`（设置页 + 进入会话时 PATCH 同步）
- [x] **仅 debug 写入**：关闭时不写；开启时 `/api/chat` 落盘成功后服务端自写（不依赖 `debugPrompt`）
- [x] **`GET .../chat-audit`** + 轮次审计 UI（Tab：提示词 / 组装命中 / 出站调用）
- [x] **组装审计**：`buildAssemblyAudit`；memory/lore/history 命中 + `included` + dropped；embedding 进 `calls[]`
- [x] **出站 token 展示**：`calls[].usage` 出站 tokens（上游或组装估算）+ 接收 tokens（上游或 tiktoken）
- [ ] **`plugin.complete` / `plugins[]`**（**未排期 · 非 P0**）：`calls` / `plugins` 字段已预留；当前无插件在 `/api/chat` 落盘同步链路内出站 LLM，见 `DOC/24` §3.6

### Historian（剧情纪要）插件（`plot-summary` · 2026-06-03）

> 实现指南：`DOC/12-plugin-plot-summary.md`。**状态（2026-06-08）**：**可验收** — 功能、宿主 API、UI/命名收尾已齐；存量数据 `memorybook*` → `autoSummarize*` 需自行对齐。

**联调与验收（2026-06-08）**

- [x] 手动摘要 + 确认预览落盘 + lorebook 前端缓存同步
- [x] keywords 硬性写入 `keys`（与触发方式无关）
- [x] **自动摘要块**（`blockTurns` + `bufferTurns`、指针 `lastSummarizedEnd` / `nextBlockStart`；自动触发仍经预览确认；无目标书弹框选书 — 见 `DOC/12` §1.2）
- [x] **端到端联调验收**（长对话首次 enable、块边界、跳过/中止不推进指针、busy 延后）

**v1.6 UI 与命名（2026-06-08）**

- [x] **设置键更名**：`memorybookEnabled` / `memorybookDefaultEnabled` → `autoSummarizeEnabled` / `autoSummarizeDefaultEnabled`（代码与 locales；存量 `pluginSettings` / `settings.json` 需用户或迁移脚本手动对齐）
- [x] **文案去 Memorybook**：composer 菜单、设置 schema、Toast/弹窗等用户可见文案统一为「自动摘要 / 剧情纪要」
- [x] **本对话设置顶栏**：所有 Tab 的标题+说明移至对话框 head，与「本对话设置」并排；正文区去掉重复 `h3`/说明
- [x] **插件 Tab UX**：详情页「返回插件列表」在 Tab 主体内；系统/会话插件列表「配置」改为 Vuetify Labs **`v-icon-btn`**（`mdi-cog`、无底色、小按钮+大图标）；开关与配置按钮间距；设置相关低对比按钮统一提升可视性

**P0 — Sidecar 设置 UI**

- [x] **替换全局设置中的 Sidecar JSON textarea**（`settingsSchema` 字段 `sidecars` → `objectList` 结构化 UI）

**P0 — 目标资料库自动 ensure（`DOC/12` §2.3 · `DOC/11` · 前置）**

> **未做前**：无 `targetLorebookId` 时弹框选已有书为**定案行为**（非静默、非跳过预览）。auto 模式落地后，**仅**在 `targetLorebookMode: auto` 时可免弹框建书。

- [x] **`host.lorebook.ensure`**：`POST /api/plugins/:pluginId/lorebooks/ensure`，按 `autoLorebookNameTemplate` 自动建 summary 书
- [x] 权限：`plot-summary` manifest `lorebook.write` + `conversation.read`
- [x] **v1.6 更名**：`curated-memory` → `plot-summary`；manifest `Historian`；中文 **剧情纪要**；启动迁移 `migrate-plot-summary.ts`
- [x] **v1.6 资料库排序**：通用 `apply-order`；算法 `shared/lorebook-sort.ts`；移除 `reorder-curated`
- [x] 插件：`targetLorebookMode` / `autoLorebookNameTemplate` schema；`ensureTargetLorebook` 在 **auto** 时走 ensure；**manual 仍弹框选书**

**区间选择 UI（`DOC/12` §7.2）**

- [x] 宿主 **`turn-block-head`** slot 挂载点 + slot 按钮 **`class`** + **`registerStyles`**（`DOC/18` §3.1、`DOC/09` §8）
- [x] 插件：`turn-block-head` ▷/◁ 状态机；◁ → 手动摘要对话框预填起止轮

**工程（2026-06-02）**

- [x] 插件 `src/` 拆分 + esbuild 打包（`dist/web.mjs` + `dist/server.mjs`）
- [x] 宿主 `host.plugin.prepareContext` / `completeDraft`、`host.lorebook.normalizeEntryRefs`

## 前端工程（当前仓库）

- [x] **npm audit 安全项**（`marked` ≥18.0.4、`fast-uri` ≥3.1.2）— 2026-05-29，见 `DOC/00-alert.md`
- [x] **vue-i18n v9 → v11**（11.4.4）— 2026-05-29，见 `DOC/07-vue-i18n-migration.md`
- [x] **拆分** `web/src/components/HomeChat.vue` **为多个子组件**（2026-05-26：`useChatSession.ts` 承载会话逻辑；`ChatMessageList` / `ChatComposer` / `ChatDeleteDialog` / `ChatAssemblePreviewDialog` / `ChatTurnPromptDialog`；`HomeChat.vue` 约 60 行壳层，根 **`chat-session`**，见 `DOC/03` §11.2、`DOC/06` §2.2）

## 角色卡（ST v2 PNG 与生态 — 当前迭代）

与讨论一致：**会话绑定始终用角色 id**（**8 位 hex 短 id**，见 `DOC/03` §6.7）；磁盘主文件目标形态为 **`data/{userId}/characters/{id}.png`**（内嵌 Character Card V2 JSON）；列表依赖 **`characters/index.json`** 加速（与全量扫盘互为重建来源）。

### 存储与索引

- [x] **`characters/index.json`**（在 `data/{userId}/characters/` 下）：维护列表摘要（`id`、`name`、`summary`、`systemPromptPreview`、`tags`、`importedAt`、`updatedAt`），创建/导入/编辑/删除后同步；缺失或损坏时从磁盘 **重建**（扫描 **`*.png`** 与遗留 **`*.json`**）。
- [x] **主存 `{id}.png`**：`server/src/character-png.ts` 读写 PNG `tEXt`/`zTXt` **`chara`**（Base64 的 `chara_card_v2`）；新建/导入/编辑均落盘 PNG；**`normalizeTavernCardV2Data`** 补全 TavernCardV2 `data` 约定字段（含 `creator`、`alternate_greetings`、`extensions` 等）。
- [x] **服务端默认头像资源**：打包路径 **`server/assets/characters/default-avatar.png`**（非 `data/`）；无用户图或 JSON 迁移时用其打底写入 `chara`。

### 导入 / 导出

- [x] **导入 v2 角色卡 PNG**：`POST /api/characters/import-png`（multipart 字段 **`file`**）；解析 `chara` → 分配新 **8 位 id** → 原字节落盘 `{id}.png` + 更新索引。（大文件需服务端 **`bodyLimit`** 与 multipart `fileSize` 上限一致，见 `server/src/index.ts`。）
- [x] **导入 JSON / 表单新建**：经同一套规范化后写入 **`{id}.png`**；可选 **`multipart`**：`payload`（JSON 字符串）+ **`portrait`**（PNG）→ `POST /api/characters`。
- [x] **导出 v2 PNG**：`GET /api/characters/:id/export-png` 流式返回，`Content-Disposition` 文件名 **`charName.png`**（`card.name` slug + 冲突加时间戳）；体为 `{id}.png` 字节。
- [x] **导出整包 JSON**：`GET /api/characters/:id/export-json`（`schemaVersion` + ST v2 `card` 形态）；保留作调试或与 ST JSON 通道并存。

### 编辑与绑定

- [x] **在线编辑 `card`**：`PATCH /api/characters/:id`（`{ card }` 浅合并）；写回 **`{id}.png`** 内 `chara` 并刷新索引。
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

### 性能审计与 Memory v2（`DOC/22` · 2026-06）

> 完整审计表、Memory v2 schema（`branchPath` + `chunkFileName` 拆列）、实施顺序见 **`DOC/22-performance-audit-and-optimization.md`**（**P0–P3 已勾完**）。旧 Lance `mem_*` / legacy **不兼容**，落地后全量重建向量。  
> **另列**：会话消息 UI 懒加载（`DOC/15` S2–S4）**不属于** `DOC/22` 路线图，仅复用 P1 的 `readTurnsTail` 等原语。

- [x] Turn 批量写 / 区间读（`DOC/10` §3.3、`batchUpdateConversationTurns`、`readTurnsInOrdinalRange`）
- [x] Lorebook `apply-order` 1 读 1 写
- [x] **Memory v2**：单表 `turn_memory` + `branchPath`/`chunkFileName` + `loadTurnsForMemoryHits`（`DOC/22` P0；**部署后须重建索引**）
- [x] **`syncChunkIndexIfDrifted` 节流**：热路径移除 sync；`CHUNK_INDEX_SYNC_TTL_MS`（`DOC/22` P1）
- [x] **`memory-pipeline` / `plugin-prepare-context` 区间读**：`readTurnsTail` + `readTurnsInOrdinalRange`（`DOC/22` P1）
- [x] **Embedding 重建并发/批量**（`embedding-batch.ts`、`embedTextsInBatches`）
- [x] **预算裁切增量 token**（`estimateTrimTokenDelta` + `TRIM_TOKEN_REVERIFY_EVERY`）
- [x] **资料库按 id 加载**（`readLorebooksByIds`）+ **批量 entry API**（`POST .../entries/batch`）
- [x] **plot-summary 插件改用 `createEntriesBatch`**（本轮摘要落盘批量 1 读 1 写；sidecar patch 仍逐条）
- [x] **分支 chunk 链 + `enumerateAllChunkChains`**（服务端：注册表递归枚举、memory reindex/召回 activeBranch 过滤；消息树 UI 仍待做）
- [x] **M4 整包 PUT 护栏**（`LOREBOOKS_BULK_PUT_*`、2s 限流、`lorebooks_bulk_put_*` 错误码）
- [x] **M5 preferences 请求 memo**（`request-preferences-memo.ts`，经 `runRequestUser` 自动启用）

- [x] **会话级插件 Tab** — **`DOC/21-conversation-plugin-settings.md`**（`conversationSettingsSchema`、对话齿轮 → 插件 Tab、`plot-summary` 摘要资料库仅会话级）
- [x] **本机运维台（Admin Console）** — **`DOC/17-admin-console.md`**（loopback + `00000000`；用户 CRUD；DEK 轮换 + 推荐密钥）
- [x] **安全硬化（部署）** — **`DOC/25-security-deployment.md`**：clientWhitelist、setup loopback、allowPublicRegister、认证限流、插件 ID、CORS、customParams 黑名单、upstreamUrlPolicy、上游超时、富文本禁 `<style>`（messages 分页仍 `DOC/15`）
- [ ] **独立知识库 RAG**（**≠ 现有世界书**）：用户上传/导入 **长文档**（PDF、Markdown、txt 等）→ 自动 **切片** → embedding → 独立 Lance 表（与 turn memory、资料库条目 **分表**）→ 对话时向量 TopK 检索注入；`rag_generate` 能力接线。**未实现**。**文档管线前置**：用户文件库 **`DOC/20`** M1+M4。若设定资料只靠世界书手工条目维护，本项可长期不做。
- [ ] **消息树 / 分支 UI**：消息树结构（`parentId`）与「从此分支继续」— **实现指南 `DOC/23-conversation-branches.md`**（§6 待办清单；服务端 memory/枚举已就绪）
- [ ] **会话消息分页与前端懒加载** — **`DOC/15-conversation-messages-lazy-load.md`**（`GET .../messages?tail|before|from/to`、chunk 区间读、默认尾部 80 轮、上滚追加；插件 `readConversationTurnsRange` 改真分页；Phase 2 可选虚拟滚动）
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

### 用户文件库与 charFile（**`DOC/20-user-file-library.md`** · 2026-06-08 定案）

> 用户级统一媒体库（图/文档/音频/视频）+ 角色 `{{charFileN}}` 图片槽 + 对话 BGM/背景 + 文档 RAG 底座。展示鉴权与立绘对齐（`/api/files/{fileId}/content` + `withAccessToken`）；assemble 仅展宏 **无 token** path。

- [ ] **M1 文件库底座**：`data/{userId}/files/`、`index.json`、REST CRUD、`allowsQueryAccessToken`、Web `/files` 列表/上传
- [ ] **M2 charFile 宏**：角色 `imageFiles` + `{{charFileN}}` / `{{char2FileN}}` assemble 展宏 + `fileContentUrl`
- [ ] **M3 展示与对话媒体**：`render-rich-message` 鉴权包装；对话 `index.json` 背景图 / BGM `fileId`
- [ ] **M4 文档 RAG**（可与 P1 独立 RAG 合并）：切片 + 独立 Lance + 对话绑知识库（**不进 charFile**）
- [ ] **M5 打磨**：删除引用检查、批量导入、视频预览等

- [x] ~~**全量冷备 zip**~~：已提升至 P0，见上「API Key 磁盘加密」段后 **§8.8** 项（`DOC/03` §8.8）
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
- [x] **用户文件库与 charFile 定案** — `DOC/20-user-file-library.md`（2026-06-08，列入 P3）
- [x] **Historian（剧情纪要）自动摘要语义对齐** — `DOC/12` §1.2（自动≠静默、预览必选、ensure 前置）（2026-06-08）
- [x] **插件 slot `class` / `registerStyles` + `turn-block-head`** — `DOC/12` §7.2、`DOC/18` §3.1（2026-06-08）
- [x] **plot-summary v1.6 更名/UI 收尾** — `autoSummarize*` 字段、本对话设置顶栏、插件 `v-icon-btn`；`DOC/12` §9、`DOC/21` §3（2026-06-08）
- [x] **plot-summary 端到端验收** — `DOC/04` Historian 段、`DOC/12` §9（2026-06-08）
- [x] **正则原生 + 会话审计定案** — `DOC/24-regex-and-session-audit.md`（2026-06-08）
- [x] **会话审计 + 备份边界文档同步** — `DOC/04` 概览、`DOC/24` §3、`data/README.md`、`DOC/03` §8.8（2026-06-10）
- [x] **正则实施计划归档** — `DOC/24` §6（系统设置唯一入口、无对话级设置）（2026-06-10）
