# TODO

> **项目阶段**：已脱离 MVP（见 `cursor.md`、`DOC/02` §1.1）。下列 P0/P1 为当前排期标签，**不是** MVP 裁剪清单。

## P0（当前优先）

- [x] 初始化后端 Fastify 项目结构（`server/`）
- [x] 初始化前端 Vue3 + Pinia + Vuetify 项目结构（`web/`）
- [ ] 完成 JWT 登录（用户表、密码 hash、登录态校验）— **当前仓库未实现**
- [ ] 建立 `api_configs` 集合与 CRUD 接口 — **当前为文件型 `api-settings.json` + `/api/settings`，非独立 api_configs 服务**
- [ ] 建立 `feature_bindings` 集合与 CRUD 接口 — **未按文档 §1.2 独立集合实现**
- [x] 对话发送与 SSE 流式返回（`/api/chat` 等，见 `server/src/index.ts`）
- [ ] 消息树结构（parentId）与「从此分支继续」— **chunk/分支目录部分按 `DOC/03` 设计，产品级分支 UI 待对齐**
- [ ] **Chunk 链按 100 轮切分与全链读取** — 方案见 **`DOC/08-chunk-chain-implementation.md`**（S1–S7：滚动 tail、`readAllTurns`、messages/memory/PATCH/迁移）
- [x] 角色管理（文件库）：主存 **`data/{userId}/characters/{uuid}.png`**（内嵌 ST `chara`）；遗留 **`{uuid}.json`** 首次读取时迁移为 PNG；列表/筛选/导入/表单新建/删除/导出 API + Web **`/characters`**（见 `DOC/03` §12）
- [x] Prompt 预设：服务端 `data/{userId}/prompts/`（`index.json` + 各预设 JSON）+ `GET/PUT /api/prompts`；前端 **`/prompts`**；组装仅服务端（`assemble-preview` / `assemble-messages` API）
- [x] 世界书框架：`lorebooks/` 分文件存储、`GET/PUT /api/lorebooks`、Web 编辑与对话 `lorebookIds` 绑定、关键字/恒定注入（见 `DOC/03` §13）
- [ ] **对话记忆（§14）**：LanceDB 索引、`resolveTurnById`、`boundMemory` + `boundRecentHistory`（history/memory 各一条 system）、`chat-assemble` 合并、对话设置 N / TopK、索引增量与 reindex
- [ ] **组装管线 §14.9**：`userText`→memory+history→`scanCorpus` 匹配 lore（递归 2、`loreScanScope`、去重与 token 上限）；`resolveLoreRecursive` / `buildScanText`
- [x] **宏管线 §15**：server `prompt-macros/handlers`、仅服务端展宏、`POST /api/prompts/assemble-preview`、opening 服务端展宏、删除 web `prompt-macros`
- [ ] 知识库 RAG：向量切片、检索、重排序 — **在 §13 框架之上扩展**（与 §14 turn 表分离）
- [ ] RAG/模型调用日志（耗时、token、命中明细）— **部分字段在 turn `runtime` 等，未达需求文档 §4 全量**

## 前端工程（当前仓库）

- [x] **npm audit 安全项**（`marked` ≥18.0.4、`fast-uri` ≥3.1.2）— 2026-05-29，见 `DOC/00-alert.md`
- [x] **vue-i18n v9 → v11**（11.4.4）— 2026-05-29，见 `DOC/07-vue-i18n-migration.md`
- [ ] **拆分** `web/src/components/HomeChat.vue` **为多个子组件**（单文件体积过大；可按消息列表 / 输入区 / 各 `v-dialog`、工具函数注入等边界拆分，并保持 `chat-body` + `chat-footer` 根结构约定，见 `DOC/06-工作交接.md` §2.2）

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
- [x] **记忆向量重建提示**：仅当会话**已有** `memoryEmbeddingModel` 且与全局 embedding 配置不一致时弹窗（新建会话不触发）
- [x] **思维链复制**：reasoning summary 旁一键复制纯文本
- [x] **输入框草稿**：各会话 `localStorage` 持久化未发送内容（`composer-draft-storage.ts`）

## P1（次优先）

- [x] **单端口生产启动（`DOC/01` §9）**：`npm start` / `run-prod.mjs`、`static-web.ts`、`start.bat`/`start.sh`、`README.md`；根目录 `build`（web + server）；保留 `npm run dev`
- [ ] API 配置连通性测试接口（test）
- [ ] API 配置引用检查与安全删除
- [ ] 会话级模型参数覆盖能力
- [ ] RAG 参数调优面板（TopK、阈值等）
- [ ] 导入导出（会话全量、角色批量等）— **单卡 PNG/JSON 导出已有；批量见 P1**
- [ ] 数据目录备份示例脚本与说明（规范见 `DOC/03-实现细节.md` §8.7）

## P2（V2）

- [x] 插件系统最小框架 — **`DOC/09-plugin-system-and-guidance-generate.md`**（2026-05-26 已实现：registry、settingsSchema、设置页）
- [x] 内置插件 `guidance-generate`、`reply-complete-sound` — **同上 §7**
- [ ] **`host.conversation` 对话读写 API**（单批 ≤50 轮、批处理写锁）— **`DOC/10-plugin-conversation-host.md`**
- [ ] 插件实例与 API 配置绑定
- [ ] 插件调用审计日志
- [ ] fallback 与健康检查策略

## P3（备忘 / 最低优先级）

> 来自实现与选型讨论，**不排期**；细节见 `DOC/03` **§14.10**。

- [ ] **Embedding MRL / 降维**：系统设置已支持 `embeddingDimensions`（留空=不传 OpenAI `dimensions`）；部分本地网关会忽略该参数仍返回满维。备选：换 TEI/vLLM 等支持 MRL 的推理端，或客户端截断前 N 维 + L2 归一化后入库。
- [ ] **Reranker 精排**：记忆/资料库当前仅 Lance 向量 TopK；API 层已预留 `rerank` capability，组装管线未接。TopK 较小时收益有限，资料库规模大时更值得做。
- [ ] **Qwen query instruct**：官方建议 query 侧加任务指令前缀（约 +1～5% 检索），索引与检索均未实现。

## 文档维护 TODO

- [x] 原独立草稿已合并至 `DOC/02`、`DOC/03`
- [ ] 每次架构决策变更后更新 `DOC/01-架构设计.md`
- [x] 每次需求变更后更新 `DOC/02-需求说明.md` — 2026-05-26 会话列表与角色库排序简述
- [x] 每次接口变更后更新 `DOC/03-实现细节.md`（**含 §12 角色库、index.json、PATCH、PNG、排序/导出**）— 2026-05-26 已同步 filterCounts、export-png/json、会话列表 UI
- [x] 插件系统与指导生成定案 — `DOC/09-plugin-system-and-guidance-generate.md`（2026-05-26）
- [x] 插件系统实现文档 — `DOC/09`、`plugins/README.md`、`data/README.md` §插件（2026-05-26）
