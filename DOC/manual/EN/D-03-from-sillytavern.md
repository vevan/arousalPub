# D-03 · Migrating from SillyTavern

After this chapter: you know where to import character cards, world info, prompt presets, and chat logs, plus current limits.

Prev: [D-02 · Plugins and extensions intro](D-02-plugins-intro.md) · Next: [D-04 · Session debug audit](D-04-session-debug-audit.md) · [Menu](00-menu.md) · [中文](../CN/D-03-from-sillytavern.md)

---

## Overview

| What to bring | Where to import |
|----------|----------|
| **Character cards** | Top bar **Characters** → **Import JSON / PNG** (not bulk character import under **Settings → Import**) |
| **World info** | **Settings → Import → ST world info → Choose JSON…**; or import on the Lorebooks page |
| **Prompt presets** | Prompt library **Import preset…**, or **Settings → Import** guiding you to the prompt library |
| **Chat logs** | **Settings → Import → ST chat log → Choose JSONL…** |

Before importing, finish [A-01](A-01-install-and-start.md)–[A-03](A-03-connect-api.md) and prepare user + chat characters ([A-04](A-04-characters.md)).

---

## Character cards

1. Open **Character library**.
2. **Import JSON / PNG**.
3. For “you”, **Mark as user card** (see [A-04](A-04-characters.md)).

---

## World info / lorebooks

1. **Settings → Import**, pick ST world-info JSON; or  
2. **Lorebooks** page → **Import lorebook (append one)**.

Then **bind** that lorebook on the chat ([B-03](B-03-lorebooks-intro.md)).

---

## Prompt presets

In the prompt library **Import preset…**, then **bind** on the chat or set as default ([B-02](B-02-prompts-intro.md)).

Macro/entry details may differ; this app’s rendering wins. Beginners can import and try chatting first.

---

## Chat logs (JSONL)

1. **Settings → Import → ST chat log**.
2. Pick **user character (persona)** and **chat character** first.
3. Choose the JSONL; a **new session** is created and filled.

Note: import may fail if the target session already has messages — use the new-session import path.  
Multi-bot group-chat history mapping may still be limited; inspect complex group logs after import.

---

## Regex scripts

SillyTavern Regex Scripts **cannot** be one-click imported via **Settings → Import** today. Recreate them under **Settings → Regex**; phases and history batch-apply: [B-06 · Regex rules intro](B-06-regex-rules.md).

---

## Checklist

- [ ] Successfully imported at least one of: character / world info / preset / chat log.
- [ ] Know characters import in the character library; several other types via **Settings → Import**.

Next (optional): [D-04 · Session debug audit](D-04-session-debug-audit.md) or [D-05 · Bundled plugins guide](D-05-bundled-plugins.md).
