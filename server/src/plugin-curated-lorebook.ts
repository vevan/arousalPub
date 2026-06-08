import type { LorebookEntry, LorebookGroup } from './lorebook-types.js'

export const TURN_RANGE_SUFFIX_RE = /-(\d+)-(\d+)$/

export type CuratedEntryKind = 'other' | 'sidecar' | 'summary'

export function parseTurnRangeSuffix(title: string): { start: number; end: number } | null {
  const t = (title ?? '').trim()
  const m = t.match(TURN_RANGE_SUFFIX_RE)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return { start, end }
}

export function classifyCuratedEntry(
  entry: { id: string; title: string },
  sidecarEntryIdSet: Set<string>,
): CuratedEntryKind {
  if (sidecarEntryIdSet.has(entry.id)) return 'sidecar'
  if (parseTurnRangeSuffix(entry.title)) return 'summary'
  return 'other'
}

function kindRank(kind: CuratedEntryKind): number {
  if (kind === 'other') return 0
  if (kind === 'sidecar') return 1
  return 2
}

function sidecarConfigIndex(
  entryId: string,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): number {
  for (let i = 0; i < sidecarConfigIds.length; i++) {
    const cfgId = sidecarConfigIds[i]
    if (sidecarEntryIds[cfgId] === entryId) return i
  }
  return 9999
}

export function sortCuratedEntriesInGroup(
  entries: LorebookEntry[],
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): LorebookEntry[] {
  const sidecarSet = new Set(Object.values(sidecarEntryIds))
  return entries.slice().sort((a, b) => {
    const ka = classifyCuratedEntry(a, sidecarSet)
    const kb = classifyCuratedEntry(b, sidecarSet)
    const dr = kindRank(ka) - kindRank(kb)
    if (dr !== 0) return dr

    if (ka === 'other') {
      const ca = a.createdAt ?? ''
      const cb = b.createdAt ?? ''
      if (ca !== cb) return ca < cb ? -1 : 1
      return a.id.localeCompare(b.id)
    }

    if (ka === 'sidecar') {
      return (
        sidecarConfigIndex(a.id, sidecarEntryIds, sidecarConfigIds) -
        sidecarConfigIndex(b.id, sidecarEntryIds, sidecarConfigIds)
      )
    }

    const ra = parseTurnRangeSuffix(a.title)
    const rb = parseTurnRangeSuffix(b.title)
    if (!ra && !rb) return a.id.localeCompare(b.id)
    if (!ra) return 1
    if (!rb) return -1
    if (ra.start !== rb.start) return ra.start - rb.start
    if (ra.end !== rb.end) return ra.end - rb.end
    return a.id.localeCompare(b.id)
  })
}

export function computeCuratedEntryOrders(lb: {
  groups: LorebookGroup[]
  entries: LorebookEntry[]
}, sidecarEntryIds: Record<string, string>, sidecarConfigIds: string[]): Map<string, number> {
  const groupOrder = new Map(
    lb.groups
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((g, i) => [g.id, i]),
  )
  const byGroup = new Map<string, LorebookEntry[]>()
  for (const e of lb.entries) {
    const list = byGroup.get(e.groupId) ?? []
    list.push(e)
    byGroup.set(e.groupId, list)
  }

  const out = new Map<string, number>()
  const groupIds = [...byGroup.keys()].sort(
    (a, b) => (groupOrder.get(a) ?? 0) - (groupOrder.get(b) ?? 0),
  )
  for (const gid of groupIds) {
    const sorted = sortCuratedEntriesInGroup(
      byGroup.get(gid) ?? [],
      sidecarEntryIds,
      sidecarConfigIds,
    )
    sorted.forEach((e, i) => out.set(e.id, i))
  }
  return out
}

export function buildPreviousSummariesBlock(
  entries: { title: string; content: string }[],
): string {
  if (entries.length === 0) return ''
  const body = entries
    .map((e) => {
      const title = e.title.trim()
      const content = (e.content ?? '').trim()
      return `## ${title}\n${content}`
    })
    .join('\n\n')
  return `<previous-summaries readonly>\n${body}\n</previous-summaries>\n\n`
}

export function buildSidecarsBlock(
  entries: { title: string; content: string }[],
): string {
  if (entries.length === 0) return ''
  const body = entries
    .map((e) => {
      const title = e.title.trim()
      const content = (e.content ?? '').trim()
      return `## ${title}\n${content}`
    })
    .join('\n\n')
  return `<sidecars readonly>\n${body}\n</sidecars>\n\n`
}

export function buildContextHistoryBlock(transcript: string): string {
  const body = (transcript ?? '').trim()
  if (!body) return ''
  return `<context-history readonly>\n${body}\n</context-history>\n\n`
}

export function buildHistoryBlock(transcript: string): string {
  const body = (transcript ?? '').trim()
  if (!body) return ''
  return `<history>\n${body}\n</history>`
}

/** 取结束轮次严格早于 beforeTurn 的最近 N 条剧情摘要（手动/自动摘要共用） */
export function pickRecentSummaryEntriesBeforeTurn(
  entries: LorebookEntry[],
  beforeTurn: number,
  sidecarEntryIdSet: Set<string>,
  limit: number,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): LorebookEntry[] {
  const summaries = entries.filter((e) => {
    if (classifyCuratedEntry(e, sidecarEntryIdSet) !== 'summary') return false
    const range = parseTurnRangeSuffix(e.title)
    if (!range) return false
    return range.end < beforeTurn
  })
  const sorted = sortCuratedEntriesInGroup(
    summaries,
    sidecarEntryIds,
    sidecarConfigIds,
  )
  if (limit <= 0) return []
  return sorted.slice(-limit)
}

/** @deprecated 使用 pickRecentSummaryEntriesBeforeTurn */
export function pickRecentSummaryEntries(
  entries: LorebookEntry[],
  sidecarEntryIdSet: Set<string>,
  limit: number,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): LorebookEntry[] {
  return pickRecentSummaryEntriesBeforeTurn(
    entries,
    Number.POSITIVE_INFINITY,
    sidecarEntryIdSet,
    limit,
    sidecarEntryIds,
    sidecarConfigIds,
  )
}

/** history 块起始轮：含 fromTurn，并向前最多 N 轮（N=0 则仅 fromTurn） */
export function resolveContextHistoryStart(
  fromTurn: number,
  contextTurns: number,
): number {
  const n =
    typeof contextTurns === 'number' && Number.isFinite(contextTurns)
      ? Math.max(0, Math.round(contextTurns))
      : 0
  if (n <= 0) return fromTurn
  return Math.max(0, fromTurn - n + 1)
}
