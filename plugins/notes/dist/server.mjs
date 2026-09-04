// plugins/notes/src/server/actions.ts
var NOTES_FILE = "notes.json";
function parseStore(raw) {
  if (!raw) return { version: 1, notes: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.version === 1 && Array.isArray(parsed.notes)) {
      return parsed;
    }
  } catch {
  }
  return { version: 1, notes: [] };
}
async function readStore(data, scope, conversationId) {
  const raw = await data.read(scope, NOTES_FILE, conversationId);
  return parseStore(raw);
}
async function writeStore(data, scope, store, conversationId) {
  await data.write(scope, NOTES_FILE, JSON.stringify(store, null, 2), conversationId);
}
function parseScope(body) {
  const scope = body.scope === "conversation" ? "conversation" : "global";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() || void 0 : void 0;
  return { scope, conversationId };
}
async function listNotes(body, data) {
  const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() || void 0 : void 0;
  const globalStore = await readStore(data, "global");
  const convStore = conversationId ? await readStore(data, "conversation", conversationId) : { version: 1, notes: [] };
  return { global: globalStore.notes, conversation: convStore.notes, conversationId };
}
async function saveNote(body, data) {
  const { scope, conversationId } = parseScope(body);
  const rawNote = body.note;
  if (!rawNote || typeof rawNote !== "object") {
    throw Object.assign(new Error("invalid_note"), { status: 400 });
  }
  const rawId = typeof rawNote.id === "string" ? rawNote.id.trim() : "";
  const id = rawId || crypto.randomUUID();
  const title = typeof rawNote.title === "string" ? rawNote.title : "";
  const noteBody = typeof rawNote.body === "string" ? rawNote.body : "";
  const now = Date.now();
  const store = await readStore(data, scope, conversationId);
  const existingIdx = store.notes.findIndex((n) => n.id === id);
  const note = {
    id,
    title,
    body: noteBody,
    createdAt: existingIdx >= 0 ? store.notes[existingIdx]?.createdAt ?? now : now,
    updatedAt: now
  };
  if (existingIdx >= 0) {
    store.notes[existingIdx] = note;
  } else {
    store.notes.push(note);
  }
  await writeStore(data, scope, store, conversationId);
  return { note };
}
async function deleteNote(body, data) {
  const { scope, conversationId } = parseScope(body);
  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  if (!noteId) throw Object.assign(new Error("missing_note_id"), { status: 400 });
  const store = await readStore(data, scope, conversationId);
  store.notes = store.notes.filter((n) => n.id !== noteId);
  await writeStore(data, scope, store, conversationId);
  return { ok: true };
}
async function reorderNotes(body, data) {
  const { scope, conversationId } = parseScope(body);
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.trim().length > 0) : [];
  if (ids.length === 0) throw Object.assign(new Error("missing_ids"), { status: 400 });
  const store = await readStore(data, scope, conversationId);
  const byId = new Map(store.notes.map((n) => [n.id, n]));
  const reordered = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n) reordered.push(n);
  }
  for (const n of store.notes) {
    if (!ids.includes(n.id)) reordered.push(n);
  }
  store.notes = reordered;
  await writeStore(data, scope, store, conversationId);
  return { ok: true };
}

// plugins/notes/src/server/index.ts
async function runPluginAction(action, body, api) {
  const data = api.pluginData;
  try {
    if (action === "list-notes") {
      const result = await listNotes(body, data);
      return { ok: true, ...result };
    }
    if (action === "save-note") {
      const result = await saveNote(body, data);
      return { ok: true, ...result };
    }
    if (action === "delete-note") {
      const result = await deleteNote(body, data);
      return { ok: true, ...result };
    }
    if (action === "reorder-notes") {
      const result = await reorderNotes(body, data);
      return { ok: true, ...result };
    }
    return { ok: false, code: "unknown_action", status: 404 };
  } catch (e) {
    const err = e;
    const code = err?.message?.trim() || "notes_action_failed";
    const status = typeof err?.status === "number" ? err.status : 500;
    return { ok: false, code, status };
  }
}
export {
  runPluginAction
};
