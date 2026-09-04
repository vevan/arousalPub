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

/** Per scope store RMW serial queue (plugin-side; complements host per-scope queue). */
const storeTails = new Map<string, Promise<unknown>>()

function storeKey(
  scope: 'global' | 'conversation',
  conversationId?: string,
): string {
  return scope === 'global' ? 'global' : `conversation:${conversationId ?? ''}`
}

export function runNotesStoreTask<T>(
  scope: 'global' | 'conversation',
  conversationId: string | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const key = storeKey(scope, conversationId)
  const prev = storeTails.get(key) ?? Promise.resolve()
  const next = prev.then(task, task)
  storeTails.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/** Strip HTML attributes that could forge panel actions when body contains raw HTML. */
export function stripDataPluginAttrs(text: string): string {
  return text.replace(
    /\s*data-plugin-[\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi,
    '',
  )
}

function normalizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!id) return null
  const createdAt =
    typeof o.createdAt === 'number' && Number.isFinite(o.createdAt)
      ? o.createdAt
      : Date.now()
  const updatedAt =
    typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : createdAt
  return {
    id,
    title: stripDataPluginAttrs(typeof o.title === 'string' ? o.title : ''),
    body: stripDataPluginAttrs(typeof o.body === 'string' ? o.body : ''),
    createdAt,
    updatedAt,
  }
}

export function parseNotesStore(raw: string | null): NotesStore {
  if (raw == null || raw.trim() === '') {
    return { version: 1, notes: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('notes_store_corrupt'), { status: 500 })
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Record<string, unknown>).version !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).notes)
  ) {
    throw Object.assign(new Error('notes_store_invalid'), { status: 500 })
  }
  const notes: Note[] = []
  for (const item of (parsed as { notes: unknown[] }).notes) {
    const note = normalizeNote(item)
    if (note) notes.push(note)
  }
  return { version: 1, notes }
}

async function readStore(
  data: PluginDataApi,
  scope: 'global' | 'conversation',
  conversationId?: string,
): Promise<NotesStore> {
  const raw = await data.read(scope, NOTES_FILE, conversationId)
  return parseNotesStore(raw)
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
  if (scope === 'conversation' && !conversationId) {
    throw Object.assign(new Error('missing_conversation_id'), { status: 400 })
  }
  return { scope, conversationId }
}

function sanitizeNoteFields(title: string, body: string): { title: string; body: string } {
  return {
    title: stripDataPluginAttrs(title),
    body: stripDataPluginAttrs(body),
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function listNotes(
  body: Record<string, unknown>,
  data: PluginDataApi,
): Promise<{ global: Note[]; conversation: Note[]; conversationId: string | undefined }> {
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() || undefined : undefined

  const globalStore = await runNotesStoreTask('global', undefined, () =>
    readStore(data, 'global'),
  )
  const convStore = conversationId
    ? await runNotesStoreTask('conversation', conversationId, () =>
        readStore(data, 'conversation', conversationId),
      )
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
  const { title, body: noteBody } = sanitizeNoteFields(
    typeof rawNote.title === 'string' ? rawNote.title : '',
    typeof rawNote.body === 'string' ? rawNote.body : '',
  )
  const now = Date.now()

  return runNotesStoreTask(scope, conversationId, async () => {
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
  })
}

export async function deleteNote(
  body: Record<string, unknown>,
  data: PluginDataApi,
): Promise<{ ok: true }> {
  const { scope, conversationId } = parseScope(body)
  const noteId = typeof body.noteId === 'string' ? body.noteId.trim() : ''
  if (!noteId) throw Object.assign(new Error('missing_note_id'), { status: 400 })

  return runNotesStoreTask(scope, conversationId, async () => {
    const store = await readStore(data, scope, conversationId)
    store.notes = store.notes.filter((n) => n.id !== noteId)
    await writeStore(data, scope, store, conversationId)
    return { ok: true as const }
  })
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

  return runNotesStoreTask(scope, conversationId, async () => {
    const store = await readStore(data, scope, conversationId)
    const byId = new Map(store.notes.map((n) => [n.id, n]))
    const reordered: Note[] = []
    for (const id of ids) {
      const n = byId.get(id)
      if (n) reordered.push(n)
    }
    for (const n of store.notes) {
      if (!ids.includes(n.id)) reordered.push(n)
    }
    store.notes = reordered
    await writeStore(data, scope, store, conversationId)
    return { ok: true as const }
  })
}
