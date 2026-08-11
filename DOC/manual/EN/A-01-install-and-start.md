# A-01 · Install and start

After this chapter: arousalPub runs on this machine and opens in the browser.

Prev: none (start here) · Next: [A-02 · First login and account](A-02-first-login.md) · [Menu](00-menu.md) · [中文](../CN/A-01-install-and-start.md)

---

## What you need

1. **Node.js 24.14.0 or newer** (LTS from [nodejs.org](https://nodejs.org/)).
2. A modern browser (Chrome, Edge, Firefox, etc.).
3. **Git** (needed to download / update from the repository via CLI; install from [git-scm.com](https://git-scm.com/) if missing).
4. This project folder (see **Get the code** below).

Run `node -v` in a terminal; the version should be ≥ `v24.14.0`. Upgrade first if it is lower. Optionally run `git -v` (or `git --version`) to confirm Git works.

---

## Steps

### 1. Get the code (command line)

Open a terminal, go to the folder where you want the project, then:

**First install — clone the repository**

```bash
git clone https://github.com/vevan/arousalPub.git
cd arousalPub
```

After cloning, do the remaining steps in the **`arousalPub` project root** (the folder that contains `!_start.bat` / `start.sh`).

**Later updates — pull the latest**

Enter the project folder, then:

```bash
cd arousalPub
git pull
```

Restart the app after a successful `git pull`. If dependencies or builds changed, startup usually installs and compiles for you — you typically do not need to run `npm install` by hand.

**Prefer not to use Git?** Download a ZIP from GitHub and extract it. ZIP installs cannot use `git pull`; download a new ZIP later, or switch to `git clone` above.

### 2. Prepare config (optional)

If the project root has no `config.yaml` yet:

- **Copy** `config.example.yaml` to `config.yaml`; or
- Do nothing — **the app creates it from the example on first start**.

Beginners usually leave config alone. Default browser port is **`6633`**.

### 3. Start

| OS | Action |
|------|------|
| Windows | Double-click **`!_start.bat`** in the project root |
| macOS / Linux | From the project root run **`./start.sh`** |

The first run installs dependencies automatically; missing frontend/backend build outputs are compiled automatically. **Keep the start window open** — closing it stops the service.

### 4. Countdown (good to know)

There may be a short countdown before start (default 5 seconds; change `startCountdownSeconds` in `config.yaml`; set `0` to skip):

- **No key**: after the countdown, start with the existing build.
- **Space**: start immediately (no rebuild).
- **`B`**: rebuild, then start (use after changing app code).

First install: either no key or Space is fine. Right after `git pull`, startup may rebuild automatically when needed.

### 5. Open the app

When start succeeds, the terminal shows a URL, typically:

```text
http://localhost:6633/
```

Open it in a browser. If you changed `serverPort` in `config.yaml`, the port in the URL must match.

---

## Checklist

- [ ] You have the project folder via `git clone` (or a ZIP extract).
- [ ] The start window is still running and did not exit with an error.
- [ ] The browser opens the URL above and shows login or **Welcome**.

Then continue to [A-02 · First login and account](A-02-first-login.md).

---

## If it will not open

See [D-06 · Troubleshooting](D-06-troubleshooting.md). Common causes: window closed, port in use, wrong port in the URL.

If `git clone` / `git pull` fails: confirm Git is installed, the network can reach GitHub, and you are in the right folder (`git pull` must run inside an existing `arousalPub` clone — do not `clone` again on top of itself).
