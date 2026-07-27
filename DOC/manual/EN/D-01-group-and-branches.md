# D-01 · Group chat and branches intro

After this chapter: you understand the three group-chat speaker modes, how to name speakers, and where conversation branches live.

Prev: [C-03 · Startup options and countdown](C-03-startup-options.md) · Next: [D-02 · Plugins and extensions intro](D-02-plugins-intro.md) · [Menu](00-menu.md) · [中文](../CN/D-01-group-and-branches.md)

---

## Group chat (multi-speaker)

### Prerequisite

This chat has **at least 2 other characters** bound (**Add character slot** when creating, or add under **This chat settings → Bindings**).

Without group chat enabled, even if you type `/@` for multiple names, **only** the first (or the one you named) speaks. Turn on **Enable group chat** for multi-segment chains.

### Entry points

- Chat top bar **Group chat settings**: toggle, speaker mode, auto-continue, member weights, etc.
- **This chat settings → Bindings**: add/remove/reorder character slots (order matters for **Sequential**).
- **Member quick bar** below the top bar (when group chat is on): mute, insert `/@` into the composer.

---

## One user message → many assistant segments

In group chat, one **user** message can produce several **assistant** segments (one character per segment), until:

- **Max segments / turn** is reached;
- every character’s **speak quota** is used up;
- **continue decay** ends the turn; or
- in **LLM [NEXT@]** mode, the model gives no valid next speaker and you must pick manually.

Related toggles (all under **Group chat settings**):

| Setting | Role |
|---------|------|
| **Auto-continue next speaker** | When the next speaker is already known, keep generating without an extra click |
| **Confirm next speaker after each segment** | Pause after each segment; show the suggested next speaker; you can change before continuing |
| **Max segments / turn** | Cap on assistant segments for one user message |

In **LLM [NEXT@]** mode, if the model does not output a valid `[NEXT@Name]`, you **must** choose the next speaker manually — the app will **not** fall back to Sequential or Dice.

---

## Highest priority: `/@` in the composer

Regardless of speaker mode, **`/@`** in the input box takes **first priority**:

```text
/@ Alice
/@ Alice Betty
/@ Alice your turn
```

- Names must match bound **displayName** (the member quick bar can insert `/@ Name`).
- A bare `@Alice` in the message body (no slash) is **not** used for speaker selection — it is normal text.
- Multiple names form a queue; after the queue is empty, the **speaker mode** below applies.

---

## Three speaker modes

Pick one under **Group chat settings → Speaker selection** (default is usually **Dice bidding**).

### 1. Sequential

**Good for**: fixed rotation, predictable A → B → C → A…

- Before each segment, among members who are **not muted** and still have **quota**, pick the **first** in **Bindings** character order.
- **No dice**, and **no** use of `[NEXT@…]` from assistant text (if the model writes it, it is stripped from display but does not pick the next speaker).
- To change order: reorder slots under **This chat settings → Bindings**, or use member up/down controls in group chat settings when available.

### 2. Dice bidding (good first try)

**Good for**: ensemble scenes without rigid “everyone must speak once”; chains can end naturally.

For each segment:

1. Each candidate **rolls** (affected by **weight** and **continue decay**). A failed roll costs **speak quota** but is not this segment’s speech.
2. Characters who pass roll compare **scores** (weight matters); the **highest** speaks this segment.
3. After speaking, that character loses 1 quota and their personal decay worsens — harder to grab the mic again.

Per member you can set **weight**, **speak quota**, and **mute** (muted members are skipped).  
**Continue decay** (initial rate / step per segment / floor) controls whether the turn keeps chaining — when decay fails, the turn ends.

`[NEXT@…]` in assistant replies is **not** used for picking speakers in Dice mode either — only stripped for display.

### 3. LLM `[NEXT@]`

**Good for**: letting the **model** end a reply with who speaks next, e.g. `[NEXT@Betty]`.

| Phase | How the next speaker is chosen |
|-------|--------------------------------|
| **First segment** | If the user did not use `/@` → **dice bidding** picks the opener (same as Dice mode) |
| **Second segment onward** | Read **`[NEXT@displayName]`** from the **previous** assistant raw text (last match wins); use it if valid |
| **Invalid or missing hint** | **Manual pick** UI — **no** automatic fallback to Sequential or Dice |

Extra settings:

- **Group chat prompt**: injected in all group-chat modes (explains the multi-character scene).
- **Continue prompt**: **this mode only** — concatenated with the group prompt into one system message, teaching the model how to write `[NEXT@…]`.

Use bound **displayName** in hints, not placeholders like `char1`.

---

## Mode cheat sheet

| Mode | Who picks next | Does model `[NEXT@]` pick speakers? |
|------|----------------|-------------------------------------|
| **Sequential** | Binding list order | No (stripped only) |
| **Dice bidding** | Dice + bidding each segment | No (stripped only) |
| **LLM `[NEXT@]`** | Dice for first segment; then hint or you | **Yes** (from segment 2 onward) |
| **`/@` mention** | **You** (overrides all modes above) | — |

---

## Member quick bar and more

When group chat is on, a floating member strip appears near the top bar:

- **Mute / Unmute**: exclude/include a character from selection.
- **Insert `/@ Name`**: add a mention to the composer (usually one name at a time).

Assistant bubbles / avatars can use member **colors** (set in group chat settings).

To see how a segment was resolved: assistant **Audit** → **Group chat** tab (requires session debug audit — [D-04 · Session debug audit](D-04-session-debug-audit.md)).

---

## Suggested practice

1. Bind 2–3 characters, **enable group chat**, start with **Dice bidding** and watch segment count and natural stop.
2. Switch to **Sequential** and compare fixed rotation.
3. Try **LLM [NEXT@]**, tune **Continue prompt**, check for `[NEXT@Name]` at the end; when missing, you should get **manual selection**.
4. Use **`/@ Name`** anytime to override the mode and confirm queue priority.

---

## Conversation branches

Branches fork another storyline from a message without destroying the main line.

### Entry

- Chat top bar **Branch tree**
- On a message: **Branch from here** (optional name; can fork from a swipe)

### Common actions

In the branch tree panel: **switch** main/branch, **rename**, **delete**.  
Swipe on a branch may lock at the fork anchor — expected.

---

## Checklist

- [ ] Can explain when to use **Sequential / Dice bidding / LLM [NEXT@]**.
- [ ] Know **`/@`** overrides speaker mode and bare `@` does not name speakers.
- [ ] Know **LLM [NEXT@]** requires manual pick when hint fails — no silent mode fallback.
- [ ] Can open **Branch tree** or **Branch from here**.

Next: [D-02 · Plugins and extensions intro](D-02-plugins-intro.md).
