import type { PluginDataApi } from '../../../../server/src/plugin-system/types.js'

export interface Note {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
}

export interface NotesStore {
  version: 1
  notes: Note[]
}

const NOTES_FILE = 'notes.json'

// ─── Store I/O ────────────────────────────────────────────────────────────────

function parseStore(raw: string | null): NotesStore {
  if (!raw) return { version: 1, notes: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).version === 1 &&
      Array.isArray((parsed as Record<string, unknown>).notes)
    ) {
      return parsed as NotesStore
    }
  } catch {
    // corrupted → return empty
  }
  return { version: 1, notes: [] }
}

async function readStore(
  data: PluginDataApi,
  scope: 'global' | 'conversation',
  conversationId?: string,
): Promise<NotesStore> {
  const raw = await data.read(scope, NOTES_FILE, conversationId)
  return parseStore(raw)
}

async function writeStore(
  data: PluginDataApi,
  scope: 'global' | 'conversation',
  store: NotesStore,
  conversationId?: string,
): Promise<void> {
  await data.write(scope, NOTES_FILE, JSON.stringify(store, null, 2), conversationId)
}

function parseScope(body: Record<string, unknown>): {
  scope: 'global' | 'conversation'
  conversationId: string | undefined
} {
  const scope = body.scope === 'conversation' ? 'conversation' : 'global'
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() || undefined : undefined
  return { scope, conversationId }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function listNotes(
  body: Record<string, unknown>,
  data: PluginDataApi,
): Promise<{ global: Note[]; conversation: Note[]; conversationId: string | undefined }> {
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() || undefined : undefined

  const globalStore = await readStore(data, 'global')
  const convStore = conversationId
    ? await readStore(data, 'conversation', conversationId)
    : { version: 1 as const, notes: [] }

  return { global: globalStore.notes, conversation: convStore.notes, conversationId }
}

export async function saveNote(
  body: Record<string, unknown>,
  data: PluginDataApi,
): Promise<{ note: Note }> {
  const { scope, conversationId } = parseScope(body)

  const rawNote = body.note as Record<string, unknown> | undefined
  if (!rawNote || typeof rawNote !== 'object') {
    throw Object.assign(new Error('invalid_note'), { status: 400 })
  }

  const rawId = typeof rawNote.id === 'string' ? rawNote.id.trim() : ''
  const id = rawId || crypto.randomUUID()
  const title = typeof rawNote.title === 'string' ? rawNote.title : ''
  const noteBody = typeof rawNote.body === 'string' ? rawNote.body : ''
  const now = Date.now()

  const store = await readStore(data, scope, conversationId)
  const existingIdx = store.notes.findIndex((n) => n.id === id)

  const note: Note = {
    id,
    title,
    body: noteBody,
    createdAt: existingIdx >= 0 ? (store.notes[existingIdx]?.createdAt ?? now) : now,
    updatedAt: now,
  }

  if (existingIdx >= 0) {
    store.notes[existingIdx] = note
  } else {
    store.notes.push(note)
  }

  await writeStore(data, scope, store, conversationId)
  return { note }
}

export async function deleteNote(
  body: Record<string, unknown>,
  data: PluginDataApi,
): Promise<{ ok: true }> {
  const { scope, conversationId } = parseScope(body)
  const noteId = typeof body.noteId === 'string' ? body.noteId.trim() : ''
  if (!noteId) throw Object.assign(new Error('missing_note_id'), { status: 400 })

  const store = await readStore(data, scope, conversationId)
  store.notes = store.notes.filter((n) => n.id !== noteId)
  await writeStore(data, scope, store, conversationId)
  return { ok: true }
}

export async function reorderNotes(
  body: Record<string, unknown>,
  data: PluginDataApi,
): Promise<{ ok: true }> {
  const { scope, conversationId } = parseScope(body)

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  if (ids.length === 0) throw Object.assign(new Error('missing_ids'), { status: 400 })

  const store = await readStore(data, scope, conversationId)
  const byId = new Map(store.notes.map((n) => [n.id, n]))
  const reordered: Note[] = []
  for (const id of ids) {
    const n = byId.get(id)
    if (n) reordered.push(n)
  }
  // append any notes not in the ids list for safety
  for (const n of store.notes) {
    if (!ids.includes(n.id)) reordered.push(n)
  }
  store.notes = reordered
  await writeStore(data, scope, store, conversationId)
  return { ok: true }
}
