/** Historian 资料库条目分类与组内排序（plot-summary 插件算法） */

export const PLOT_SUMMARY_TURN_RANGE_SUFFIX_RE = /\[(\d+)-(\d+)\]$/
export const PLOT_SUMMARY_MEMO_PREFIX_RE = /^\[MEMO-(\d+)\]-/

export type PlotSummaryEntryKind = 'other' | 'sidecar' | 'summary'

export interface PlotSummaryLoreEntry {
  id: string
  groupId: string
  title: string
  createdAt?: string
}

export interface PlotSummaryLorebookShape {
  groups: { id: string; order: number }[]
  entries: PlotSummaryLoreEntry[]
}

export function parseTurnRangeSuffix(
  title: string,
): { start: number; end: number } | null {
  const t = (title ?? '').trim()
  const m = t.match(PLOT_SUMMARY_TURN_RANGE_SUFFIX_RE)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return { start, end }
}

export function parseMemoIndex(title: string): number | null {
  const m = (title ?? '').trim().match(PLOT_SUMMARY_MEMO_PREFIX_RE)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function classifyPlotSummaryEntry(
  entry: { id: string; title: string },
  sidecarEntryIdSet: Set<string>,
): PlotSummaryEntryKind {
  if (sidecarEntryIdSet.has(entry.id)) return 'sidecar'
  if (parseTurnRangeSuffix(entry.title)) return 'summary'
  return 'other'
}

function kindRank(kind: PlotSummaryEntryKind): number {
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

export function sortPlotSummaryEntriesInGroup<T extends PlotSummaryLoreEntry>(
  entries: T[],
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): T[] {
  const sidecarSet = new Set(Object.values(sidecarEntryIds))
  return entries.slice().sort((a, b) => {
    const ka = classifyPlotSummaryEntry(a, sidecarSet)
    const kb = classifyPlotSummaryEntry(b, sidecarSet)
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
    const ma = parseMemoIndex(a.title)
    const mb = parseMemoIndex(b.title)
    if (ma !== null && mb !== null && ma !== mb) return ma - mb
    return a.id.localeCompare(b.id)
  })
}

/** 整本 layout：每个 group 列全条目 id（按 Historian 规则排序）；不改 group 顺序时不返回 groupIds */
export function computePlotSummaryApplyOrderLayout(
  lb: PlotSummaryLorebookShape,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): { entriesByGroup: Record<string, string[]> } {
  const groups = lb.groups.slice().sort((a, b) => a.order - b.order)
  const entriesByGroup: Record<string, string[]> = {}
  for (const g of groups) {
    const inGroup = lb.entries.filter((e) => e.groupId === g.id)
    entriesByGroup[g.id] = sortPlotSummaryEntriesInGroup(
      inGroup,
      sidecarEntryIds,
      sidecarConfigIds,
    ).map((e) => e.id)
  }
  return { entriesByGroup }
}

export function pickRecentSummaryEntriesBeforeTurn<T extends PlotSummaryLoreEntry>(
  entries: T[],
  beforeTurn: number,
  sidecarEntryIdSet: Set<string>,
  limit: number,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): T[] {
  const summaries = entries.filter((e) => {
    if (classifyPlotSummaryEntry(e, sidecarEntryIdSet) !== 'summary') return false
    const range = parseTurnRangeSuffix(e.title)
    if (!range) return false
    return range.end < beforeTurn
  })
  const sorted = sortPlotSummaryEntriesInGroup(
    summaries,
    sidecarEntryIds,
    sidecarConfigIds,
  )
  if (limit <= 0) return []
  return sorted.slice(-limit)
}
