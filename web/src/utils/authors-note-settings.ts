/** 与 server/src/authors-note-settings.ts 对齐 */

export type AuthorsNoteRole = 'system' | 'user'

export interface AuthorsNoteSettings {
  enabled: boolean
  content: string
  injectionDepth: number
  role: AuthorsNoteRole
}

export const AUTHORS_NOTE_DEFAULTS: AuthorsNoteSettings = {
  enabled: false,
  content: '',
  injectionDepth: 4,
  role: 'system',
}

export const AUTHORS_NOTE_MAX_DEPTH = 200

export function normalizeAuthorsNote(
  raw?: Partial<AuthorsNoteSettings> | null,
): AuthorsNoteSettings {
  const content = typeof raw?.content === 'string' ? raw.content : ''
  let injectionDepth =
    typeof raw?.injectionDepth === 'number' && Number.isFinite(raw.injectionDepth)
      ? Math.floor(raw.injectionDepth)
      : AUTHORS_NOTE_DEFAULTS.injectionDepth
  injectionDepth = Math.max(0, Math.min(AUTHORS_NOTE_MAX_DEPTH, injectionDepth))
  const role: AuthorsNoteRole = raw?.role === 'user' ? 'user' : 'system'
  const trimmed = content.trim()
  const enabled = raw?.enabled === true && trimmed.length > 0
  return {
    enabled,
    content: trimmed ? content : '',
    injectionDepth,
    role,
  }
}

export function authorsNoteFromIndex(
  idx: Record<string, unknown>,
): AuthorsNoteSettings {
  const raw = idx.authorsNote
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...AUTHORS_NOTE_DEFAULTS }
  }
  return normalizeAuthorsNote(raw as Partial<AuthorsNoteSettings>)
}

export function authorsNoteComposerActive(note: AuthorsNoteSettings): boolean {
  return note.enabled && note.content.trim().length > 0
}
