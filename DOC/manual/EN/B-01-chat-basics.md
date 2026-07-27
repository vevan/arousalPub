# B-01 · Common chat actions

After this chapter: you can regenerate, browse swipe versions, and change characters or lorebooks in **This chat settings**.

Prev: [A-05 · Start your first chat](A-05-first-chat.md) · Next: [B-02 · Prompt presets intro](B-02-prompts-intro.md) · [Menu](00-menu.md) · [中文](../CN/B-01-chat-basics.md)

---

## Regenerate

On an assistant message, use **Regenerate** (shortcut often **R**).

The app requests another reply; older versions are usually still reachable via swipe (below).

---

## Swipe (multiple versions)

Beside an assistant message you can switch:

- **Previous assistant reply**
- **Next assistant reply or regenerate**

The UI shows something like **“{current} of {total}”**. Useful for comparing several generations for the same user turn.

---

## This chat settings

On the chat page top bar, open the **gear** → **This chat settings**.

### Bindings tab (most used)

| Item | Role |
|------|------|
| **Prompt preset** | Which prompt set this chat uses; can **Follow global current preset** |
| **User / other characters** | Rebind character cards |
| **Lorebooks** | Which world-info books inject here (multi-select; order affects merge) |
| **Knowledge bases** | Document RAG (upload files first; see [B-04](B-04-files-and-assets.md)) |
| **Background / BGM** | Pick image/audio from the asset library (see [B-04](B-04-files-and-assets.md)) |

Changes apply as you continue chatting — no need to recreate the conversation. Upload files under top-bar **Files**, not in this panel.

### Other tabs (know the entry points)

- **Vector recall**: per-chat overrides and **Rebuild memory index** (see [B-07](B-07-vector-recall.md))
- **Regex batch**: re-apply **persist** rules to history (rules themselves live under Settings — [B-06](B-06-regex-rules.md))
- **Plugins**: per-chat override of global defaults (see [D-02](D-02-plugins-intro.md))
- **Group chat**: when you have multiple characters — [D-01](D-01-group-and-branches.md)

---

## Checklist

- [ ] Tried **Regenerate** or swipe on an assistant reply.
- [ ] Opened **This chat settings → Bindings** and know characters/lorebooks change there.

Next: [B-02 · Prompt presets intro](B-02-prompts-intro.md).
