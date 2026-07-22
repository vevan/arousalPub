import { generateShortId } from './short-id.js'
import {
  readLorebookById,
  runLorebookFileTask,
  writeLorebookUnsafe,
  LOREBOOK_ID_RE,
} from './lorebook-file.js'
import {
  normalizeEntryPosition,
  normalizeEntryTriggerFields,
  resolveEntryTriggerMode,
} from './lorebook-entry-utils.js'
import type {
  Lorebook,
  LorebookEntry,
  LorebookEntryPosition,
  LorebookTriggerMode,
} from './lorebook-types.js'

export const LOREBOOK_ENTRY_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export interface LorebookEntryCreateBody {
  groupId?: string
  title: string
  content: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  position?: LorebookEntryPosition
  priority?: number
  order?: number
}

export interface LorebookEntryPatchBody {
  title?: string
  content?: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  position?: LorebookEntryPosition
  priority?: number
  order?: number
  groupId?: string
}

function defaultGroupId(groups: { id: string; order: number }[]): string {
  if (groups.length === 0) throw new Error('世界书缺少分组')
  const sorted = [...groups].sort((a, b) => a.order - b.order)
  return sorted[0].id
}

function nextEntryOrder(entries: LorebookEntry[], groupId: string): number {
  const inGroup = entries.filter((e) => e.groupId === groupId)
  if (inGroup.length === 0) return 0
  return Math.max(...inGroup.map((e) => e.order)) + 1
}

function normalizeKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

function resolveTriggerFromBody(body: {
  constant?: boolean
  triggerMode?: LorebookTriggerMode
}): LorebookTriggerMode {
  if (
    body.triggerMode === 'keyword' ||
    body.triggerMode === 'constant' ||
    body.triggerMode === 'vector'
  ) {
    return body.triggerMode
  }
  if (body.constant === true) return 'constant'
  return 'keyword'
}

export type LorebookEntryWriteResult = {
  entry: LorebookEntry
  savedAt: string
  lorebook: Lorebook
}

export async function createLorebookEntry(
  lorebookId: string,
  body: LorebookEntryCreateBody,
): Promise<LorebookEntryWriteResult | null> {
  if (!LOREBOOK_ID_RE.test(lorebookId)) return null
  return runLorebookFileTask(async () => {
    const lb = await readLorebookById(lorebookId)
    if (!lb) return null

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const content = typeof body.content === 'string' ? body.content : ''
    if (!title) throw new Error('条目缺少 title')

    const groupIds = new Set(lb.groups.map((g) => g.id))
    const groupId =
      typeof body.groupId === 'string' && groupIds.has(body.groupId)
        ? body.groupId
        : defaultGroupId(lb.groups)

    const triggerMode = resolveTriggerFromBody(body)
    const position = normalizeEntryPosition(body.position) ?? 'after_char'
    const t = new Date().toISOString()
    const entry: LorebookEntry = normalizeEntryTriggerFields({
      id: `entry-${generateShortId()}`,
      groupId,
      title,
      content,
      comment: typeof body.comment === 'string' ? body.comment : undefined,
      enabled: body.enabled !== false,
      order:
        typeof body.order === 'number' && Number.isFinite(body.order)
          ? body.order
          : nextEntryOrder(lb.entries, groupId),
      keys: normalizeKeys(body.keys),
      constant: triggerMode === 'constant',
      triggerMode,
      position,
      priority:
        typeof body.priority === 'number' && Number.isFinite(body.priority)
          ? body.priority
          : 100,
      createdAt: t,
      updatedAt: t,
    })

    const lorebook: Lorebook = {
      ...lb,
      entries: [...lb.entries, entry],
      updatedAt: t,
    }
    const savedAt = await writeLorebookUnsafe(lorebook)
    return { entry, savedAt, lorebook: { ...lorebook, updatedAt: savedAt } }
  })
}

