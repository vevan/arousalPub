# 20 · Troubleshooting

After this chapter: you can self-check common symptoms; if still stuck, you know to read the start window or Docker logs.

Prev: [19 · Bundled plugins guide](19-bundled-plugins.md) · Next: none · [Menu](00-menu.md) · [中文](../CN/20-troubleshooting.md)

---

## Page will not open

1. Is the start window / container still running? Closing it stops the service.
2. Does the URL port match `config.yaml` **`serverPort`**? (default `http://localhost:6633/`)
3. Docker users: did you open **6699** by mistake? Production entry is **6633** (see [13](13-docker.md)).
4. Do not run local `!_start` and Docker on the **same port** at once.
5. Docker: `docker compose ps`, `docker compose logs -f`; `curl http://127.0.0.1:6633/health` should return `{"ok":true}`.

---

## Opens but no AI reply

1. Does the top bar warn you to configure **Connection**? → [03 · Connect the API](03-connect-api.md).
2. Open **Connection**, confirm Base URL (includes `/v1`), Key, Model ID, click **Test connection**.
3. Check provider quota, network, and firewall.

---

## UI did not change after code / update

1. Restart with `!_start`.
2. During countdown press **`B`** to force rebuild (see [14](14-startup-options.md)).
3. For local editing use `npm run dev` and **`webPort`** — do not confuse it with the prod port.

---

## Forgot password

There is **no** email reset.

- Still know the old password: **Settings → Account → Change password**.
- Fully forgotten: edit user records in `users.index.json` under the data directory, or delete that user’s data and register again — **all of that user’s data is lost**. Back up `data/` first ([12](12-data-and-backup.md)). Ops details: `DOC/devNotes/`.

---

## Vector / memory issues

1. **Settings → Vector recall**: does Embeddings **Test Embedding** pass ([11](11-vector-recall.md))?
2. **This chat settings → Vector recall → Rebuild memory index**.
3. After changing Hybrid tokenization: rebuild indexes for affected chats.

---

## No audit button / Preview fails

1. Is **Enable session debug audit** on under **Settings → Debug**? ([18](18-session-debug-audit.md))
2. The **Audit** button is on the **assistant message** toolbar; that turn must have completed send/regenerate persist.
3. **Preview** shares the same toggle; when off, no new audit entries are written.

---

## Plugin missing or not working

1. Is the plugin **enabled** under **Settings → Plugins**? ([16](16-plugins-intro.md), [19](19-bundled-plugins.md))
2. Some plugins only show on the **chat composer toolbar** or under messages; refresh or re-enter the chat.
3. Plugins that call a second LLM (Historian, Trace Keeper, etc.) need an **API preset** configured.

---

## Background / BGM / knowledge base has no files to pick

1. Upload first under top-bar **Files → Asset library** ([09](09-files-and-assets.md)); the bindings panel cannot upload.
2. Background needs an **image**, BGM needs **audio**; wrong kinds may leave the picker empty.
3. For knowledge recall: add documents on the **Knowledge bases** tab, check them under **This chat settings → Bindings → Knowledge bases**; Embeddings: [11](11-vector-recall.md).

---

## Import failed (ST)

1. Characters go through **Character library → Import**, not a bulk character path on the Settings Import tab.
2. Chat JSONL: pick user and chat characters first; may fail if the target session already has messages ([17](17-from-sillytavern.md)).
3. Confirm file format (PNG/JSON / world-info JSON / preset JSON / JSONL).

---

## Still stuck

1. Copy the full error from the start window or `docker compose logs`.
2. Confirm Node ≥ 22, enough disk space, and `data/` is writable.
3. Dev questions: [`DOC/devNotes/`](../../devNotes/); product overview: [`README.md`](../../../README.md).

Back to menu: [00-menu.md](00-menu.md).
