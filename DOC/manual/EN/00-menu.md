# Beginner manual (English)

For first-time arousalPub users: follow the chapters in order to go from install → connect a model → import a character → chat.

Developer design notes live in [`../../devNotes/`](../../devNotes/) — do not start there.

[Language hub](../00-menu.md) · [中文教程](../CN/00-menu.md) · [English README](../../../README.md) · [中文说明](../../README.zh.md)

---

## How to read

1. Follow the numbers; early chapters are required, later ones are optional depth.
2. Each chapter does one job — finish it before the next.
3. “Click / open” assumes the default local start URL (`http://localhost:6633/`). Switch the UI language to English under **Settings → System** if you want labels to match this guide.

---

## Required path (first use)

| # | Doc | You will |
|------|------|----------|
| 01 | [Install and start](01-install-and-start.md) | Install Node, start the app, open it in a browser |
| 02 | [First login and account](02-first-login.md) | Create the admin account, learn default user and multi-user |
| 03 | [Connect the API](03-connect-api.md) | Fill OpenAI-compatible URL, key, and model; pass the test |
| 04 | [Character cards: import or create](04-characters.md) | Import SillyTavern PNG/JSON, or create a card |
| 05 | [Start your first chat](05-first-chat.md) | Create a chat, pick characters, send a message and see streaming |

Through **05**, everyday chatting is enough.

---

## Recommended next

| # | Doc | You will |
|------|------|----------|
| 06 | [Common chat actions](06-chat-basics.md) | Regenerate, swipe versions, bind characters/lorebooks |
| 07 | [Prompt presets intro](07-prompts-intro.md) | Learn presets and entries; bind a preset to a chat |
| 08 | [Lorebooks (world info) intro](08-lorebooks-intro.md) | Create lorebook / group / entry; select books for a chat |
| 09 | [Settings tour](09-settings-tour.md) | Find language, theme, history depth, and other tabs |
| 10 | [Vector recall](10-vector-recall.md) | Open vector recall, configure Embeddings, understand long-term memory |

---

## Data and deployment (as needed)

| # | Doc | You will |
|------|------|----------|
| 11 | [Where data lives and how to back up](11-data-and-backup.md) | Find `data/`, full-directory backup and restore |
| 12 | [Run with Docker](12-docker.md) | Container start, ports, mounts, common open failures |
| 13 | [Startup options and countdown](13-startup-options.md) | `!_start` / Docker / `npm run dev`; press `B` to rebuild |

---

## Advanced (after you are comfortable)

| # | Doc | You will |
|------|------|----------|
| 14 | [Group chat and branches intro](14-group-and-branches.md) | Multi-speaker chat and the branch tree |
| 15 | [Plugins and extensions intro](15-plugins-intro.md) | Enable, order, per-chat overrides |
| 16 | [Migrating from SillyTavern](16-from-sillytavern.md) | What you can bring (cards / world info / presets / chats) |
| 17 | [Session debug audit](17-session-debug-audit.md) | Turn on audit; view prompts / assembly / performance |
| 18 | [Bundled plugins guide](18-bundled-plugins.md) | How to use each of the seven shipped plugins |
| 19 | [Troubleshooting](19-troubleshooting.md) | Page won’t open, no reply, audit and plugin issues, etc. |

---

## Status

English chapters 01–19 mirror the Chinese set under `DOC/manual/EN/`. Each chapter links to its [中文](../CN/00-menu.md) twin.

Product overview (not a tutorial): [`../../../README.md`](../../../README.md).
