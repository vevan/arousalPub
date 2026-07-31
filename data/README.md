# Data directory

[中文](README.zh.md)

Runtime data root. Default path: `data/` under the repo (override with `config.yaml` → `dataDir` or env `DATA_DIR` / `AROUSAL_DATA_DIR`).

Do **not** commit real user data. This folder is gitignored except for these READMEs.

## Multi-user layout

```
data/
  users.index.json          # User registry (username, password hash, display name, …)
  .jwt-secret               # JWT signing secret (may be auto-generated)
  .data-encryption-key      # Disk encryption master key for API keys (may be auto-generated)
  backups/                  # In-app full cold-backup zips (§8.8; do not Syncthing this)
    backup-<timestamp>.zip
    backup-manifest.json
  plugins/                  # Global plugin packages (install once; shared code)
    <pluginId>/
      manifest.json
      dist/
      locales/
      assets/               # Optional (e.g. default.mp3)
      {userId}/             # Per-user settings & uploads for this plugin
        settings.json
        assets/
        secrets/
  00000000/                 # Seed account
    plugin-registry.json    # Per-user plugin enablement & hook order
    chats/
    ...
  {8-hex}/
    plugin-registry.json
    ...
```

- **User ID**: 8 lowercase hex digits.
- **Plugin registry**: one file per user at `data/{userId}/plugin-registry.json` (not at the data root). Legacy `data/plugin-registry.json` migrates into the user dir on first seed.
- **Auth**: `/api/*` requires JWT except public routes.

## Per-user directory `{userId}/`

| Path | Notes |
|------|--------|
| `plugin-registry.json` | Plugin `enabled` / `order` for this user |
| `avatar.png` | User avatar |
| `chats/` | Conversations & messages (`index.json` may include **`backgroundImageFileId`** / **`bgmFileId`**; see `DOC/devNotes/20` M3). Branches live under conversation folders; optional **`chat-audit.json`** when session debug audit is on (`DOC/devNotes/24`) |
| `prompts/` | Prompt presets (`index.json` + `preset-*.json`) |
| `characters/` | Character cards — primary store **`{id}.png`** (8-hex id); host metadata in **`index.json`** (`userCardList`, **`imageFilesByCharacterId`**; see `DOC/devNotes/03` §6.7 / §12) |
| `lorebooks/` | Lorebooks (`index.json` + per-book JSON) |
| `files/` | User file library (`index.json` + `{fileId}/meta.json` + `{fileId}/content`; `DOC/devNotes/20`, `DOC/devNotes/03` §17) |
| `knowledgeBases/` | Document RAG libraries (`index.json` + `{kbId}.json` + `{kbId}/chunks.json`; Lance under `memory/knowledge/`; `DOC/devNotes/46`) |
| `api-settings.json`, `api-keys.json` | API presets & key aliases (inline keys on disk as **`apiKeyEnc` / `keyEnc`**; `DOC/devNotes/25` §15) |
| `user-preferences.json` | Global prefs (embedding **`apiKeyEnc`**, **`hybridFts`**, default authors’ note, budget trim, …; `DOC/devNotes/03` §14.4.3) |
| `memory/` | Lance indexes (**derived**, rebuildable; prefer ignoring in Syncthing; `DOC/devNotes/03` §14.5) — turns under `memory/conversations/`, knowledge under `memory/knowledge/` |
| `hybrid-fts/` | Hybrid BM25 tokenizer assets (e.g. `zh-jieba/{variant}/…`; `DOC/devNotes/03` §14.4.3) |
| `regex-rules.json` | Native regex rules (user-level only; no per-chat copy; `DOC/devNotes/24` §2.1, §6) |

New users also receive English **seed** content (default API preset, prompt presets, lorebook, regex rule) written once at registration.

## Secret files (`data/` root)

| File / env | Purpose |
|------------|---------|
| `.jwt-secret` | JWT signing secret (production may generate on first start) |
| `.data-encryption-key` | Master key for **disk encryption** of API keys (AES-256-GCM) |
| `JWT_SECRET` / `config.yaml` → `jwtSecret` | Override JWT secret |
| `DATA_ENCRYPTION_KEY` / `config.yaml` → `dataEncryptionKey` | Override disk encryption key |

**Syncthing / multi-machine**: syncing ciphertext under `data/{userId}/` is fine; every instance must use the **same** `DATA_ENCRYPTION_KEY` (or sync `.data-encryption-key`), or API keys cannot be decrypted.

**dev / prod**: without env/config, both read/write `data/.data-encryption-key` (64-hex auto-generated on first start; no fixed dev default key).

**Rotate DEK**: open `http://127.0.0.1:<serverPort>/admin` (seed user) → generate recommendation → start rotation; see `DOC/devNotes/17`.

## Plugins and Syncthing

