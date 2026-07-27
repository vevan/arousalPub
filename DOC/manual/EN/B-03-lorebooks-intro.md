# B-03 · Lorebooks (world info) intro

After this chapter: you can create or import a lorebook and select which books inject into a chat.

Prev: [B-02 · Prompt presets intro](B-02-prompts-intro.md) · Next: [B-04 · Asset library (Files) intro](B-04-files-and-assets.md) · [Menu](00-menu.md) · [中文](../CN/B-03-lorebooks-intro.md)

---

## Concept

Lorebooks hold setting text that can inject into context by rules. Structure:

**Lorebook → group → entry**

Common entry triggers:

- **Constant injection**
- **Keyword trigger**
- **Vector trigger** (needs Embeddings; see [B-07](B-07-vector-recall.md))

---

## Open and edit

1. Top bar **Lorebooks**.
2. Select or create a lorebook.
3. Add entries under a group; fill keywords (if needed) and body text.

Toolbar also offers:

- **Import lorebook (append one)**
- **Export current lorebook (JSON)**

ST world-info migration: [D-02](D-03-from-sillytavern.md).

---

## Bind to a chat

### When creating

**New chat** form → **Bound lorebooks**: multi-select; UI may default-check “Default lorebook” — clear if you do not need it.

### Existing chat

**This chat settings → Bindings → Lorebooks**: check/reorder. Order affects merge priority feel; keep chatting after changes.

---

## Global-related settings (optional)

**Settings → Lorebook**: keyword recursion, depth, etc.  
Lorebook **vector TopK** and similar live under **Settings → Vector recall** ([B-07](B-07-vector-recall.md)).

---

## Checklist

- [ ] Opened Lorebooks and can see at least one book or know how to create one.
- [ ] Know lorebooks are checked under **This chat settings → Bindings**.

Next: [B-04 · Asset library (Files) intro](B-04-files-and-assets.md).
