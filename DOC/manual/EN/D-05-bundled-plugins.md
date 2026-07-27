# D-05 · Bundled plugins guide

After this chapter: you know what each of the seven shipped plugins does, how to enable them, and where to click in a chat.

Prev: [D-04 · Session debug audit](D-04-session-debug-audit.md) · Next: [D-06 · Troubleshooting](D-06-troubleshooting.md) · [Menu](00-menu.md) · [中文](../CN/D-05-bundled-plugins.md)

Generic plugin entry points (enable, order, import/export) are in [D-02 · Plugins and extensions intro](D-02-plugins-intro.md). This chapter covers **first-party (bundled) plugins** only.

---

## Shared steps

1. **Settings → Plugins**: toggle plugins on; open **Settings** on complex ones for API presets, etc.
2. In a chat: most plugins show buttons on the **composer toolbar** or under **user/assistant messages**.
3. Per-chat overrides: **This chat settings → Plugins** (where supported).

Enable one unfamiliar plugin at a time before stacking others.

---

## Historian (`plot-summary`)

**Role**: Summarize a span of chat into **lorebook entries** for long-plot memory.

| Where | What |
|--------|------|
| Composer toolbar | Manual summarize, pick turn range, toggle **auto summarize**, session settings |
| **This chat settings → Plugins** | Target lorebook, auto summarize, block size, etc. |
| Composer slash | `/plot`, `/plot summary 99-150`, etc. (see in-app hint) |

**Typical flow**:

1. **Settings → Plugins → Historian**: API preset, default “every N turns”, etc.
2. Open a chat → toolbar **session Historian settings** → pick **summary lorebook** (not the same as lorebooks checked for injection under Bindings).
3. After some chat, run **manual summarize**, or enable **auto summarize** (may still ask you to preview before write).

Summaries land in a lorebook; to **inject** them, also check that book under **Bindings → Lorebooks** ([B-03](B-03-lorebooks-intro.md)).

---

## Trace Keeper (`trace-keeper`)

**Role**: Maintain structured scene state (location, time, mood JSON) and show it in the **left plugin panel**.

| Where | What |
|--------|------|
| Assistant area / left **Trace Keeper** tab | View tracker, **Regenerate tracker (Separate)**, edit JSON |
| **Settings → Plugins → Trace Keeper** | Default bundle, Separate API, injection order, templates/CSS |
| **This chat settings → Plugins** | Per-chat bundle, Separate window turns |

**Typical flow**:

1. Enable and set **API preset** for Separate regeneration.
2. Chat normally; if the model appends `<ex-trace-keeper>{JSON}</ex-trace-keeper>`, the panel renders.
3. If missing, use **Regenerate tracker (Separate)** in the panel.

---

## Guidance generate (`guidance-generate`)

**Role**: **Send** with hidden guidance (not shown in bubbles), **regenerate/revise** assistant text from guidance, or **polish** user input on the Polish tab.

| Where | What |
|--------|------|
| Composer toolbar **Guidance generate** | Dialog: **Generate** (guided send) or **Polish** |
| Under assistant messages | **Guidance revise** (rewrite current reply from guidance) |

**Typical flow**:

1. Enable (optionally edit system prefixes under **Settings → Plugins**).
2. Toolbar icon → fill visible user text + **hidden guidance** → guided send.
3. For a weak reply, use **Guidance revise** instead of plain Regenerate.

---

## Conversation export (`conversation-export`)

**Role**: Export the chat as offline **HTML**.

| Where | What |
|--------|------|
| Composer toolbar **Export chat as HTML** | All turns or a range → download |

Under **Settings → Plugins → Conversation export**: reasoning, meta, avatars, custom CSS. Avoid sending messages during export.

---

## Swipe cleaner (`swipe-cleaner`)

**Role**: Delete extra swipe candidates and keep only the currently shown reply per turn.

| Where | What |
|--------|------|
| Under assistant messages | **Clean other swipes for this turn** |
| Composer toolbar | **Clean all swipes in this chat** |

**Irreversible** — confirm the visible swipe is the one you want to keep.

---

## Reply complete sound (`reply-complete-sound`)

**Role**: Play a sound when assistant **streaming finishes**.

| Where | What |
|--------|------|
| **Settings → Plugins → Reply complete sound** | Default/custom MP3·WAV, volume, repeat count |

No chat button; applies on the next completed reply. Use **Preview sound** to check volume.

---

## Custom styles (`custom-styles`)

**Role**: Inject custom **CSS** into the chat page.

| Where | What |
|--------|------|
| **Settings → Plugins → Custom styles** | Multiple stylesheets, global toggle |
| **This chat settings → Plugins** | Inherit/on/off per chat, per-sheet overrides |

After editing CSS, **refresh or re-enter the chat**. Custom CSS is at your own risk for readability.

---

## Checklist

- [ ] Enabled at least one bundled plugin and opened its settings.
- [ ] Know toolbar plugin buttons vs **This chat settings → Plugins**.
- [ ] If using Historian, can explain “write to lorebook” vs “bind lorebook for injection”.

Last chapter: [D-06 · Troubleshooting](D-06-troubleshooting.md).
