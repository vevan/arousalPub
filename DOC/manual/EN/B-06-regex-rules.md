# B-06 · Regex rules intro

After this chapter: you know where regex rules live, what **display / outgoing / persist** each change, and how to batch-apply persist rules to history.

Prev: [B-05 · Settings tour](B-05-settings-tour.md) · Next: [B-07 · Vector recall](B-07-vector-recall.md) · [Menu](00-menu.md) · [中文](../CN/B-06-regex-rules.md)

---

## What regex rules do

**Regex rules** are a built-in host feature (not a plugin): find-and-replace pipelines over text.

- **Scope**: per logged-in user (`regex-rules.json`), applied to **all** chats for that account.
- There is **no** per-conversation rule set; chats only expose **batch apply** for persist rules on history.

Typical uses: strip tracker tags, normalize ellipses, clean reasoning fields, rewrite text before it goes to the model.

---

## Entry

1. Top-bar **gear** → **Settings**.
2. Left nav **Regex** (or **Regex rules**).

Drag rows to set **execution order** (top runs first); changes auto-save. Use **Pipeline test** to try sample text before relying on a rule in chat.

Migrating from SillyTavern: there is **no** one-click import of ST Regex Scripts — recreate rules here as needed (cards / world info / presets still: [D-03](D-03-from-sillytavern.md)).

---

## Three phases (most important)

Each rule can enable one or more **phases**:

| Phase | Targets | Changes saved chat on disk? | Changes next model prompt? | Changes UI bubbles? |
|-------|---------|-----------------------------|----------------------------|---------------------|
| **Display** | Rendered text | No | No | Yes |
| **Outgoing** | Assembled prompt (incl. system, etc.) | No | Yes | No (not directly) |
| **Persist** | user / assistant / reasoning **before** write | **Yes** | Yes (via history) | Visible after new turns save |

**Beginner tips**:

1. New rules often default to **display only** — prove the pattern there first, then add outgoing / persist.
2. **Persist** rewrites real history; mistakes are hard to undo — back up, or use **Pipeline test** / in-chat **Dry run** first.
3. Want “model never sees X, but disk keeps the original” → **outgoing**, not persist.
4. Want “UI looks nicer; disk and model unchanged” → **display**.

---

## Fields, skip last N, enable

| Item | Meaning |
|------|---------|
| **Fields** | `system` / `user` / `assistant` / `reasoning` (tick what that phase actually touches) |
| **Skip last N turns** | `0` = apply whenever matched; `N≥1` = do **not** apply this rule to the latest N turns |
| **Enabled** | Off = skipped, still keeps sort order |
| **Pattern / Flags / Replacement** | Standard JS RegExp and `String.replace` ( `$1`, `$&`, …) |

Real newlines in the replacement string work; the two characters `\n` are **not** auto-turned into a newline.

---

## Batch apply on history (persist only)

**Persist** rules apply automatically to **newly written** turns. To rewrite **already saved** messages:

1. Open the chat → top-bar **This chat settings** (chat gear).
2. Open the **Regex batch** (or similarly named) tab.
3. Select enabled rules that include the **Persist** phase.
4. Choose turn range → **Dry run** first → then **Apply**.

If no persist rules are enabled, the panel tells you to configure them under **Settings → Regex**.

---

## Relation to audit

With [session debug audit](D-04-session-debug-audit.md) on, the Performance tab may show **Outgoing regex** / **Persist regex** timings; the Prompt tab shows what was sent **after** outgoing processing. Useful to verify an outgoing rule did not delete too much.

---

## Suggested practice

1. Add a **display-only** rule (e.g. normalize ellipses); confirm the bubble changes and disk text does not.
2. Try an **outgoing** rule; confirm the Audit **Prompt** tab, and that UI/disk match your intent.
3. When history must change, use **Regex batch** dry-run, then apply.

---

## Checklist

- [ ] Can open **Settings → Regex** and state that rules are user-scoped for all chats.
- [ ] Can tell **display / outgoing / persist** apart (UI vs model vs disk).
- [ ] Knows history needs **This chat settings → Regex batch**, with dry-run first.

Back to: [Menu](00-menu.md). Next: [B-07 · Vector recall](B-07-vector-recall.md).
