# Beginner manual (English)

For first-time arousalPub users: finish the sections in order to complete install → connect a model → import a character → chat.

Numbering: **A** required · **B** recommended · **C** deploy · **D** advanced (read in order within a section).

Design notes / plugin specs live under [`../../devNotes/`](../../devNotes/) — not the starting point here.

[中文教程](../CN/00-menu.md) · [English README](../../../README.md) · [中文说明](../../README.zh.md)

---

## How to read

1. Prefer **A → B** first; use **C / D** as needed.
2. Each chapter does one job; finish it before the next.
3. “Click / open” assumes the default local URL (`http://localhost:6633/`).

---

## A · Required path (first use)

| ID | Doc | You will |
|----|-----|----------|
| A-01 | [Install and start](A-01-install-and-start.md) | Install Node, start the app, open it in a browser |
| A-02 | [First login and account](A-02-first-login.md) | Create the admin account, learn default user and multi-user |
| A-03 | [Connect the API](A-03-connect-api.md) | Fill OpenAI-compatible URL, key, and model; pass the test |
| A-04 | [Character cards: import or create](A-04-characters.md) | Import SillyTavern PNG/JSON, or create a card |
| A-05 | [Start your first chat](A-05-first-chat.md) | Create a chat, pick characters, send a message and see streaming |

Through **A-05**, everyday chatting is enough.

---

## B · Get comfortable (recommended next)

| ID | Doc | You will |
|----|-----|----------|
| B-01 | [Common chat actions](B-01-chat-basics.md) | Regenerate, swipe versions, bind characters/lorebooks |
| B-02 | [Prompt presets intro](B-02-prompts-intro.md) | Learn presets and entries; bind a preset to a chat |
| B-03 | [Lorebooks (world info) intro](B-03-lorebooks-intro.md) | Create lorebook / group / entry; select books for a chat |
| B-04 | [Asset library (Files) intro](B-04-files-and-assets.md) | Upload images/audio/docs; set background & BGM; meet knowledge bases |
| B-05 | [Settings tour](B-05-settings-tour.md) | Find language, theme, history depth, and other tabs |
| B-06 | [Regex rules intro](B-06-regex-rules.md) | Display / outgoing / persist phases; batch-apply on history |
| B-07 | [Vector recall](B-07-vector-recall.md) | Open vector recall, configure Embeddings, understand long-term memory |

---

## C · Data and deploy (as needed)

| ID | Doc | You will |
|----|-----|----------|
| C-01 | [Where data lives and how to back up](C-01-data-and-backup.md) | Find `data/`, full-directory backup and restore |
| C-02 | [Run with Docker](C-02-docker.md) | Container start, ports, mounts, common open failures |
| C-03 | [Startup options and countdown](C-03-startup-options.md) | `!_start` / Docker / `npm run dev`; press `B` to rebuild |

---

## D · Advanced (after you are comfortable)

| ID | Doc | You will |
|----|-----|----------|
| D-01 | [Group chat and branches intro](D-01-group-and-branches.md) | Three speaker modes, `/@` & `[NEXT@]`, branch tree |
| D-02 | [Plugins and extensions intro](D-02-plugins-intro.md) | Enable, order, per-chat overrides |
| D-03 | [Migrating from SillyTavern](D-03-from-sillytavern.md) | What you can bring (cards / world info / presets / chats) |
| D-04 | [Session debug audit](D-04-session-debug-audit.md) | Turn on audit; view prompts / assembly / performance |
| D-05 | [Bundled plugins guide](D-05-bundled-plugins.md) | How to use each of the seven shipped plugins |
| D-06 | [Troubleshooting](D-06-troubleshooting.md) | Page won’t open, no reply, audit and plugin issues, etc. |

---

## Status

English chapters (A–D) mirror the Chinese set under `DOC/manual/EN/`. Each chapter links to its [中文](../CN/00-menu.md) twin.

Product overview (not a tutorial): [`../../../README.md`](../../../README.md).
