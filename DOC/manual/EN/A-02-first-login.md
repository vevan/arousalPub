# A-02 · First login and account

After this chapter: you have a working account, can reach the main UI, and understand **default user**.

Prev: [A-01 · Install and start](A-01-install-and-start.md) · Next: [A-03 · Connect the API](A-03-connect-api.md) · [Menu](00-menu.md) · [中文](../CN/A-02-first-login.md)

---

## First open: seed account

If this machine has no users yet, you see **Welcome**:

1. Set a **username** and **password** as prompted.
2. Click **Finish setup**.

That is the first account on this machine (seed / admin). Store the password safely — the app has **no** email password recovery.

---

## Later logins

1. Open `http://localhost:6633/`.
2. Sign in with username and password.
3. (Optional) Check **Default user (stay signed in on this device, survives server restart)**.

With that checked, this machine can enter without a password next time. If you turn it off, idle timeout or a server restart may ask for the password again.

---

## Manage the account in Settings

1. Click the top-bar **gear** to open **Settings**.
2. On the left, open **Account**.

You can:

- Change avatar
- **Change password**
- Toggle **default user**
- See storage usage
- Sign out
- Delete account (destroys that user’s data — use with care)

---

## Multiple users (optional)

On the login page, **No account? Register** can create another user (public registration is controlled by `allowPublicRegister` in `config.yaml`; default allows it).

Each user has separate chats, characters, API settings, and so on.

---

## Checklist

- [ ] You can reach the home page (conversation list or **New chat**).
- [ ] You know top-bar gear → **Account** can change the password.

Next: configure the model — [A-03 · Connect the API](A-03-connect-api.md).
