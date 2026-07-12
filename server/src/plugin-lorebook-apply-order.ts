import {
  LOREBOOK_ID_RE,
  readLorebookById,
  runLorebookFileTask,
  writeLorebookUnsafe,
} from './lorebook-file.js'
import type { Lorebook } from './lorebook-types.js'

export type ApplyLorebookOrderScope = 'full' | 'partial'

export interface ApplyLorebookOrderRequest {
  scope?: ApplyLorebookOrderScope
  /** 组 id 有序列表；省略则保持现有 group.order */
  groupIds?: string[]
  /** 每组内条目 id 完整有序列表 */
  entriesByGroup?: Record<string, string[]>
}

export type ApplyLorebookOrderResult =
  | { ok: true; lorebook: Lorebook; changed: number; savedAt: string }
  | { ok: false; code: string }

function groupEntryIds(lb: Lorebook): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const g of lb.groups) {
    out.set(g.id, new Set())
  }
  for (const e of lb.entries) {
    const set = out.get(e.groupId)
    if (set) set.add(e.id)
  }
  return out
}

export function validateApplyLorebookOrderLayout(
  lb: Lorebook,
  req: ApplyLorebookOrderRequest,
): { ok: true } | { ok: false; code: string } {
  const scope: ApplyLorebookOrderScope = req.scope === 'full' ? 'full' : 'partial'
  const groupIds = Array.isArray(req.groupIds) ? req.groupIds : undefined
  const entriesByGroup =
    req.entriesByGroup && typeof req.entriesByGroup === 'object'
      ? req.entriesByGroup
      : undefined

  if (!groupIds?.length && !entriesByGroup) {
    return { ok: false, code: 'order_empty_request' }
  }

  const knownGroups = new Set(lb.groups.map((g) => g.id))
  const byGroup = groupEntryIds(lb)

  if (groupIds) {
    const seen = new Set<string>()
    for (const gid of groupIds) {
      if (typeof gid !== 'string' || !gid.trim()) {
        return { ok: false, code: 'order_unknown_group' }
      }
      const id = gid.trim()
      if (!knownGroups.has(id)) return { ok: false, code: 'order_unknown_group' }
      if (seen.has(id)) return { ok: false, code: 'order_duplicate_group' }
      seen.add(id)
    }
    if (scope === 'full' && seen.size !== knownGroups.size) {
      return { ok: false, code: 'order_incomplete' }
    }
  }

  if (!entriesByGroup) return { ok: true }

  const listedGroups = Object.keys(entriesByGroup)
  if (listedGroups.length === 0) {
    return { ok: false, code: 'order_empty_request' }
  }

  if (scope === 'full') {
    if (listedGroups.length !== knownGroups.size) {
      return { ok: false, code: 'order_incomplete' }
    }
    for (const gid of knownGroups) {
      if (!(gid in entriesByGroup)) {
        return { ok: false, code: 'order_incomplete' }
      }
    }
  }

  for (const [gid, rawList] of Object.entries(entriesByGroup)) {
    if (!knownGroups.has(gid)) return { ok: false, code: 'order_unknown_group' }
    if (!Array.isArray(rawList)) return { ok: false, code: 'order_invalid_entry_list' }

    const expected = byGroup.get(gid) ?? new Set<string>()
    const seen = new Set<string>()
    for (const rawId of rawList) {
      if (typeof rawId !== 'string' || !rawId.trim()) {
        return { ok: false, code: 'order_unknown_entry' }
      }
      const entryId = rawId.trim()
      if (!expected.has(entryId)) {
        return { ok: false, code: 'order_entry_group_mismatch' }
      }
      if (seen.has(entryId)) return { ok: false, code: 'order_duplicate_entry' }
      seen.add(entryId)
    }
    if (seen.size !== expected.size) {
      return { ok: false, code: 'order_incomplete' }
    }
  }

  return { ok: true }
}

export async function runApplyLorebookOrder(
  req: ApplyLorebookOrderRequest & { lorebookId: string },
): Promise<ApplyLorebookOrderResult> {
  const lorebookId =
    typeof req.lorebookId === 'string' ? req.lorebookId.trim() : ''
  if (!lorebookId || !LOREBOOK_ID_RE.test(lorebookId)) {
    return { ok: false, code: 'lorebook_id_required' }
  }

  return runLorebookFileTask(async () => {
    const lb = await readLorebookById(lorebookId)
    if (!lb) return { ok: false as const, code: 'lorebook_not_found' }

    const valid = validateApplyLorebookOrderLayout(lb, req)
    if (!valid.ok) return valid

    const t = new Date().toISOString()
    let changed = 0

    let groups = lb.groups
    if (Array.isArray(req.groupIds) && req.groupIds.length > 0) {
      const orderMap = new Map(
        req.groupIds.map((id, i) => [id.trim(), i] as const),
      )
      groups = lb.groups.map((g) => {
        const nextOrder = orderMap.get(g.id)
        if (typeof nextOrder !== 'number' || nextOrder === g.order) return g
        changed += 1
        return { ...g, order: nextOrder }
      })
    }

    let entries = lb.entries
    const entriesByGroup = req.entriesByGroup
    if (entriesByGroup && typeof entriesByGroup === 'object') {
      const orderMaps = new Map<string, Map<string, number>>()
      for (const [gid, ids] of Object.entries(entriesByGroup)) {
        const m = new Map<string, number>()
        ids.forEach((id, i) => m.set(id.trim(), i))
        orderMaps.set(gid, m)
      }
      entries = lb.entries.map((e) => {
        const m = orderMaps.get(e.groupId)
        if (!m) return e
        const nextOrder = m.get(e.id)
        if (typeof nextOrder !== 'number' || nextOrder === e.order) return e
        changed += 1
        return { ...e, order: nextOrder, updatedAt: t }
      })
    }

    if (changed === 0) {
      return { ok: true as const, lorebook: lb, changed: 0, savedAt: lb.updatedAt }
    }

    const savedAt = await writeLorebookUnsafe({
      ...lb,
      groups,
      entries,
      updatedAt: t,
    })
    return {
      ok: true as const,
      lorebook: { ...lb, groups, entries, updatedAt: savedAt },
      changed,
      savedAt,
    }
  })
}
