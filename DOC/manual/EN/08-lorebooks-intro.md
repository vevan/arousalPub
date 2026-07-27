# 08 · Lorebooks (world info) intro

After this chapter: you can create or import a lorebook and select which books inject into a chat.

Prev: [07 · Prompt presets intro](07-prompts-intro.md) · Next: [09 · Asset library (Files) intro](09-files-and-assets.md) · [Menu](00-menu.md) · [中文](../CN/08-lorebooks-intro.md)

---

## Concept

Lorebooks hold setting text that can inject into context by rules. Structure:

**Lorebook → group → entry**

Common entry triggers:

- **Constant injection**
- **Keyword trigger**
- **Vector trigger** (needs Embeddings; see [11](11-vector-recall.md))

---

## Open and edit

1. Top bar **Lorebooks**.
2. Select or create a lorebook.
3. Add entries under a group; fill keywords (if needed) and body text.

Toolbar also offers:

- **Import lorebook (append one)**
- **Export current lorebook (JSON)**

ST world-info migration: [16](17-from-sillytavern.md).

---

## Bind to a chat

### When creating

**New chat** form → **Bound lorebooks**: multi-select; UI may default-check “Default lorebook” — clear if you do not need it.

### Existing chat

**This chat settings → Bindings → Lorebooks**: check/reorder. Order affects merge priority feel; keep chatting after changes.

---

## Global-related settings (optional)

**Settings → Lorebook**: keyword recursion, depth, etc.  
Lorebook **vector TopK** and similar live under **Settings → Vector recall** ([11](11-vector-recall.md)).

---

## Checklist

- [ ] Opened Lorebooks and can see at least one book or know how to create one.
- [ ] Know lorebooks are checked under **This chat settings → Bindings**.

Next: [09 · Asset library (Files) intro](09-files-and-assets.md).