- **Per-turn plugin state**: `chats/.../turn-*.json` → **`turn.plugins[]`**.
- **Plugin code**: `data/plugins/<pluginId>/` (global).
- **Plugin config**: `data/plugins/<pluginId>/{userId}/settings.json`; uploads under **`.../{userId}/assets/`**. Global settings + registry `enabled` can be imported/exported from Settings (`DOC/devNotes/09` §4); excludes conversation overrides and secrets.
- Details: **`DOC/devNotes/09-plugin-system-and-guidance-generate.md`**.

## Backup

Back up the whole `data/` tree. It contains password hashes and encrypted API keys — treat it like production secrets. Ops detail: **`DOC/devNotes/03` §8**.

### In-app cold backup (`data/backups/` · `DOC/devNotes/03` §8.8)

| Item | Notes |
|------|--------|
| **Trigger** | After server start: if longer than `config.yaml` → `backupIntervalDays` (default 7) since last **successful** cold backup, or never backed up |
| **Output** | `{dataDir}/backups/backup-<ISO8601>.zip` + `backup-manifest.json` |
| **Retention** | `backupMaxKept` (default 5); oldest zips deleted |
| **Scope** | Entire `data/` (all `{userId}/`, `memory/` Lance, `.jwt-secret`, `.data-encryption-key`, …), **excluding** `backups/` itself |
| **While running** | Full-screen progress in the Web UI; write APIs that mutate `data` return **503** `backup_in_progress` |
| **Status API** | `GET /api/backup/status` (no JWT): `running`, `filesDone`, `filesTotal`, `lastSuccessAt`, `lastError` |

**`backup-manifest.json`** (example fields):

```json
{
  "lastSuccessAt": "2026-06-09T02:25:18.000Z",
  "file": "backup-20260609T022518Z.zip",
  "bytes": 12345678
}
```

Config (`config.yaml` / `config.example.yaml`): `backupEnabled` (default `true`), `backupIntervalDays`, `backupMaxKept`, `backupRetryHours` (defer retries after failure, default 24h).

~~Per-turn incremental backup (§8.4)~~: **indefinitely deferred** — not implemented. `backupSettings` inside `chats/.../index.json` is a historical placeholder only.

### Optional ops scripts (`DOC/devNotes/03` §8.7)

Manual zip of the whole `dataDir` **after stopping the app** (excludes `backups/`). Does **not** replace in-app cold backup:

| Item | Notes |
|------|--------|
| **Entry** | `scripts/ops/backup.example.bat` (Windows) · `scripts/ops/backup.example.sh` (Unix) · shared `scripts/ops/backup-data.mjs` |
| **Data root** | Env `DATA_DIR` / `AROUSAL_DATA_DIR`, else repo `config.yaml` `dataDir`, else `./data` |
| **Output** | Default repo-root `backup-out/backup-<timestamp>.zip`; optional argv for output directory |
| **Deps** | Node (reads `config.yaml` only; never creates it) + system `tar` (zip; Windows 10+ ships `tar.exe`) |
| **Constraint** | Output directory must not sit inside `dataDir`; default `backup-out/` is `.gitignore`d |
| **On failure** | English diagnostics on stderr (argv, spawn, exit/signal, stdout/stderr summary); wrappers pass through exit code |

```bat
REM Stop the app first
scripts\ops\backup.example.bat
scripts\ops\backup.example.bat D:\cold-copies
```

```bash
# Stop the app first
./scripts/ops/backup.example.sh
./scripts/ops/backup.example.sh /mnt/cold-copies
```

### Syncthing / multi-machine boundaries

| Sync | Ignore / caution |
|------|------------------|
| Authoritative data: `chats/`, JSON config, chunks, … | Entire **`backups/`** |
| Optional: rebuild locally | **`memory/`** Lance indexes (recommended in `.stignore`; `DOC/devNotes/03` §14.5) |

**Single writer**: only **one** server process on a given `dataDir` (do not run prod and dev against the same tree). Otherwise Lance may corrupt (`memory_vector_index_corrupt` → rebuild from Settings).

Suggested Syncthing **Ignore Patterns** (`.stignore`):

```
backups
memory
```

Instances must share the same `DATA_ENCRYPTION_KEY` (or sync `.data-encryption-key`); see **Secret files** above.

### Restore (`DOC/devNotes/03` §8.5)

1. **Stop** the app (avoid half-written files).
2. Rename current `data` to `data.broken-<timestamp>` (keep the broken tree).
3. Unzip the chosen archive from `backups/` into the original `dataDir`.
4. **Start** and verify login, chats, API key reveal, plugins.
5. With Syncthing: **pause sync** during restore, or designate one authoritative copy before syncing again.

Offline copy of the whole `data/` tree (including secret files) is a valid complement to in-app zip backups.
