# 内置 Embedding（Transformers.js · 服务端）— 实现说明与后续计划

> **状态**：**M1 核心已落地**（Provider、固定 Q8 模型、profile 门禁、设置页与 Windows 实机推理已完成；下载进度与多平台性能矩阵待补）<br>
> **初次定案**：2026-07-30<br>
> **实现调研**：2026-08-11<br>
> **关联**：`DOC/devNotes/03` §1.2 / §14；`DOC/devNotes/05` §4–§5；`server/src/embedding-*`；memory / lorebook / knowledge 向量链路

---

## 1. 结论先行

M1 实现范围收敛为：

- 服务端引入 `@huggingface/transformers`，通过 `FeatureExtractionPipeline` 做本地推理；不增加浏览器推理路径。
- Provider 只需要两类：`openai_compatible`（现有云 API 与自建 OpenAI 兼容服务）和 `builtin`。本地 OpenAI 兼容服务只是不同 `baseUrl`，不单列第三种 Provider。
- 首版固定 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`、`q8`、CPU、384 维、mean pooling + L2 normalize；不开放模型、维度和设备自由配置。
- 单条与批量调用必须共用 Provider 分发层；不能只改 `createEmbedding()`，否则 memory / lorebook / knowledge 的批量重建仍会直接走 HTTP。
- 用统一的 **embedding profile** 标识向量空间；Provider / 模型 revision / dtype / pooling / normalize 任一变化都视为不兼容。
- Provider 切换后，旧索引在完成重建前必须由服务端停止参与向量召回；前端弹窗只负责引导，不能充当数据一致性门禁。
- 首次下载与重建拆开：先准备并测试模型，再启动既有 memory / lorebook / knowledge 重建流程；流式下载进度仍是后续项。
- GPU / DirectML / CUDA 等设备适配移到 M2；M1 只保证 Node.js CPU 路径。

### 1.1 2026-08-11 实施快照

已完成：

- 引入并锁定 `@huggingface/transformers@4.0.1`，模型 revision 固定为 `2c4055b12046f11709e9df2c122e59ffbdc2f900`。
- 增加 `openai_compatible | builtin` Provider 分流；单条与批量调用均接入内置 pipeline Promise 单例。
- builtin 固定 CPU / q8 / mean pooling / normalize / 384 维，默认机器级缓存，并支持 `AROUSAL_TRANSFORMERS_CACHE_DIR` 覆盖。
- memory、lorebook、knowledge 写入 embedding profile；三条召回路径均在服务端拒绝不兼容旧索引。
- 设置页增加 Provider 条件表单、模型状态、显式准备按钮和中英文文案；对话设置与发送前提示共用同一套 profile + Hybrid 分词一致性判定。
- Windows 实机已完成 Q8 冷启动下载、两条文本批量推理与缓存离线复用验证；输出均为 384 维有限数值。
- Transformers.js 4.0.1 的本地加载已改为显式 `AutoTokenizer` + `AutoModel` + `FeatureExtractionPipeline`，避免高层 `pipeline()` 在固定 revision 缓存布局下产生 `this.tokenizer is not a function`。
- 服务端完整测试 1023 项通过，类型检查、生产构建、宿主通用性门禁与 `npm audit` 均通过。

#### 1.1.1 2026-08-11 加固（审计闭环）

- **输入上限**：单条 `8000` 字符、批次总 `32000` 字符、批次最多 `16` 条；超限抛 `BuiltinEmbeddingInputError` → API `400` / `builtin_embedding_input_too_large`。
- **prepare 限流**：按用户 15s 窗口；`ready`/`preparing` 共享同一 Promise；超限 `429` / `embedding_prepare_rate_limited`。限流 Map 过期清理并硬顶条目数。
- **错误面**：`mapBuiltinEmbeddingError` 脱敏绝对路径（含 UNC、`/data/...`）；`GET/POST` status **不返回** `cacheDir`。
- **`POST /api/embedding/test`**：成功只回 `vectorPreview`（前 8 维）；失败 HTTP 状态跟随 `result.status`（400/429/502）。前端必须用 `apiFetch`。
- **单测**：`server/test/builtin-embedding.test.ts` 覆盖上限、限流、脱敏与错误码。

仍需完成：

- prepare 接口目前阻塞到模型可用后返回最终状态，尚未接 SSE 下载进度与取消。
- 补多平台吞吐/RSS 矩阵、更多下载损坏与不可写缓存故障注入测试，以及安全清理缓存入口。

---

## 2. 背景、目标与非目标

### 2.1 当前缺口

memory、世界书向量条目与知识库 RAG 目前都依赖 OpenAI 兼容 `POST .../embeddings`。没有云端密钥，也没有 Ollama、TEI、Infinity 等独立推理服务时，向量召回无法使用。

目标是在服务端进程内提供一条可选后路：用户显式选择 `builtin` 后，应用负责下载、缓存并运行固定 ONNX 模型；模型缓存完成后可以离线推理。

### 2.2 非目标

| 排除项 | 原因 |
|---|---|
| API 请求失败后静默切换到内置模型 | 会在同一索引中混入不同向量空间 |
| 浏览器 Transformers.js / WebGPU 主路径 | 索引和重建均在服务端，浏览器回传向量会引入额外状态机 |
| M1 自定义 Hugging Face model id / dimensions / pooling | 无法保证维度、提示格式与向量兼容性 |
| M1 GPU 加速 | Node 后端使用 `onnxruntime-node`，各平台 execution provider 能力不同，需独立验证与打包矩阵 |
| 自动后台全库重建 | 成本不可预测；继续由用户确认并复用现有 SSE 进度 |

---

## 3. 现有实现调查

### 3.1 当前配置与执行链

```text
user-preferences.embeddingApi
  ├─ baseUrl / apiKey / apiKeyId
  ├─ embeddingModel
  └─ embeddingDimensions
          │
          ▼
