# 14 · Startup options and countdown

After this chapter: you can pick the right start method for the situation, and you know what `B` / Space mean during the countdown.

Prev: [13 · Run with Docker](13-docker.md) · Next: [15 · Group chat and branches intro](15-group-and-branches.md) · [Menu](00-menu.md) · [中文](../CN/14-startup-options.md)

---

## Which method when

| Method | Best for | Browser URL |
|------|------|----------|
| **`!_start.bat` / `!_start.sh`** | Everyday local use (recommended) | `config.yaml` **`serverPort`** (default 6633) |
| **Docker** | NAS / server containers | Usually host-mapped 6633; see [13](13-docker.md) |
| **`npm run dev`** | Editing code, hot reload | **`webPort`** (often **6699**), different from prod |

For daily chatting use `!_start` or Docker — do not treat the dev port as the production entry.

Dev mode example:

```bash
npm install
npm run dev
```

`npm run dev` also runs the plugin source watcher (`scripts/watch-plugins.mjs`). Debug with `PLUGIN_WATCH_DEBUG=1`.

---

## `!_start` countdown

Config: `config.yaml` → **`startCountdownSeconds`** (default **5**; **`0`** skips the wait).

During the countdown (interactive TTY):

| Action | Effect |
|------|------|
| **No key** | After countdown, start quickly with the existing build |
| **Space** | Start immediately, no rebuild |
| **`B`** | Rebuild frontend and backend, then start |

Also:

- Missing `web/dist` or `server/dist`, or git revision differs from the last build record (e.g. after `git pull`) → **auto rebuild**.
- Dependency manifest changes (e.g. `package-lock.json`) → may auto **`npm install`** before build.

**UI did not change after editing source**: restart `!_start` and press **`B`** during the countdown.

---

## Checklist

- [ ] You can say whether you should use `!_start`, Docker, or `npm run dev`.
- [ ] You know **`B`** forces a rebuild.

Optional advanced: [15 · Group chat and branches intro](15-group-and-branches.md).
