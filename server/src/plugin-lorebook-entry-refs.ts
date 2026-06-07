import { readLorebookById } from './lorebook-file.js'
import { asPluginString } from './plugin-summarize-format.js'

export interface NormalizeEntryRefsRequest {
  lorebookId: string
  entryIds: Record<string, string>
  validKeys: string[]
}

export type NormalizeEntryRefsResult =
  | { ok: true; entryIds: Record<string, string> }
  | { ok: false; code: string }

export async function runNormalizeLorebookEntryRefs(
  req: NormalizeEntryRefsRequest,
): Promise<NormalizeEntryRefsResult> {
  const lorebookId =
    typeof req.lorebookId === 'string' ? req.lorebookId.trim() : ''
  if (!lorebookId) {
    return { ok: false, code: 'lorebook_id_required' }
  }

  const validKeys = Array.isArray(req.validKeys)
    ? req.validKeys
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    : []
  const configured = new Set(validKeys)

  const rawIds =
    req.entryIds && typeof req.entryIds === 'object' && !Array.isArray(req.entryIds)
      ? req.entryIds
      : {}

  const out: Record<string, string> = {}
  for (const [key, rawId] of Object.entries(rawIds)) {
    if (!configured.has(key)) continue
    const id = asPluginString(rawId)
    if (id) out[key] = id
  }

  if (validKeys.length === 0) {
    return { ok: true, entryIds: out }
  }

  let lb
  try {
    lb = await readLorebookById(lorebookId)
  } catch {
    return { ok: true, entryIds: out }
  }

  if (!lb) {
    return { ok: false, code: 'lorebook_not_found' }
  }

  const existing = new Set((lb.entries ?? []).map((e) => e.id))
  for (const key of validKeys) {
    const id = asPluginString(out[key])
    if (id && !existing.has(id)) {
      delete out[key]
    }
  }

  return { ok: true, entryIds: out }
}
