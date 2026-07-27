# 16 · Migrating from SillyTavern

After this chapter: you know where to import character cards, world info, prompt presets, and chat logs, plus current limits.

Prev: [15 · Plugins and extensions intro](15-plugins-intro.md) · Next: [17 · Session debug audit](17-session-debug-audit.md) · [Menu](00-menu.md) · [中文](../CN/16-from-sillytavern.md)

---

## Overview

| What to bring | Where to import |
|----------|----------|
| **Character cards** | Top bar **Characters** → **Import JSON / PNG** (not bulk character import under **Settings → Import**) |
| **World info** | **Settings → Import → ST world info → Choose JSON…**; or import on the Lorebooks page |
| **Prompt presets** | Prompt library **Import preset…**, or **Settings → Import** guiding you to the prompt library |
| **Chat logs** | **Settings → Import → ST chat log → Choose JSONL…** |

Before importing, finish [01](01-install-and-start.md)–[03](03-connect-api.md) and prepare user + chat characters ([04](04-characters.md)).

---

## Character cards

1. Open **Character library**.
2. **Import JSON / PNG**.
3. For “you”, **Mark as user card** (see [04](04-characters.md)).

---

## World info / lorebooks

1. **Settings → Import**, pick ST world-info JSON; or  
2. **Lorebooks** page → **Import lorebook (append one)**.

Then **bind** that lorebook on the chat ([08](08-lorebooks-intro.md)).

---

## Prompt presets

In the prompt library **Import preset…**, then **bind** on the chat or set as default ([07](07-prompts-intro.md)).

Macro/entry details may differ; this app’s rendering wins. Beginners can import and try chatting first.

---

## Chat logs (JSONL)

1. **Settings → Import → ST chat log**.
2. Pick **user character (persona)** and **chat character** first.
3. Choose the JSONL; a **new session** is created and filled.

Note: import may fail if the target session already has messages — use the new-session import path.  
Multi-bot group-chat history mapping may still be limited; inspect complex group logs after import.

---

## Checklist

- [ ] Successfully imported at least one of: character / world info / preset / chat log.
- [ ] Know characters import in the character library; several other types via **Settings → Import**.

Next (optional): [17 · Session debug audit](17-session-debug-audit.md) or [18 · Bundled plugins guide](18-bundled-plugins.md).
