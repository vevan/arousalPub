# 内置 Embedding（Transformers.js · 服务端）— 设计定案

> **状态**：设计定案，**未实现**（**P1**，见 `DOC/devNotes/04-TODO.md`）。  
> **定案日期**：2026-07-30  
> **关联**：`DOC/devNotes/03` §1.2 Embedding · §14 memory / lore vector / knowledge；`DOC/devNotes/05` §4–§5；`embedding-client.ts` / `embedding-credential-resolve.ts`。

---

## 1. 背景与目标

### 1.1 现状

- memory / lore vector / knowledge RAG 共用 **OpenAI 兼容** `POST …/embeddings`（全局 `user-preferences.embeddingApi`，对话可稀疏覆盖 model/dimensions）。
- 索引在 **服务端 LanceDB**；换模型或维度须 **重建**（已有快照与重建弹窗）。

### 1.2 缺口

部分用户 **没有本地 LLM / 独立 Embedding 服务条件**（不会或不愿装 Ollama、TEI、Infinity 等），也不想或无法配置云 Embedding API。  
需要一条 **应用内自带的后路**：打开服务端即可向量召回，**不**再要求外部推理进程。

### 1.3 非目标（明确排除）

| 排除 | 说明 |
|------|------|
| **请求级热备 / 静默 failover** | 云 API 失败后自动切内置会混用向量空间，禁止 |
| **浏览器 Transformers.js + WebGPU 作主路径** | 索引与重建在服务端；浏览器算向量再回传增加状态机与大语料重建成本 |
| **与云端模型混索引** | 内置与 API 为不同空间；切换 Provider **必须**全量重建相关索引 |

---

## 2. 定案摘要

| 项 | 定案 |
|----|------|
| **形态** | Embedding **Provider 三选一（或等价）**：`api`（云/自建 OpenAI 兼容）· `openai_compatible_local`（用户自指 baseUrl，已可用）· **`builtin`（后路）** |
| **实现位置** | **仅服务端**；`@huggingface/transformers`（Transformers.js）+ ONNX Runtime |
| **加速** | 默认 **CPU** 保底；可选 `webgpu` / `cuda` / `dml` / `coreml`（视平台与 runtime）；`auto` 须失败回退 CPU，不可硬绑 CUDA |
| **模型** | 固定一小体积多语或英文 embedding ONNX（实现时锁定具体 id + 维度）；禁止用户随便改维度导致静默混库 |
| **切换契约** | 切到 / 切离 `builtin` → 与改 embedding 模型相同：**强制提示重建** memory（及绑定 lore / knowledge） |
| **默认** | 新产品默认仍引导配置 API；`builtin` 放在设置「向量召回 → Embeddings」的显式选项与「无法配置 API 时」引导 |
| **质量预期** | 文案写清：弱于大型云 embedding；适合后路与小中规模语料 |

---

## 3. 架构要点

```
createEmbedding / embedTextsInBatches
        │
        ├─ provider=api | openai_compatible → 现有 embedding-client（HTTP）
        │
        └─ provider=builtin → transformers.js feature-extraction
                                      → Float32Array → number[]
                                      → 写入既有 Lance 路径（不变）
```

- **接口**：对上保持 `EmbeddingResult { vector, model }`；`model` 戳记用内置稳定名（如 `builtin:<hf-model-id>`），写入既有 `memoryEmbeddingModel` 等快照字段。
- **加载**：进程内懒加载 + 磁盘缓存模型文件（目录可定在 `data/` 外或用户级 cache；实现时写清，避免 Syncthing 误同步巨型权重若放在用户数据下——优先机器级 cache）。
- **并发**：与现有 `embedTextsInBatches` 批处理对齐；CPU 上限制并行，避免 OOM。
- **可选依赖**：体积大时可用 optionalDependency / 单独安装说明，避免强迫所有部署拉满 ORT；定案实现时二选一并写进 README。

---

## 4. UI / 设置（规划）

- 全局 **向量召回 → Embeddings**：Provider 选择；`builtin` 时隐藏或禁用无关的 baseUrl/apiKey，展示固定模型名、维度、设备（auto/cpu/webgpu/…）。
- 首次选 `builtin`：说明首次下载模型与索引重建耗时；复用现有 rebuild SSE / 进度条。
- 对话级：仍只允许稀疏覆盖「与当前 Provider 相容」的参数；`builtin` 下对话不得另指云 gateway（与 §1.2「禁止对话内独立网关」一致）。

---

## 5. 验收清单（实现时）

- [ ] `provider=builtin` 时无外网 Embedding API 亦可完成 memory 召回（模型已缓存前提下可离线推理）
- [ ] 切换 Provider 触发与改模型一致的重建门禁；禁止混用旧 Lance 向量
- [ ] CPU 路径在无 GPU 机器可完成小会话重建
- [ ] 有 GPU 时可选加速；加速失败回退 CPU 并日志可见
- [ ] 单测：mock / 小型 fixture 向量维度与 `createEmbedding` 契约（避免 CI 下载大模型；可用 stub provider 测路由）

---

## 6. 实现分期（建议）

| 阶段 | 内容 |
|------|------|
| **M1** | Provider 枚举 + `builtin` CPU + 固定模型 + 重建契约 + 设置 UI |
| **M2** | 设备选择（auto/webgpu/cuda/dml…）与失败回退 |
| **M3** | 文档 / README「无 Embedding API 时用内置」引导；可选依赖安装说明 |

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-30 | 初稿定案：服务端 Transformers.js 作无本地 LLM 条件用户的 Embedding 后路；非热备、非浏览器主路径 |
