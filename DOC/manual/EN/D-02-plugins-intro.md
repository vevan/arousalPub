# D-02 · Plugins and extensions intro

After this chapter: you know where to enable plugins and open runtime panels; this is not about writing plugin code.

Prev: [D-01 · Group chat and branches intro](D-01-group-and-branches.md) · Next: [D-03 · Migrating from SillyTavern](D-03-from-sillytavern.md) · [Menu](00-menu.md) · [中文](../CN/D-02-plugins-intro.md)

---

## What plugins do

Bundled or installed plugins add capabilities in the chat pipeline (summaries, traces, assistive generation, etc.). The host only provides a generic shell; each plugin’s own settings define behavior.

If the list is empty, the UI may say no plugins are installed — depends on your install.

---

## Global: enable and configure

1. Top-bar gear → **Settings → Plugins**.
2. Toggle **Enable** for a plugin.
3. Drag to reorder hooks if needed.
4. Open that plugin’s **Settings** form.

The settings page may also offer plugin config **Import / Export** (session overrides and secrets may be excluded — follow the UI).

---

## In a chat

- Left/right **plugin extension panels** on the chat page (footer may have a **Plugins** button).
- **This chat settings → Plugins**: override global defaults for this chat only.

After install and enable, bundled plugins usually appear in the list; if not, check **Settings → Plugins**.

---

## Beginner tips

1. Finish the required path and stable chatting first.
2. Enable one plugin at a time; confirm behavior before the next.
3. Developer docs live in `DOC/devNotes/` — **out of scope** here. Per-plugin usage: [D-05 · Bundled plugins guide](D-05-bundled-plugins.md).

---

## Checklist

- [ ] Opened **Settings → Plugins**.
- [ ] Know chats have plugin panels / per-chat overrides.

Next: [D-03 · Migrating from SillyTavern](D-03-from-sillytavern.md).
