import { LOREBOOK_ID_RE, readLorebookById, writeLorebook } from './lorebook-file.js'
import type { Lorebook } from './lorebook-types.js'
import { computeCuratedEntryOrders } from './plugin-curated-lorebook.js'

export interface ReorderCuratedLorebookInput {
  lorebookId: string
  sidecarEntryIds?: Record<string, string>
  sidecarConfigIds?: string[]
}

export type ReorderCuratedLorebookResult =
  | { ok: true; lorebook: Lorebook; changed: number; savedAt: string }
  | { ok: false; code: string }

function normalizeSidecarEntryIds(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
      out[k.trim()] = v.trim()
    }
  }
  return out
}

function normalizeSidecarConfigIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
}

export async function runReorderCuratedLorebookEntries(
  req: ReorderCuratedLorebookInput,
): Promise<ReorderCuratedLorebookResult> {
  const lorebookId =
    typeof req.lorebookId === 'string' ? req.lorebookId.trim() : ''
  if (!lorebookId || !LOREBOOK_ID_RE.test(lorebookId)) {
    return { ok: false, code: 'lorebook_id_required' }
  }

  const lb = await readLorebookById(lorebookId)
  if (!lb) return { ok: false, code: 'lorebook_not_found' }
  if (!lb.entries.length) {
    return { ok: true, lorebook: lb, changed: 0, savedAt: lb.updatedAt }
  }

  const sidecarEntryIds = normalizeSidecarEntryIds(req.sidecarEntryIds)
  const sidecarConfigIds = normalizeSidecarConfigIds(req.sidecarConfigIds)
  const orders = computeCuratedEntryOrders(lb, sidecarEntryIds, sidecarConfigIds)

  let changed = 0
  const t = new Date().toISOString()
  const entries = lb.entries.map((e) => {
    const nextOrder = orders.get(e.id)
    if (typeof nextOrder !== 'number' || nextOrder === e.order) return e
    changed += 1
    return { ...e, order: nextOrder, updatedAt: t }
  })

  if (changed === 0) {
    return { ok: true, lorebook: lb, changed: 0, savedAt: lb.updatedAt }
  }

  const savedAt = await writeLorebook({ ...lb, entries, updatedAt: t })
  return {
    ok: true,
    lorebook: { ...lb, entries, updatedAt: savedAt },
    changed,
    savedAt,
  }
}
