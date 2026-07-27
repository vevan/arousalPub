# 14 · Group chat and branches intro

After this chapter: you know where multi-character group chat and conversation branches live, and what problem each solves. Fine-tune parameters later.

Prev: [13 · Startup options and countdown](13-startup-options.md) · Next: [15 · Plugins and extensions intro](15-plugins-intro.md) · [Menu](00-menu.md) · [中文](../CN/14-group-and-branches.md)

---

## Group chat (multi-speaker)

### Prerequisite

This chat has **at least 2 other characters** bound (**Add character slot** when creating, or add under **This chat settings → Bindings**).

Creating with ≥2 bots often writes initial group-chat settings.

### Entry

Chat top bar **Group chat settings**; character list still under **This chat settings → Bindings**.

### Capabilities (summary)

- Toggle **Enable group chat**
- **Speaker selection** (weighted random, sequential, dice, LLM `[NEXT@]`, etc.)
- Auto-continue, max segments per turn
- Member weight / mute / color, etc.
- Member quick bar: mute, `/@name` mention, etc.

Suggestion: add two characters, enable group chat, send a few messages, watch turn order, then change selection mode.

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

- [ ] Can find **Group chat settings**, or know you need ≥2 bound characters first.
- [ ] Can open **Branch tree**, or see **Branch from here** on a message.

Next: [15 · Plugins and extensions intro](15-plugins-intro.md).
