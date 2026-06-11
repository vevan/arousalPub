/** 会话级 Author's Note（作者注） */

export type AuthorsNoteRole = 'system' | 'user'

export interface AuthorsNoteSettings {
  enabled: boolean
  content: string
  injectionDepth: number
  role: AuthorsNoteRole
}

export type AuthorsNotePatch = Partial<AuthorsNoteSettings>

export const AUTHORS_NOTE_DEFAULTS: AuthorsNoteSettings = {
  enabled: false,
  content: '',
  injectionDepth: 4,
  role: 'system',
}

export const AUTHORS_NOTE_MAX_DEPTH = 200

export function normalizeAuthorsNote(
  raw?: AuthorsNotePatch | null,
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

export function mergeAuthorsNote(
  existing: AuthorsNotePatch | undefined,
  patch: AuthorsNotePatch,
): AuthorsNoteSettings {
  const base = hasAuthorsNoteStored(existing)
    ? normalizeAuthorsNote(existing)
    : AUTHORS_NOTE_DEFAULTS
  return normalizeAuthorsNote({ ...base, ...patch })
}

export function hasAuthorsNoteStored(
  raw?: AuthorsNotePatch | null,
): boolean {
  return raw != null && typeof raw === 'object' && !Array.isArray(raw)
}

/** 组装注入：enabled 且正文非空 */
export function authorsNoteForInjection(
  raw?: AuthorsNotePatch | null,
): Pick<AuthorsNoteSettings, 'content' | 'injectionDepth' | 'role'> | null {
  if (!hasAuthorsNoteStored(raw)) return null
  const note = normalizeAuthorsNote(raw)
  if (!note.enabled || !note.content.trim()) return null
  return {
    content: note.content.trim(),
    injectionDepth: note.injectionDepth,
    role: note.role,
  }
}

/** 宏 `{{authorsNote}}`：仅正文，未启用或空则 '' */
export function authorsNoteMacroText(
  raw?: AuthorsNotePatch | null,
): string {
  return authorsNoteForInjection(raw)?.content ?? ''
}

/** 用户全局默认作者注模板（新会话 seed + 宏 {{defaultAuthorsNote}}） */
export interface DefaultAuthorsNoteTemplate {
  content: string
  injectionDepth: number
  role: AuthorsNoteRole
  /** content 非空时，新会话 seed 是否默认 enabled；缺省 true */
  enabledForNewChats: boolean
}

export type DefaultAuthorsNotePatch = Partial<{
  content: string
  injectionDepth: number
  role: AuthorsNoteRole
  enabledForNewChats: boolean
}>

export const DEFAULT_AUTHORS_NOTE_TEMPLATE: DefaultAuthorsNoteTemplate = {
  content: '',
  injectionDepth: 4,
  role: 'system',
  enabledForNewChats: true,
}

export function normalizeDefaultAuthorsNoteTemplate(
  raw?: DefaultAuthorsNotePatch | null,
): DefaultAuthorsNoteTemplate {
  const content = typeof raw?.content === 'string' ? raw.content : ''
  let injectionDepth =
    typeof raw?.injectionDepth === 'number' && Number.isFinite(raw.injectionDepth)
      ? Math.floor(raw.injectionDepth)
      : DEFAULT_AUTHORS_NOTE_TEMPLATE.injectionDepth
  injectionDepth = Math.max(0, Math.min(AUTHORS_NOTE_MAX_DEPTH, injectionDepth))
  const role: AuthorsNoteRole = raw?.role === 'user' ? 'user' : 'system'
  const enabledForNewChats = raw?.enabledForNewChats !== false
  const trimmed = content.trim()
  return {
    content: trimmed ? content : '',
    injectionDepth,
    role,
    enabledForNewChats,
  }
}

/** 宏 `{{defaultAuthorsNote}}`：模板正文（与会话 enabled 无关） */
export function defaultAuthorsNoteMacroText(
  raw?: DefaultAuthorsNotePatch | null,
): string {
  const t = normalizeDefaultAuthorsNoteTemplate(raw)
  return t.content.trim() ? t.content : ''
}

/** 新会话 seed：模板 content 空则 null */
export function seedAuthorsNoteFromTemplate(
  raw?: DefaultAuthorsNotePatch | null,
): AuthorsNoteSettings | null {
  const t = normalizeDefaultAuthorsNoteTemplate(raw)
  if (!t.content.trim()) return null
  return normalizeAuthorsNote({
    enabled: t.enabledForNewChats,
    content: t.content,
    injectionDepth: t.injectionDepth,
    role: t.role,
  })
}

export function parseDefaultAuthorsNotePatch(
  raw: unknown,
):
  | { ok: true; patch: DefaultAuthorsNotePatch | null }
  | { ok: false; error: string } {
  if (raw === null) {
    return { ok: true, patch: null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'default_authors_note_invalid' }
  }
  const o = raw as Record<string, unknown>
  const patch: DefaultAuthorsNotePatch = {}
  if (Object.prototype.hasOwnProperty.call(o, 'content')) {
    if (typeof o.content !== 'string') {
      return { ok: false, error: 'authors_note_content_string' }
    }
    patch.content = o.content
  }
  if (Object.prototype.hasOwnProperty.call(o, 'injectionDepth')) {
    if (typeof o.injectionDepth !== 'number' || !Number.isFinite(o.injectionDepth)) {
      return { ok: false, error: 'authors_note_injection_depth_number' }
    }
    patch.injectionDepth = o.injectionDepth
  }
  if (Object.prototype.hasOwnProperty.call(o, 'role')) {
    if (o.role !== 'system' && o.role !== 'user') {
      return { ok: false, error: 'authors_note_role_invalid' }
    }
    patch.role = o.role
  }
  if (Object.prototype.hasOwnProperty.call(o, 'enabledForNewChats')) {
    if (typeof o.enabledForNewChats !== 'boolean') {
      return { ok: false, error: 'default_authors_note_enabled_for_new_chats_boolean' }
    }
    patch.enabledForNewChats = o.enabledForNewChats
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'global_default_authors_note_requires_field' }
  }
  return { ok: true, patch }
}

export function parseAuthorsNotePatch(
  raw: unknown,
): { ok: true; patch: AuthorsNotePatch | null } | { ok: false; error: string } {
  if (raw === null) {
    return { ok: true, patch: null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'authors_note_invalid' }
  }
  const o = raw as Record<string, unknown>
  const patch: AuthorsNotePatch = {}
  if (Object.prototype.hasOwnProperty.call(o, 'enabled')) {
    if (typeof o.enabled !== 'boolean') {
      return { ok: false, error: 'authors_note_enabled_boolean' }
    }
    patch.enabled = o.enabled
  }
  if (Object.prototype.hasOwnProperty.call(o, 'content')) {
    if (typeof o.content !== 'string') {
      return { ok: false, error: 'authors_note_content_string' }
    }
    patch.content = o.content
  }
  if (Object.prototype.hasOwnProperty.call(o, 'injectionDepth')) {
    if (typeof o.injectionDepth !== 'number' || !Number.isFinite(o.injectionDepth)) {
      return { ok: false, error: 'authors_note_injection_depth_number' }
    }
    patch.injectionDepth = o.injectionDepth
  }
  if (Object.prototype.hasOwnProperty.call(o, 'role')) {
    if (o.role !== 'system' && o.role !== 'user') {
      return { ok: false, error: 'authors_note_role_invalid' }
    }
    patch.role = o.role
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'authors_note_requires_field' }
  }
  return { ok: true, patch }
}