resolveEmbeddingApiCredentials(...)
          │
          ├─ createEmbedding(...) ────────────── 单条 HTTP POST /embeddings
          │
          └─ embedTextsInBatches(...) ───────── 批量 HTTP POST /embeddings
                         │
                         ├─ memory-index.ts
                         ├─ lorebook-vector-index.ts
                         └─ knowledge-vector-index.ts
```

关键文件：

| 位置 | 当前职责 | 内置 Provider 的影响 |
|---|---|---|
| `server/src/embedding-api-settings.ts` | API 设置与 normalize / merge | 增加 Provider；缺省值迁移为 `openai_compatible` |
| `server/src/embedding-credential-resolve.ts` | 把设置解析为 HTTP 凭据 | 改为解析判别联合，不能要求 `builtin` 提供 URL / key |
| `server/src/embedding-client.ts` | 单条 HTTP Embedding | 拆出 HTTP adapter；公共入口做 Provider 分发 |
| `server/src/embedding-batch.ts` | 批量 HTTP、切批和并发 | 保留批次编排，但批次执行交给 Provider；builtin 并发固定为 1 |
| `server/src/memory-index.ts` | 增量与全量 memory 索引 | 改用 effective profile；写入 profile 快照 |
| `server/src/lorebook-vector-index.ts` | 世界书向量索引 | 接统一 Provider；补 profile 元数据 |
| `server/src/knowledge-vector-index.ts` | 知识库向量索引 | 接统一 Provider；将现有 model / dimensions 升级为 profile |
| `server/src/{memory-pipeline,lorebook-resolve,knowledge-resolve}.ts` | 查询向量并召回 | 搜索前校验 profile，不兼容时跳过旧向量索引 |
| `server/src/routes/settings-routes.ts` | 保存设置与 `/api/embedding/test` | 支持 Provider；新增模型准备进度接口 |
| `web/src/utils/embedding-api-settings.ts` | 前端镜像类型 | 与服务端同步 Provider 字段和固定 builtin 信息 |
| `web/src/stores/preferences.ts` / `SettingsView.vue` | 设置、测试与持久化 | Provider 选择、下载状态、条件显示、重建提示 |

### 3.2 已有能力可直接复用

- `reindexConversationMemory()` 已有 `planning → collecting_turns → embedding_turns → writing_turns → embedding_lorebooks → finalizing` 进度。
- memory 索引已有 `memoryEmbeddingModel` / `memoryEmbeddingDimensions` 快照与前端重建提示。
- knowledge 元数据已有 `embeddingModel` / `embeddingDimensions`。
- `embedTextsInBatches()` 已有批次进度、维度一致性校验和有限并发。
- Lance IVF_PQ 当前使用 L2；对输出执行 L2 normalize 后，L2 排序与 cosine 排序保持等价，现有索引距离类型无需为 M1 改动。

### 3.3 现有缺陷与实现陷阱

1. `ResolvedEmbeddingCredentials` 是纯 HTTP 结构，Provider 分支无处表达。
2. 批量实现直接构造 HTTP 请求，仅在 `createEmbedding()` 分流会漏掉三个重建入口。
3. memory 重建末尾从全局设置读取 model / dimensions，而不是以本次实际 Provider 输出为唯一真相；需改为写入实际 `profile`。
4. 现有重建提示只在 Web 侧判断 model / dimensions；服务端查询路径仍可能拿新模型查询旧索引。
5. lorebook 索引缺少统一的 embedding profile 元数据，无法可靠判断是否兼容。
6. 当前 `/api/embedding/test` 假设一定存在 `requestUrl`；builtin 不应伪造 URL。
7. 对话级配置允许覆盖 model / dimensions；builtin 下继续允许该覆盖会形成不存在的配置组合。

---

## 4. Transformers.js 与模型调研

### 4.1 库能力

Transformers.js 支持在 Node.js 中运行 ONNX 模型；Node 环境使用 `onnxruntime-node`。`feature-extraction` pipeline 可直接接受字符串数组，并支持 `pooling: 'mean'` 与 `normalize: true`。首次构建 pipeline 会下载模型，后续从文件系统缓存加载；`progress_callback` 可用于上报模型构建和下载进度。

M1 采用普通 server dependency，并使用动态 `import('@huggingface/transformers')` 延迟加载。模型权重仍是按需下载，不随仓库或 Web bundle 发布。

**安装与构建**：

- `server/package.json` **精确锁定** `@huggingface/transformers@4.0.1`（勿改成 `^`）；传递依赖 `onnxruntime-node@1.24.3` 的 install script 已在根 `package.json` `allowScripts` 批准。另：`@lancedb/lancedb` 可选嵌套的 Transformers 3.x 会带 `onnxruntime-node@1.19.2`，亦已按版本批准，避免 `allow-scripts` 待审警告。
- `git pull` 后若 lock / `server/package.json` 有变，须经 `./start.sh` / `!_start.bat`（`ensure-deps`）或手动 `npm install` 装入；缺包时 `npm run build -w server` 的 `tsc` 会报 `TS2307: Cannot find module '@huggingface/transformers'`。

### 4.2 固定模型

| 项 | M1 定案 |
|---|---|
| Model id | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` |
| 原模型 | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` |
| 用途 | sentence / paragraph semantic search |
| 语言 | 50 languages，覆盖中文与英文场景 |
| 输出 | 384 维 |
| 最大序列 | 128 tokens；超长内容由 tokenizer 截断 |
| Pooling | mean |
| Normalize | `true`（L2 normalize） |
| Dtype | `q8` |
| 实际权重文件 | `onnx/model_quantized.onnx`；Transformers.js 的 `q8` 映射到该文件，仓库中不要求出现 `q8` 文件名 |
| 权重体积 | 量化 ONNX 约 118 MB；另有 tokenizer / config |
| License | Apache-2.0（原模型） |

选择它而不是 E5 系列的主要原因是：E5 对 query / passage 前缀有专门约定，而当前 `createEmbedding(text)` 没有表达 embedding purpose。该 MiniLM 模型可以在不先重构所有调用语义的前提下，用同一编码方式处理查询与语料。

实现时必须把模型 `revision` 固定到完整 commit hash；不能长期跟随 `main`。内部 profile id 不直接依赖展示名：

```text
builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1
```

### 4.3 缓存策略

- 支持环境变量 `AROUSAL_TRANSFORMERS_CACHE_DIR` 覆盖。
- 默认使用机器级缓存目录，不放进 `data/{userId}`、仓库目录或备份目录：
  - Windows：`%LOCALAPPDATA%/ArousalPub/models`
  - macOS：`~/Library/Caches/arousal-pub/models`
  - Linux：`${XDG_CACHE_HOME:-~/.cache}/arousal-pub/models`
- 启动时只配置 `env.cacheDir`，不加载 pipeline。
- 首次 prepare 允许联网下载；正常推理优先缓存。M1 不承诺“从未下载过也能离线”。
- 固定 revision 的实际目录为 `<cacheDir>/Xenova/paraphrase-multilingual-MiniLM-L12-v2/<revision>/`，其中包含 `config.json`、`tokenizer_config.json`、`tokenizer.json` 与 `onnx/model_quantized.onnx`。
- 状态接口提供是否已准备与脱敏后的错误摘要；**不向客户端暴露 cacheDir**。安全清除缓存入口仍是后续项。

---

## 5. 目标架构

### 5.1 设置模型

当前规范设置模型保留 `EmbeddingApiSettings` 名称：

```ts
type EmbeddingProvider = 'openai_compatible' | 'builtin'

