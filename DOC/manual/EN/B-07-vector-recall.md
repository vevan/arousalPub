# B-07 · Vector recall

After this chapter: you can choose the built-in or OpenAI-compatible embedding provider, roughly know how to enable long-term memory / lorebook vectors, and know when to **Rebuild memory index**.

Prev: [B-06 · Regex rules intro](B-06-regex-rules.md) · Next: [C-01 · Where data lives and how to back up](C-01-data-and-backup.md) · [Menu](00-menu.md) · [中文](../CN/B-07-vector-recall.md)

---

## What it is

**Vector recall** uses an embedding model to pull relevant snippets from earlier turns, lorebook entries, or knowledge-base documents into the current request.

It is configured separately from the **chat API** in top-bar **Connection**: the chat model talks; the embedding model finds related content.

You can chat without Embeddings; this chapter is an optional upgrade.

---

## Global config

**Settings → Vector recall**.

### 1. Choose an embedding provider

Two modes are available:

- **Built-in Embedding**: fixed to `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, CPU, Q8, and 384 dimensions. No Base URL or key is needed. Click **Prepare model**, then **Test Embedding**. Prepare is rate-limited; avoid rapid repeated clicks.
- **OpenAI-compatible**: enter the Base URL, key (alias allowed), embedding model, and the model's output dimensions, then click **Test Embedding**.

The first built-in preparation needs network access. The Q8 weight is named `onnx/model_quantized.onnx` in the Hugging Face repository, so the file list does not need to contain `q8`. The model is pinned to a specific revision and can run from the local cache after preparation.

Default cache locations:

- Windows: `%LOCALAPPDATA%/ArousalPub/models`
- macOS: `~/Library/Caches/arousal-pub/models`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/arousal-pub/models`

Set `AROUSAL_TRANSFORMERS_CACHE_DIR` to use another directory. The pinned files live under `Xenova/paraphrase-multilingual-MiniLM-L12-v2/<revision>/` inside the cache. You may pre-populate that complete revision directory; it must include the config, tokenizer files, and `onnx/model_quantized.onnx`.

### 2. Hybrid full-text tokenization (optional)

**Hybrid full-text tokenization**: Chinese ngram (common default) / English / Chinese jieba, etc.  
**After changing tokenization, related chats need a rebuilt memory index**, or the index will not match the active settings.

### 3. Enable capabilities as needed

| Block | Role (summary) |
|------|----------|
| **Long-term memory** | Recall from earlier turns; TopK, weights, etc. |
| **Lorebook vectors** | Enable lorebook vector search, vector-trigger TopK, etc. |
| **Knowledge RAG** | Independent document KB recall and chunk settings (upload docs via [B-04 · Asset library](B-04-files-and-assets.md) first) |

Beginner tip: enable only **long-term memory** or only **lorebook vectors** first; stack more after Embeddings works.

---

## In this chat

Open a chat → **This chat settings → Vector recall**:

- Override some TopK values, etc.
- **Rebuild memory index**: when the index is corrupt, the embedding provider/profile changed, Hybrid tokenization changed, index metadata is missing, or the UI asks you to rebuild
- **Hit test**: check whether recall looks reasonable under current settings

---

## Checklist

- [ ] **Test Embedding** succeeded (if you plan to use vectors).
- [ ] When using the built-in provider, know the model cache location and that the Q8 weight is named `model_quantized.onnx`.
- [ ] Know global is **Settings → Vector recall**, per-chat is **This chat settings → Vector recall**.
- [ ] Know to **Rebuild memory index** after tokenization changes or index errors.

Next (as needed): [C-01 · Where data lives and how to back up](C-01-data-and-backup.md).
