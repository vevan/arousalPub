# 03 · Connect the API

After this chapter: an OpenAI-compatible endpoint is filled in and **Test connection** succeeds, so chats can receive model replies.

Prev: [02 · First login and account](02-first-login.md) · Next: [04 · Character cards: import or create](04-characters.md) · [Menu](00-menu.md) · [中文](../CN/03-connect-api.md)

---

## Where to configure

API settings are **not** in the main Settings modal.

Click the top-bar **link icon** to open the right drawer **Connection**.

If unset, the chat top bar may warn you to fill API Key and model in **Connection**.

---

## Steps

### 1. Fill the basics

In **Connection**, at least confirm:

| Field | Notes |
|------|------|
| **Base URL** | OpenAI-compatible URL; usually must include `/v1` (follow your provider’s docs) |
| **API Key** | Provider key; store under an alias, or type directly without saving to the key library |
| **Model ID** | The model name you will call |

Temperature, max_tokens, streaming, etc. can stay at defaults for now.

### 2. Test connection

Click **Test connection**. The app checks in two stages (model list → chat test).

- Success: go on to characters and chat.
- Failure: recheck Base URL, Key, Model ID, and whether this machine can reach the provider.

### 3. Save

Save as the panel prompts. Config is written under the local data directory (e.g. `data/<your-user-id>/api-settings.json` and related key files), **not** into public browser storage.

---

## vs Vector recall

Chat API lives in **Connection**.  
**Embeddings** (vectors / long-term memory) live under **Settings → Vector recall**, separate from this chapter; see [11 · Vector recall](11-vector-recall.md) when needed.

---

## Checklist

- [ ] **Test connection** succeeded.
- [ ] The chat top bar no longer keeps warning about a missing API (if it still does, refresh or reopen **Connection** and confirm save).

Next: [04 · Character cards: import or create](04-characters.md).