interface EmbeddingApiSettings {
  provider: EmbeddingProvider
  baseUrl: string
  apiKey: string
  apiKeyId?: string | null
  embeddingModel: string
  embeddingDimensions: number | null
}
```

约束：

- 旧数据无 `provider` 时 normalize 为 `openai_compatible`，行为不变。
- `builtin` 的 effective model / dimensions 由服务端常量给出；同一设置对象中的 API model / dimensions 只属于 `openai_compatible` 模式，不得参与 builtin profile。
- Provider 是全局设置。对话级仍只允许 API 模式覆盖 model / dimensions；builtin 模式下对话 override 不生效，UI 禁用并解释原因。
- API 密钥序列化与脱敏逻辑保持不变；builtin 响应不包含、不需要密钥。

### 5.2 运行时判别联合

将 `ResolvedEmbeddingCredentials` 升级为 Provider 配置：

```ts
type ResolvedEmbeddingProvider =
  | {
      kind: 'openai_compatible'
      baseUrl: string
      apiKey: string
      model: string
      dimensions: number | null
      profile: string
    }
  | {
      kind: 'builtin'
      modelId: string
      revision: string
      dtype: 'q8'
      device: 'cpu'
      dimensions: 384
      profile: 'builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1'
    }
```

`profile` 是索引兼容性的唯一比较键；`model` 和 `dimensions` 仅用于展示与诊断。缺少端点指纹 profile 的旧 API 索引无法证明向量空间一致，必须重建，不能只凭同名模型和相同维度继续使用。

API profile 需包含规范化 API 端点的 64 位不可逆指纹、base model 身份、dimensions 和 profile schema 版本。这样同名模型位于不同服务时不会误用旧索引，同时**绝不**把 baseUrl、apiKey 或用户隐私写入 profile。例如：

```text
api:7d64310894a36c79:text-embedding-3-small:default:v2
api:7d64310894a36c79:text-embedding-3-small:1536:v2
```

### 5.3 当前实现入口

```text
server/src/embedding-credential-resolve.ts  # 设置 → effective Provider/profile
server/src/embedding-client.ts              # 单条 Provider 分发
server/src/embedding-batch.ts               # 批量 Provider 分发与分批
server/src/builtin-embedding.ts              # 固定模型、缓存、加载与推理
```

公共能力：

```ts
embedOne(provider, text): Promise<EmbeddingResult | EmbeddingRequestError>
embedMany(provider, items, options): Promise<EmbeddingBatchVectorsResult>
prepareBuiltinEmbedding(options): Promise<PrepareResult>
getBuiltinEmbeddingStatus(): Promise<BuiltinStatus>
```

### 5.4 builtin pipeline 生命周期

```text
首次 prepare / embed
  → dynamic import @huggingface/transformers
  → 设置 env.cacheDir
  → 检查固定 revision 目录所需文件
  → 缺文件时调用 pipeline(... revision/q8/cpu ...) 完成下载
  → 从固定 revision 本地目录显式加载 AutoTokenizer 与 AutoModel
  → new FeatureExtractionPipeline({ tokenizer, model })
  → 进程内 Promise 单例（并发首次加载只发生一次）
  → extractor(texts, { pooling: 'mean', normalize: true })
  → Tensor.tolist()
  → 校验条数、384 维、有限数值
  → Map<key, number[]>
