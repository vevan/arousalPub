# 01 · Install and start

After this chapter: arousalPub runs on this machine and opens in the browser.

Prev: none (start here) · Next: [02 · First login and account](02-first-login.md) · [Menu](00-menu.md) · [中文](../CN/01-install-and-start.md)

---

## What you need

1. **Node.js 22 or newer** (LTS from [nodejs.org](https://nodejs.org/) is fine).
2. A modern browser (Chrome, Edge, Firefox, etc.).
3. This project folder (zip extract or `git clone`).

Run `node -v` in a terminal; the version should be ≥ `v22`. Upgrade first if it is lower.

---

## Steps

### 1. Prepare config (optional)

If the project root has no `config.yaml` yet:

- **Copy** `config.example.yaml` to `config.yaml`; or
- Do nothing — **the app creates it from the example on first start**.

Beginners usually leave config alone. Default browser port is **`6633`**.

### 2. Start

| OS | Action |
|------|------|
| Windows | Double-click **`!_start.bat`** in the project root |
| macOS / Linux | From the project root run **`./!_start.sh`** |

The first run installs dependencies automatically; missing frontend/backend build outputs are compiled automatically. **Keep the start window open** — closing it stops the service.

### 3. Countdown (good to know)

There may be a short countdown before start (default 5 seconds; change `startCountdownSeconds` in `config.yaml`; set `0` to skip):

- **No key**: after the countdown, start with the existing build.
- **Space**: start immediately (no rebuild).
- **`B`**: rebuild, then start (use after changing app code).

First install: either no key or Space is fine.

### 4. Open the app

When start succeeds, the terminal shows a URL, typically:

```text
http://localhost:6633/
```

Open it in a browser. If you changed `serverPort` in `config.yaml`, the port in the URL must match.

---

## Checklist

- [ ] The start window is still running and did not exit with an error.
- [ ] The browser opens the URL above and shows login or **Welcome**.

Then continue to [02 · First login and account](02-first-login.md).

---

## If it will not open

See [19 · Troubleshooting](19-troubleshooting.md). Common causes: window closed, port in use, wrong port in the URL.
