# B-07 · Vector recall

After this chapter: Embeddings API is configured, you roughly know how to enable long-term memory / lorebook vectors, and when to **Rebuild memory index**.

Prev: [B-06 · Regex rules intro](B-06-regex-rules.md) · Next: [C-01 · Where data lives and how to back up](C-01-data-and-backup.md) · [Menu](00-menu.md) · [中文](../CN/B-07-vector-recall.md)

---

## What it is

**Vector recall** uses an embedding model to pull relevant snippets from earlier turns, lorebook entries, or knowledge-base documents into the current request.

It is configured separately from the **chat API** in top-bar **Connection**: the chat model talks; the embedding model finds related content.

You can chat without Embeddings; this chapter is an optional upgrade.

---

## Global config

**Settings → Vector recall**.

### 1. Configure Embeddings API first

Fill in:

- Base URL
- Key (alias allowed)
- **Embedding model**
- Output dimensions (per model)

Click **Test Embedding** and confirm success.

### 2. Hybrid full-text tokenization (optional)

**Hybrid full-text tokenization**: Chinese ngram (common default) / English / Chinese jieba, etc.  
**After changing tokenization, related chats usually need a rebuilt memory index**, or retrieval may not match expectations.

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
- **Rebuild memory index**: when the index is corrupt, tokenization changed, or the UI asks you to rebuild
- **Hit test**: check whether recall looks reasonable under current settings

---

## Checklist

- [ ] **Test Embedding** succeeded (if you plan to use vectors).
- [ ] Know global is **Settings → Vector recall**, per-chat is **This chat settings → Vector recall**.
- [ ] Know to **Rebuild memory index** after tokenization changes or index errors.

Next (as needed): [C-01 · Where data lives and how to back up](C-01-data-and-backup.md).
