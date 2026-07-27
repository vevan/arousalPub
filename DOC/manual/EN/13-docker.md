# 13 · Run with Docker

After this chapter: you can build and start with Docker Compose, open a healthy service in the browser, and know where data is mounted.

Prev: [12 · Where data lives and how to back up](12-data-and-backup.md) · Next: [14 · Startup options and countdown](14-startup-options.md) · [Menu](00-menu.md) · [中文](../CN/13-docker.md)

---

## When to use this

NAS, Linux servers, or when you prefer containers. For everyday local use, `!_start.bat` / `!_start.sh` is still fine (see [01](01-install-and-start.md)).

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

---

## Build and start

From the project root:

```bash
docker compose up -d --build
```

Use **`--build`** on first run and after code updates. If the local image is missing, Compose builds it; it does **not** pull `arousalpub:local` from Docker Hub.

Open:

```text
http://127.0.0.1:6633/
```

This is **`serverPort` (6633)**, **not** the dev `webPort` (often 6699).

Host port example:

```bash
AROUSALPUB_PORT=8080 docker compose up -d --build
```

---

## Data

By default project **`./data`** mounts to container **`/data`**, same layout as local `!_start` — easy to back up ([12](12-data-and-backup.md)).

**Do not** let multiple container instances read/write the same data directory.  
**Do not** run local `!_start` and Docker on **6633** at the same time.

---

## Quick troubleshooting if the page will not open

1. URL is `http://127.0.0.1:6633/` (include `http://`; no https; not 6699).
2. `docker compose ps`: port mapped and status **Up (healthy)**.
3. Local `!_start` still holding the port — close it first.
4. `docker compose logs -f`: look for `static web:` / `listening on`.
5. `curl http://127.0.0.1:6633/health` should return `{"ok":true}`.

---

## Common commands

| Command | Purpose |
|------|------|
| `docker compose logs -f` | Follow logs |
| `docker compose down` | Stop and remove the container |
| `docker compose up -d --build` | Rebuild and start after updates |

The image is prebuilt; upgrade with `--build` or a new image. Container start does **not** `git pull` for you.

Optional env vars (under `environment` in `docker-compose.yml`): `JWT_SECRET`, `DATA_DIR`, `PORT`, etc.

---

## Checklist

- [ ] `docker compose ps` shows healthy.
- [ ] Browser opens 6633 (or your remapped port).
- [ ] You know `./data` is the persisted data.

Next: [14 · Startup options and countdown](14-startup-options.md).
