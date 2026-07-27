# 17 · Session debug audit

After this chapter: you can turn audit on, inspect a turn’s prompts, assembly hits, and performance after send/regenerate, and you know how **Preview** relates to on-disk audit files.

Prev: [16 · Migrating from SillyTavern](16-from-sillytavern.md) · Next: [18 · Bundled plugins guide](18-bundled-plugins.md) · [Menu](00-menu.md) · [中文](../CN/17-session-debug-audit.md)

---

## What it is

**Session debug audit** writes a snapshot to that conversation’s `chat-audit.json` after each successful **send** or **regenerate**, including:

- **Prompts** (messages) actually sent to the model
- **Assembly hits** (lorebooks, memory, knowledge bases, history, budget trim, etc.)
- **Group chat** speaker selection (when applicable)
- **Outbound API** call summary
- **Performance** timings (assembly, upstream, persist, etc.)

Use it when replies look wrong, you want to verify lorebook injection, or you debug group-chat picking. Optional for everyday chatting.

---

## Step 1: Enable globally

1. Top-bar **gear** → **Settings**.
2. Left nav **Debug**.
3. Turn on **Enable session debug audit**.
4. (Optional) Set **Max stored audit entries** (1–200). Opening a chat syncs this to that conversation’s `auditDebug` (enabled + maxStored).

When off: **no new** entries are written. Older saved entries remain on disk, but the assistant **Audit** button only shows while the global toggle is **on**.

---

## Step 2: Generate an entry

1. Open any chat.
2. **Send** a message or **Regenerate** an assistant reply.
3. After persist succeeds, that turn gets an audit record.

If there is no **Audit** button on the assistant message, recheck **Settings → Debug** and refresh the page.

---

## Step 3: View a turn

On an **assistant message** toolbar, click **Audit** (document icon) to open **Debug audit for this turn**.

Header shows turn ordinal, saved time, `turnId`, chunk file, etc. Tabs:

| Tab | Contents |
|-----|----------|
| **Messages** | Message list sent to the model; **Copy messages** / **Copy raw JSON** |
| **Assembly** | Token estimates, budget trim, plugin reserves, memory/lore/knowledge/history hits |
| **Group chat** | Segment/next picks, dice table, speaker (group turns only) |
| **Outbound calls** | Upstream call summary |
| **Performance** | Assembly, memory, lore, upstream TTFB/first token/TPS, persist timings |

Empty tabs usually mean that turn had no data for that section, or the turn predates audit.

---

## Preview before send (optional)

Composer toolbar **Preview** assembles the prompt on the server from current input and chat settings **without sending** (same assembly as Send, **plugin hooks excluded**).

Also requires **Enable session debug audit** under **Settings → Debug**. Errors will point you to turn it on.

---

## Where data lives

Entries are stored in **`chat-audit.json`** for that chat under `data/{userId}/`. Old entries roll off when count exceeds **Max stored audit entries**.

Backing up `data/` includes audit files. Do not let two machines write the same data directory at once.

---

## Checklist

- [ ] **Enable session debug audit** is on under **Settings → Debug**.
- [ ] After send/regenerate, **Audit** on an assistant message opens **Messages** / **Assembly** with content.
- [ ] You know **Preview** uses the same toggle.

Next: [18 · Bundled plugins guide](18-bundled-plugins.md).