```

并发规则：

- pipeline 初始化用共享 Promise 去重；失败后清除 Promise，允许用户重试。
- 下载完成后的推理只从固定 revision 本地目录装载，避免 Transformers.js 4.0.1 的高层 metadata 探测忽略固定缓存目录而构造空 tokenizer。
- builtin 推理使用单队列，M1 `concurrency=1`；批量输入上限先定 16，性能 spike 后可调。
- API Provider 继续使用当前最多 32 条 / 每批、最多 4 批并发。
- 批量输出必须检查条数、key、维度和有限值；任何批次失败则本次重建失败，不写半成品索引。

---

## 6. 索引一致性与切换契约

### 6.1 Profile 快照

新增或升级以下元数据：

| 索引 | 元数据 |
|---|---|
| memory | `memoryEmbeddingProfile`，保留现有 model / dimensions 展示字段 |
| knowledge | `embeddingProfile`，保留现有 model / dimensions |
| lorebook | 新增 per-lorebook vector manifest：profile、model、dimensions、完成时间 |

索引缺少 profile 时直接视为 stale 并要求重建。运行时不从 model / dimensions 猜测或迁移 profile，也不把缺失值猜成 builtin。

### 6.2 服务端召回门禁

每次向量召回前比较 active profile 与 index profile：

- 匹配：正常生成 query vector 并搜索。
- 不匹配 / 缺失：不搜索旧向量，不写入新向量；返回可观测的 `index_stale` 状态。
- memory：跳过远期记忆向量召回，近期 history 不受影响。
- lorebook：constant / keyword 继续工作，仅跳过 vector 条目。
- knowledge：该知识库跳过向量召回，并在命中测试 / 设置页显示需重建。

该门禁保证用户可以先保存 Provider，再选择何时重建，同时不会混用向量空间。

### 6.3 重建原子性

- memory 继续用 `replaceTurnMemoryIndex()` 的整表替换语义。
- knowledge 保持按知识库生成完整结果后再更新元数据。
- lorebook 补齐“向量写入完成后最后提交 manifest”；失败时旧 manifest 不改。
- 重建结果中的 model / dimensions / profile 必须来自本次 Provider 的实际结果，不能重读可能已变化的全局设置。
- 重建期间 Provider 再次变化时，用 profile epoch / snapshot 取消最终提交，避免旧任务覆盖新配置。

---

## 7. API 与 UI 流程

### 7.1 API

1. `PATCH /api/settings`：接受并校验 `embeddingApi.provider`。
2. `GET /api/settings`：返回 provider 与 builtin 固定描述（model、dimensions、dtype、device）。
3. `POST /api/embedding/test`：按 provider 分发；成功返回 `provider/model/dimensions/vectorPreview`（前 8 维，**不回全量 vector**）；`requestUrl` 仅 API 模式返回。失败 HTTP 状态跟随错误码（`400` 输入过大、`429` prepare 限流、其余多为 `502`）。
4. `GET /api/embedding/builtin/status`：返回 `not_prepared | preparing | ready | error`、model / profile / dimensions / dtype / device；错误信息脱敏。**不返回**本机 `cacheDir`。
5. `POST /api/embedding/builtin/prepare`：当前阻塞到准备完成后返回最终状态；按用户限流；SSE 进度与取消待实现。
6. 可选 `DELETE /api/embedding/builtin/cache` 放到 M1.1；必须确认无运行中任务并做精确目录保护。

### 7.2 设置页用户流程

```text
选择 Provider=builtin
  → 展示固定模型 / 384d / q8 / CPU / 缓存位置
  → “准备模型”
  → 等待准备结果
  → 短文本测试
  → 保存 Provider
  → 标记现有 memory / lorebook / knowledge 索引 stale
  → 用户确认重建
  → 复用现有重建 SSE；补充知识库批量重建入口/提示
