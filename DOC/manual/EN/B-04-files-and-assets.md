# B-04 · Asset library (Files) intro

After this chapter: you can upload images/audio/documents via top-bar **Files**, set chat background and BGM, and know how documents enter knowledge bases.

Prev: [B-03 · Lorebooks (world info) intro](B-03-lorebooks-intro.md) · Next: [B-05 · Settings tour](B-05-settings-tour.md) · [Menu](00-menu.md) · [中文](../CN/B-04-files-and-assets.md)

---

## What it is

Top-bar **Files** opens a shared **media and document cabinet**:

| Tab | Purpose |
|-----|------|
| **Asset library** | Upload, preview, and manage images / documents / audio / video |
| **Knowledge bases** | Group uploaded **documents** for chunking and vector recall (needs Embeddings; see [B-07](B-07-vector-recall.md)) |

This is **not** lorebooks (world info). Lorebooks are hand-written entries; the asset library holds file binaries. They do not replace each other.

There are **no folders**: use **type filters** (All / Images / Documents / Audio / Video) plus **tags / search**.

---

## Open and upload

1. Top bar **Files**.
2. Stay on the **Asset library** tab.
3. Click **Upload** (multi-select OK: images, txt/md/json/pdf, common audio/video).
4. Select a file in the grid; the side panel can preview, **Rename**, **Edit tags**, **Copy URL**, **Update** (replace content, keep the same entry), or **Delete**.

**Content URL** (`/api/m/…`) can be used directly in bubble images, etc. If something references the file, delete may offer **Clear refs & delete** — backgrounds, BGM, character bindings, and knowledge bases may be affected.

---

## Workflow A: Chat background

1. Upload an **image** in the asset library.
2. Open a chat → **This chat settings → Bindings → Chat background**.
3. **Pick from library** (or **Change** / **Clear**).

---

## Workflow B: Chat BGM

1. Upload **audio**.
2. **This chat settings → Bindings → Chat BGM** → pick from library.
3. In the chat, music loops; the top bar can **Mute BGM** / **Unmute BGM**.

---

## Workflow C: Bind files to a character (optional)

1. Upload first in **Files → Asset library** (the character page cannot upload).
2. Top bar **Characters** → select a card → **Asset library bindings** → **Bind from library**.
3. There is a limit (UI shows it; often up to 30).

Advanced users can reference bound files via prompt macros; beginners can stop at bind + preview.

---

## Workflow D: Documents → knowledge base (overview)

1. Upload a **document** in the asset library (prefer `.txt` / `.md`; PDF can be stored, but RAG chunking support is limited).
2. Switch to the **Knowledge bases** tab in the same modal: create a base → **Add documents** → **Rebuild index** when needed.
3. **This chat settings → Bindings → Knowledge bases** — check which bases participate in recall.

Global Embeddings and knowledge RAG toggles live under **Settings → Vector recall** ([B-07 · Vector recall](B-07-vector-recall.md)). Without Embeddings you can still manage files; document recall will not work.

---

## vs the Bindings tab

| This chat settings → Bindings | Where files come from |
|-------------------------------|------------------------|
| **Chat background** / **Chat BGM** | Images / audio in the asset library |
| **Knowledge bases** | Documents → Knowledge bases tab → then check here |
| **Lorebooks** | World info ([B-03](B-03-lorebooks-intro.md)), not via the asset library |

---

## Checklist

- [ ] Top-bar **Files** opens and you uploaded at least one file to **Asset library**.
- [ ] You set a chat background or BGM (or at least opened the picker).
- [ ] You know **Knowledge bases** is not the same as **Lorebooks**.

Next: [B-05 · Settings tour](B-05-settings-tour.md).
