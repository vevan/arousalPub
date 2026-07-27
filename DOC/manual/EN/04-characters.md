# 04 · Character cards: import or create

After this chapter: the character library has at least one “other” character card; optionally also a user card.

Prev: [03 · Connect the API](03-connect-api.md) · Next: [05 · Start your first chat](05-first-chat.md) · [Menu](00-menu.md) · [中文](../CN/04-characters.md)

---

## Open the character library

Top bar **Characters** → **Character library**.

---

## Option A: Import from SillyTavern (if you already have cards)

1. Click **Import JSON / PNG**.
2. Pick a SillyTavern character card (**PNG** or **JSON**).
3. After import, the character should appear in the list.

You can **Export JSON** / **Export PNG** anytime for the selected card.

---

## Option B: Create a character

1. Click **New** / **New character**.
2. Fill name, definition, greeting, etc.
3. Save (stored as a PNG with character metadata).

Field names may vary slightly by version; name + greeting are enough to start chatting — refine later.

---

## User card vs other

There is **no** separate Persona module. Your identity is also a character card:

1. Select a card in the library.
2. **Mark as user card** (filter **User**; badge **User**).

When creating a chat:

- **User character** → your user card (who you are).
- **Main / other character** → the AI role (greeting usually comes from the first other-character slot).

“User card” mainly affects filtering and habit; you can still bind any card to a slot.

---

## Change characters in a session

The library **manages cards**; who a chat uses is set under **This chat settings → Bindings** (see [06 · Common chat actions](06-chat-basics.md)).

To attach extra images/media to a character: upload under top-bar **Files**, then use **Asset library bindings** on the character page (see [09 · Asset library (Files) intro](09-files-and-assets.md)).

---

## Checklist

- [ ] At least one usable other character is in the library.
- [ ] (Optional) One card is marked as user card.

Next: [05 · Start your first chat](05-first-chat.md).