```

UI 条件：

- `openai_compatible`：展示 baseUrl、key、model、dimensions 与 request URL。
- `builtin`：隐藏 baseUrl / key / model / dimensions 输入；展示只读模型信息与准备状态（不向 UI 暴露本机 cache 绝对路径）。
- 切换 Provider 前明确提示“现有向量索引将暂停召回，完成重建后恢复”。
- 首次下载失败需区分网络失败、缓存不可写、模型文件损坏和 runtime 不支持。
- 对话级 API 设置在 builtin 下显示“继承内置 Provider”，禁用 model / dimensions override。

---

## 8. 实施顺序

### M0 — 可行性 spike（不进产品路径）

- [x] 在项目 Node 24.14.0 环境安装候选 Transformers.js 版本，锁定可复现的 package 版本。
- [x] 固定模型完整 revision，代码路径锁定 `q8 + cpu + mean + normalize`。
- [x] 验证中文、英文、混合文本；输出严格为 384 维有限数值。
- [x] 验证数组输入、空文本处理和进程内重复调用；应用层硬上限（单条 8k / 批次 32k / 16 条）拒绝超限输入。
- [ ] 记录首次下载体积、冷启动时间、100 / 1000 条语料耗时和峰值 RSS。
- [ ] 验证 Windows / Linux；macOS 作为有环境时的补充矩阵。
- [x] builtin batch size 锁定为 16；后续性能矩阵用于评估是否调整。

**退出标准**：CPU 路径在支持平台稳定，固定 revision 可下载并从缓存离线复用；否则停止 M1，不先做 UI。

### M1-A — Provider 核心

- [x] `provider` 设置字段、前后端共享 normalize。
- [x] Provider 判别联合与稳定 profile 生成器。
- [x] 现有 HTTP 单条 / 批量路径保留为 `openai_compatible` 分支，回归行为不变。
- [x] 实现 builtin pipeline Promise 单例、机器级 cache、q8 CPU 推理与维度校验。
- [x] 单条 / 批量统一分发；三个批量索引入口不再自行决定 HTTP 调用。
- [x] 测试 endpoint 支持两类 Provider。

**退出标准**：无 Embedding API 配置时，已缓存模型可完成单条和批量推理；API Provider 全部旧测试通过。

### M1-B — 索引一致性

- [x] 新增 profile 快照；缺失或不匹配一律 stale。
- [x] memory / lorebook / knowledge 写入实际 profile。
- [x] 三条召回路径增加服务端 stale gate。
- [x] memory 重建任务捕获 profile snapshot；配置变化时停止后续索引提交。
- [x] Provider、模型、维度或 builtin profile 版本变化均触发 stale。

**退出标准**：任何 Provider 切换都不能用新 query vector 搜索旧索引，也不能产生混合写入。

### M1-C — 下载、设置与重建 UX

- [x] 状态 API 与阻塞式 prepare API；失败后可重试。
- [ ] prepare SSE 下载进度与取消。
- [x] 全局 Provider 选择与条件表单。
- [x] builtin 模式忽略对话级模型 / 维度 override。
- [x] Provider 切换纳入 memory stale 判断和重建入口。
- [ ] 复用 memory 重建进度；确认 lorebook / knowledge 的重建入口均可达。
- [x] i18n 中英文文案与用户手册使用/缓存说明。

**退出标准**：新用户可只通过 UI 完成“选择 builtin → 下载 → 测试 → 重建 → 召回”。

### M2 — 可选设备加速（不阻塞 P1 关闭）

- [ ] 按 OS / arch 构建设备能力探测矩阵，不展示未经验证的设备。
- [ ] 分别验证 CUDA / DirectML / CoreML 等 execution provider 的依赖、打包和回退。
- [ ] `auto` 只在可观测失败后回退 CPU，并记录实际使用设备。
- [ ] 设备或 dtype 改变时生成不同 profile，要求重建。

---

## 9. 测试与验收矩阵

### 9.1 单元测试

- [x] Provider 设置规范化与枚举校验。
- [x] builtin 忽略 API URL / key / model / dimensions，effective dimensions 固定 384。
- [x] profile 不包含密钥 / URL，API 与 builtin 使用不同命名空间。
- [x] pipeline 首次加载并发去重、失败可重试。
- [x] builtin 批量输出条数、维度与 NaN 防御。
- [ ] API adapter 保持当前请求 body、dimensions 与错误格式。
- [x] 测试注入 fake builtin backend，CI 不下载模型。

### 9.2 集成测试

- [ ] memory 增量 upsert 与全量重建均可走 builtin。
- [ ] lorebook、knowledge 批量索引均可走 builtin。
- [ ] API → builtin、builtin → API、builtin profile 版本变化均进入 stale。
- [ ] stale 时 memory / lorebook / knowledge 按 §6.2 降级，不触碰旧向量。
- [ ] 重建中切换 Provider，不提交过期任务结果。
- [x] 固定 revision 模型已缓存时可从本地文件完成推理。
- [ ] 缓存不可写、下载中断、损坏文件、进程重启后均有明确错误与恢复路径。

### 9.3 P1 关闭条件

- [ ] 无外部 Embedding API，builtin 可完成 memory、世界书向量与知识库的索引和召回。
- [ ] 首次模型准备有进度，缓存后可离线推理。
- [ ] CPU 是所有支持平台的可靠保底；没有 GPU 也可完成小中规模重建。
- [ ] Provider 切换不会混用向量空间，服务端门禁有测试覆盖。
- [ ] 现有 OpenAI 兼容 Provider 无行为回归。
- [x] 文档包含模型许可、缓存位置、下载体积预期与隐私说明；安全清理入口待补。

---

## 10. 风险与应对

| 风险 | 应对 |
|---|---|
| 首次下载较大或 Hugging Face 不可达 | prepare 独立于保存；支持 cacheDir 覆盖和后续本地预置说明 |
| 服务器 CPU 重建慢 / 占内存 | q8、单推理队列、有限 batch、复用进度与取消机制 |
| Transformer.js / ONNX 原生依赖平台差异 | 以 Node 24.14.0 验证平台矩阵；M1 不承诺 GPU |
| 上游模型 `main` 变化导致向量漂移 | package 与 model revision 都锁定；profile 带 schema 版本 |
| 同维模型被误认为兼容 | 比较 profile，不只比较 dimensions |
| 索引缺少 profile 元数据 | 一律 stale，并引导用户显式重建 |
| 数据目录被备份导致权重膨胀 | 默认机器级缓存，明确排除 `data/` |

---

## 11. 调研依据

- [Transformers.js pipeline API](https://huggingface.co/docs/transformers.js/en/pipelines)：首次下载与缓存、数组输入、revision 与 dtype。
- [Transformers.js environment API](https://huggingface.co/docs/transformers.js/api/env)：`cacheDir`、本地 / 远程模型控制。
- [Transformers.js hub options](https://huggingface.co/docs/transformers.js/api/utils/hub)：`progress_callback`、`revision`、`local_files_only`。
- [Transformers.js ONNX backend](https://huggingface.co/docs/transformers.js/api/backends/onnx)：Node.js 使用 `onnxruntime-node`。
- [Transformers.js feature-extraction 示例](https://huggingface.co/docs/transformers.js/en/guides/webgpu)：数组输入、mean pooling 与 normalize 的调用形态；该页面的 WebGPU 示例不代表 M1 服务端设备承诺。
- [原模型卡](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)：50 languages、384 维、mean pooling、128 token、Apache-2.0。
- [Transformers.js ONNX 转换仓库](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)：可由 Transformers.js 加载。
- [ONNX 权重目录](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/main/onnx)：q8 / int8 权重约 118 MB。

---

## 12. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-07-30 | 初稿定案：服务端 Transformers.js 作为无外部 Embedding 服务时的后路 |
| 2026-08-11 | 完成现有代码链路与官方能力调研；锁定 M1 CPU / q8 / 384d 固定模型方案；补齐 Provider 抽象、profile 门禁、缓存、API、逐阶段实施与验收计划 |
| 2026-08-11 | 开始 M1 实施：完成 Provider 核心、三类索引 profile 门禁、设置页首版、相关测试与构建 |
| 2026-08-11 | 完成 Windows Q8 实机推理与固定 revision 离线缓存验证；修正 Transformers.js 4.0.1 tokenizer 装载；统一 profile + Hybrid 重建判定，并补齐中英文用户文档 |
