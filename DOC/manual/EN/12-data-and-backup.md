# 12 · Where data lives and how to back up

After this chapter: you know the default data folder, how to back up the whole tree and restore on another machine, and not to double-write the same directory.

Prev: [11 · Vector recall](11-vector-recall.md) · Next: [13 · Run with Docker](13-docker.md) · [Menu](00-menu.md) · [中文](../CN/12-data-and-backup.md)

---

## Default location

All user data defaults to the project **`data/`** folder (override with `dataDir` in `config.yaml`).

Rough layout (impression only):

```text
data/
  users.index.json          # user registry
  .jwt-secret               # auth signing secret (may be auto-generated)
  .data-encryption-key      # API Key disk-encryption key
  backups/                  # in-app cold backup zips
  {8-hex-user-id}/
    chats/                  # conversations
    characters/             # characters
    prompts/                # prompts
    lorebooks/              # lorebooks
    api-settings.json       # connection config
    ...
```

Path details: [`data/README.md`](../../../data/README.md).

---

## Manual backup (recommended)

1. **Stop** arousalPub first (close the `!_start` window, or stop the Docker container) so files are not mid-write.
2. **Copy the entire `data/` folder** somewhere safe (USB, another disk, cloud, etc.).
3. Treat the backup as sensitive — it includes password hashes and encrypted API keys.

### Restore on another machine

1. Install and run the app on the new machine ([01](01-install-and-start.md)).
2. Stop the service, then **replace** that machine’s `data/` with your backup.
3. Start again.

---

## In-app cold backups

About every **7 days** by default, the whole `data/` tree is zipped into **`data/backups/`** (tune with `backupEnabled` / `backupIntervalDays` / `backupMaxKept` in `config.yaml`).

While a backup runs, the UI may show a fullscreen progress overlay and writes may pause briefly — expected.

With Syncthing etc.: **do not** let two machines write the same `dataDir` at once; consider ignoring sync of `backups/` and each user’s `memory/` (indexes can be rebuilt).

---

## Checklist

- [ ] You can find project `data/` in Explorer / Finder.
- [ ] You know “copy the whole directory” is the primary backup method.

Next (as needed): [13 · Run with Docker](13-docker.md).