/** 单次读盘 + 写盘，批量创建条目（剧情纪要等多条落盘场景） */
export async function createLorebookEntriesBatch(
  lorebookId: string,
  bodies: LorebookEntryCreateBody[],
): Promise<{ entries: LorebookEntry[]; savedAt: string; lorebook: Lorebook } | null> {
  if (!LOREBOOK_ID_RE.test(lorebookId)) return null
  if (!bodies.length) return null
  return runLorebookFileTask(async () => {
    const lb = await readLorebookById(lorebookId)
    if (!lb) return null

    const t = new Date().toISOString()
    const groupIds = new Set(lb.groups.map((g) => g.id))
    const newEntries: LorebookEntry[] = []
    let workingEntries = [...lb.entries]

    for (const body of bodies) {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const content = typeof body.content === 'string' ? body.content : ''
      if (!title) throw new Error('条目缺少 title')

      const groupId =
        typeof body.groupId === 'string' && groupIds.has(body.groupId)
          ? body.groupId
          : defaultGroupId(lb.groups)

      const triggerMode = resolveTriggerFromBody(body)
      const position = normalizeEntryPosition(body.position) ?? 'after_char'
      const entry: LorebookEntry = normalizeEntryTriggerFields({
        id: `entry-${generateShortId()}`,
        groupId,
        title,
        content,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
        enabled: body.enabled !== false,
        order:
          typeof body.order === 'number' && Number.isFinite(body.order)
            ? body.order
            : nextEntryOrder(workingEntries, groupId),
        keys: normalizeKeys(body.keys),
        constant: triggerMode === 'constant',
        triggerMode,
        position,
        priority:
          typeof body.priority === 'number' && Number.isFinite(body.priority)
            ? body.priority
            : 100,
        createdAt: t,
        updatedAt: t,
      })
      newEntries.push(entry)
      workingEntries.push(entry)
    }

    const lorebook: Lorebook = {
      ...lb,
      entries: workingEntries,
      updatedAt: t,
    }
    const savedAt = await writeLorebookUnsafe(lorebook)
    return {
      entries: newEntries,
      savedAt,
      lorebook: { ...lorebook, updatedAt: savedAt },
    }
  })
}

export async function patchLorebookEntry(
  lorebookId: string,
  entryId: string,
  body: LorebookEntryPatchBody,
): Promise<LorebookEntryWriteResult | null> {
  if (!LOREBOOK_ID_RE.test(lorebookId)) return null
  if (!LOREBOOK_ENTRY_ID_RE.test(entryId)) return null
  return runLorebookFileTask(async () => {
    const lb = await readLorebookById(lorebookId)
    if (!lb) return null

    const idx = lb.entries.findIndex((e) => e.id === entryId)
    if (idx < 0) return null

    const prev = lb.entries[idx]
    const groupIds = new Set(lb.groups.map((g) => g.id))
    const t = new Date().toISOString()

    let next: LorebookEntry = { ...prev, updatedAt: t }

    if (typeof body.title === 'string') next.title = body.title.trim()
    if (typeof body.content === 'string') next.content = body.content
    if (body.comment !== undefined) {
      next.comment = typeof body.comment === 'string' ? body.comment : undefined
    }
    if (typeof body.enabled === 'boolean') next.enabled = body.enabled
    if (typeof body.order === 'number' && Number.isFinite(body.order)) {
      next.order = body.order
    }
    if (body.keys !== undefined) next.keys = normalizeKeys(body.keys)
    if (typeof body.priority === 'number' && Number.isFinite(body.priority)) {
      next.priority = body.priority
    }
    if (body.position !== undefined) {
      const pos = normalizeEntryPosition(body.position)
      if (pos) next.position = pos
    }
    if (typeof body.groupId === 'string' && groupIds.has(body.groupId)) {
      next.groupId = body.groupId
    }

    if (body.triggerMode !== undefined || body.constant !== undefined) {
      const mode = resolveTriggerFromBody({
        constant: body.constant ?? prev.constant,
        triggerMode: body.triggerMode ?? resolveEntryTriggerMode(prev),
      })
      next.triggerMode = mode
      next.constant = mode === 'constant'
    }

    next = normalizeEntryTriggerFields(next)
    const entries = [...lb.entries]
    entries[idx] = next

    const lorebook: Lorebook = {
      ...lb,
      entries,
      updatedAt: t,
    }
    const savedAt = await writeLorebookUnsafe(lorebook)
    return { entry: next, savedAt, lorebook: { ...lorebook, updatedAt: savedAt } }
  })
}
