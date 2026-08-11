# arousalPub

A local AI character chat app: manage character cards, prompt presets, and lorebooks (world info), then stream conversations with models in the browser. All data stays on disk for backup or sync.

[English guide](DOC/manual/EN/00-menu.md) · [中文教程](DOC/manual/CN/00-menu.md) · [中文说明](DOC/README.zh.md)

---

## What stands out

- **Chunked chat storage** — Conversations are stored as linked turn chunks on disk, so long chats stay manageable for backup and tools like Syncthing (avoid writing the same data dir from two machines at once).
- **Readable session audit** — Open an assistant message’s **Audit** panel to inspect prompt assembly, regex stages, and group-chat speaker picks when debug audit is on ([guide](DOC/manual/EN/D-04-session-debug-audit.md)).
- **Native regex pipeline** — User-level display / outgoing / persist rules, plus batch apply on history ([guide](DOC/manual/EN/B-06-regex-rules.md)).
- **Drag-and-drop prompt groups** — Prompt presets use groups and entries you can reorder by dragging, with clear injection / trigger controls ([guide](DOC/manual/EN/B-02-prompts-intro.md)).
- **Group chat speaker modes** — Multi-segment turns: sequential, dice bidding, or LLM `[NEXT@]`, plus `/@` mentions that override the mode ([guide](DOC/manual/EN/D-01-group-and-branches.md)).
- **Isolated API keys** — Keys stay on the server (not exposed to the browser UI); list APIs return masked status, and reveal requires your login password.
- **Plugin sandbox & host boundary** — Plugins call models and disk through the host; browser plugins never hold plaintext keys. Optional server Worker sandbox for stronger isolation ([guide](DOC/manual/EN/D-02-plugins-intro.md)).
- **Conversation branches** — Fork a storyline from a message without destroying the main line ([same chapter](DOC/manual/EN/D-01-group-and-branches.md)).

Everyday “how do I…” steps live in the [beginner manual](DOC/manual/EN/00-menu.md).

---

## Requirements

