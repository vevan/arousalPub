# B-07 · 向量召回

完成本章后：选择内置或 OpenAI 兼容的 Embedding Provider，理解远期记忆 / 资料库向量大致怎么开，并知道何时「重建记忆索引」。

上一章：[B-06 · 正则替换入门](B-06-regex-rules.md) · 下一章：[C-01 · 数据在哪、怎么备份](C-01-data-and-backup.md) · [目录](00-menu.md) · [English](../EN/B-07-vector-recall.md)

---

## 这是什么

**向量召回**让系统用 Embedding 模型，从更早的对话、资料库条目或知识库文档里捞相关片段，再注入当前请求。

它与顶栏 **「连接」** 里的**聊天 API** 分开配置：聊天模型负责说话，Embedding 模型负责「找相关内容」。

不配 Embeddings 也能正常聊天；本章是可选增强。

---

## 全局配置入口

**设置 → 向量召回**。

### 1. 选择 Embedding Provider

有两种模式：

- **内置 Embedding**：固定使用 `Xenova/paraphrase-multilingual-MiniLM-L12-v2`，CPU、Q8、384 维。无需 Base URL 或 Key；先点击 **「准备模型」**，完成后再点 **「测试 Embedding」**。准备请求有短时间限流，请勿连续猛点。
- **OpenAI 兼容**：填写 Base URL、Key（可用别名）、Embedding 模型和模型要求的输出维度，再点击 **「测试 Embedding」**。

内置模型首次准备需要联网下载。Q8 权重在 Hugging Face 仓库中的实际文件名是 `onnx/model_quantized.onnx`，所以文件列表中不一定出现 `q8` 字样。模型固定到确定的 revision，准备完成后可从本地缓存推理。

默认缓存位置：

- Windows：`%LOCALAPPDATA%/ArousalPub/models`
- macOS：`~/Library/Caches/arousal-pub/models`
- Linux：`${XDG_CACHE_HOME:-~/.cache}/arousal-pub/models`

可用 `AROUSAL_TRANSFORMERS_CACHE_DIR` 指定其他目录。固定模型文件位于缓存目录下的 `Xenova/paraphrase-multilingual-MiniLM-L12-v2/<revision>/`，可提前把完整 revision 目录放到这里；必须至少包含配置、tokenizer 文件和 `onnx/model_quantized.onnx`。

### 2. Hybrid 全文检索分词（可选）

**Hybrid 全文检索分词**：中文 ngram（常见默认）/ English / 中文 jieba 等。  
**改过分词方式后，相关会话需要重建记忆索引**，否则索引不会被视为与当前设置一致。

### 3. 按需打开能力

| 区块 | 作用（概要） |
|------|----------|
| **远期记忆** | 从较早轮次召回相关内容；可调 TopK、权重等 |
| **资料库向量** | 启用资料库向量检索、向量触发 TopK 等 |
| **知识库 RAG** | 独立文档知识库的召回与切片参数（文档先在 [B-04 · 资产库](B-04-files-and-assets.md) 上传并加入知识库） |

新手建议：先只开 **远期记忆** 或只开 **资料库向量** 之一，确认 Embeddings 正常后再叠加。

---

## 本场对话里

打开一场对话 → **本对话设置 → 向量召回**：

- 可覆盖部分 TopK 等参数
- **重建记忆索引**：索引损坏、Embedding Provider/profile 改变、Hybrid 分词改变、索引元数据缺失，或提示需要重建时点这里
- **命中测试**：检查当前配置下召回是否合理

---

## 自检

- [ ] 「测试 Embedding」成功（若你打算用向量功能）。
- [ ] 使用内置 Provider 时，知道模型缓存位置以及 Q8 权重文件名是 `model_quantized.onnx`。
- [ ] 知道全局在 **设置 → 向量召回**，本场在 **本对话设置 → 向量召回**。
- [ ] 知道改分词或索引异常时要 **重建记忆索引**。

下一步（按需）：[C-01 · 数据在哪、怎么备份](C-01-data-and-backup.md)。