- **Node.js 24.14.0+** ([nodejs.org](https://nodejs.org/) LTS)
- A modern browser (Chrome, Edge, Firefox, etc.)
- On Windows, double-click `!_start.bat`; on macOS / Linux, use `start.sh`

---

## Quick start

### 0. Get the code (command line)

Install [Git](https://git-scm.com/) first if needed. In a terminal:

**First time — clone the repository**

```bash
git clone https://github.com/vevan/arousalPub.git
cd arousalPub
```

**Later — pull the latest version** (run inside the project folder)

```bash
cd arousalPub
git pull
```

Then start the app as usual (`!_start.bat` / `./start.sh`). After `git pull`, startup may auto-run `npm install` and rebuild when needed.

You can also download a ZIP from GitHub and extract it; ZIP installs do not get `git pull` updates — download a new ZIP or switch to `git clone` above.

Step-by-step for beginners: [Install and start](DOC/manual/EN/A-01-install-and-start.md).

### 1. First run

1. Have the project folder ready (see **§0** above, or unpack a ZIP).
2. If you do not have `config.yaml` yet, copy **`config.example.yaml`** to **`config.yaml`** (the app can also generate it from the example on first start).
3. Double-click **`!_start.bat`** (Windows) or run **`./start.sh`** in a terminal.

The first run installs dependencies automatically. After a `git pull` (or similar), if `package-lock.json` or a workspace `package.json` changed, startup also runs `npm install` as needed. If build artifacts are missing, the app compiles them before starting. **Keep the startup window open** — closing it stops the service.

### 2. Open the app

When startup succeeds, the terminal shows a clickable URL, typically:

```text
http://localhost:6633/
```

The port comes from **`serverPort`** in `config.yaml` (example default: `6633`).

### 3. First login

- The first visit walks you through creating an **admin account** (username and password).
- After login you can check **“Set as default user”** so this machine can enter without a password next time (data still lives on disk).
- Change the password or register more users under **Settings → Account**.

---

## Startup options

| Method | When to use |
|------|------|
| **`!_start.bat` / `start.sh`** | Everyday use (recommended) |
| **Docker** | NAS / Linux servers and other container hosts |
| **`npm run dev`** | Local development (two ports + hot reload) |

### Startup countdown

Before `!_start.bat` launches, there is a **`startCountdownSeconds`** countdown (default 5 seconds; set in `config.yaml`; `0` skips it).

- **No key**: after the countdown, start quickly with the existing build.
- **Press `B`**: rebuild frontend and backend, then start (use this after changing app code).
- **Press Space**: skip the countdown and start immediately (no rebuild).

If `web/dist` or `server/dist` is missing, or the current git revision differs from the last build record (for example after `git pull`), a rebuild runs automatically. When dependency manifests change, `npm install` runs before the build (usually no need to run it by hand). If you edited code locally without committing, press **B** during the countdown to force a rebuild.

---

## Docker

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

### Build and start

```bash
docker compose up -d --build
```

Use **`--build`** on first run and after code updates. If the local image does not exist yet, Compose builds it; it does **not** pull `arousalpub:local` from Docker Hub (that tag is local-only).

Open **`http://127.0.0.1:6633/`** in a browser (**not** the dev `webPort` 6699). To change the host port: `AROUSALPUB_PORT=8080 docker compose up -d --build`

### Cannot open in the browser?

1. Confirm the URL is **`http://127.0.0.1:6633/`** (include `http://`; do not use https; do not use 6699).
2. Run **`docker compose ps`** — you should see `0.0.0.0:6633->6633/tcp` and status **Up** (healthy).
3. If **`!_start.bat` is already running** locally, it may hold port 6633: close that window, then `docker compose up -d`.
4. Check logs: **`docker compose logs -f`** — look for `static web:` and `listening on`.
5. Quick check: **`curl http://127.0.0.1:6633/health`** should return `{"ok":true}`.

### Data persistence

By default, project **`./data`** is mounted at `/data` in the container (chats, characters, API keys, etc.), same path layout as local `!_start.bat` use of `data/` — easy to back up or sync with Syncthing.

**Do not** let multiple container instances read/write the same data directory at once.

### Common commands

| Command | Description |
|------|------|
| `docker compose logs -f` | Follow logs |
| `docker compose down` | Stop and remove the container |
| `docker compose up -d --build` | Rebuild and start after image updates |

The image ships with frontend and backend prebuilt; it does **not** run `git pull` or a local rebuild on container start. To upgrade, run `docker compose up -d --build` again or pull a new image.

Optional environment variables (set under `environment` in `docker-compose.yml`):

| Variable | Description |
|------|------|
| `JWT_SECRET` | JWT secret (≥16 characters); if unset, first start writes `/data/.jwt-secret` |
| `DATA_DIR` | Data directory, default `/data` |
| `PORT` | Listen port, default `6633` |

The Compose setup mounts `./config.yaml` read-only at `/app/config.yaml`. Create it from `config.example.yaml` before starting. Backend proxy settings also live in this YAML file.

---

## Basic usage

### Chat

1. On the home page, **“New chat”**: pick a user persona card and main character card; optionally set a title and select lorebooks.
2. In a chat, type and send; supports streaming replies, reasoning display, regenerate, and multi-version swipes.
3. The sidebar can bind/switch characters and lorebooks, and adjust prompt / memory options for this chat.

### Characters

Top bar **“Characters”**: import SillyTavern PNG/JSON, create or edit cards, export PNG/JSON. Session bindings are set in the chat sidebar.

### Prompts

Top bar **“Prompts”**: manage presets and grouped entries (injection order and triggers); a chat can bind one preset.

### Lorebooks (world info)

Top bar **“Lorebooks”**: organize by lorebook → group → entry; select which lorebooks to inject when creating a chat or in the sidebar.

### Settings

Top bar **“Settings”**:

- **Connection / API**: OpenAI-compatible base URL, key, model, etc.
- **Chat history / lorebooks / vector recall**: history depth, lorebook recursion, long-term memory and Embeddings API, hybrid tokenization, etc. (vector options are under the “Vector recall” tab).
- **Language**: switch UI between Chinese and English.
- **Theme, font size**, and other display options.

API keys live in the local data directory, not in public browser storage.

---

## Configuration (`config.yaml`)

Common keys:

| Key | Description |
|--------|------|
| `dataDir` | Data directory, default `./data` |
| `serverPort` | Browser port after start (`!_start.bat`) |
| `startCountdownSeconds` | Countdown seconds before start; `0` = no wait |
| `enableProxy`, `proxyUrl`, `proxyNoProxy` | Backend outbound proxy; disabled by default and applied after restart |
| `authIdleMinutes`, etc. | Login session timeout (optional) |

Full comments are in `config.example.yaml`.

---

## Data and backup

Chats, characters, prompts, lorebooks, API config, and related files all live under **`dataDir`** (default project **`data/`**), one subdirectory per user.

- **Backup**: copy the whole `data/` directory.
- **Restore on another machine**: install the app, then replace with your backed-up `data/`.
- **Sync** (e.g. Syncthing): avoid two machines writing the same data directory **at the same time**, or you risk conflicts.

Path details: [`data/README.md`](data/README.md) ([中文](data/README.zh.md)).

---

## FAQ

**Page will not open**

- Confirm the startup window is still running and the port is free.
- Check that `config.yaml` `serverPort` matches the URL in the browser.

**UI did not update after code changes**

- Restart with `!_start.bat` and press **`B`** during the countdown to force a rebuild.

**Forgot password**

- Adjust user records under the data directory, or delete that user’s data and register again (that user’s data is lost). Ops details are in `DOC/devNotes/`.

**JWT in production**

- First `!_start.bat` run can write a secret to `data/.jwt-secret`; you can also set `jwtSecret` in `config.yaml` (≥16 characters).

**`npm audit` shows high severity / suggests `--force`**

- End users only need `./start.sh` / `!_start.bat` (or `npm start`). You do **not** need to run `npm audit` or `npm audit fix --force`.
- Do **not** run `npm audit fix --force` — it can jump major versions and break the install.
- Current `main` pins patched **`@fastify/static`**, **`sharp`**, and **`vue-tsc`**. After `git pull` + a normal install, `npm audit` should report **0 vulnerabilities**. Older clones may still show stale advisories until you update.
- The root `package.json` pins approved install scripts for `esbuild@0.28.1`, `onnxruntime-node@1.24.3`, `protobufjs@7.6.5`, and `vue-demi@0.14.10`. A current checkout should not show `allow-scripts` warnings after a normal install. If an older checkout reports pending scripts, review and approve the exact installed versions with `npm approve-scripts esbuild onnxruntime-node protobufjs vue-demi`; these notices are separate from audit CVEs.

---

## Developer docs

Architecture, APIs, and implementation notes: **`DOC/devNotes/`**. Project index: [`cursor.md`](cursor.md). Beginner manual: [EN](DOC/manual/EN/00-menu.md) · [CN](DOC/manual/CN/00-menu.md). Chinese overview: [`DOC/README.zh.md`](DOC/README.zh.md). Docs hub: [`DOC/README.md`](DOC/README.md).

Dev mode:

```bash
npm install
npm run dev
```

`npm run dev` also starts **`scripts/watch-plugins.mjs`** in parallel: it watches repo `plugins/*/src` and rebuilds only when sources are newer than `dist` (avoids false positives on Windows watchers). Debug: `PLUGIN_WATCH_DEBUG=1`.

Open the **`webPort`** from `config.yaml` in the browser (default differs from `serverPort`).

---

## Acknowledgments

Special thanks to the following pioneers and projects for inspiration:

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — SillyTavern team
- [SillyTavern Memory Books (STMB)](https://github.com/aikohanasaki/SillyTavern-MemoryBooks) — aikohanasaki
- [SillyTavern WTracker](https://github.com/bmen25124/SillyTavern-WTracker) — bmen25124
- [Guided Generations](https://github.com/Samueras/GuidedGenerations-Extension) — Samueras
- [All But This Swipe](https://github.com/Avilnetro/all-but-this-swipe) — Avilnetro
