/** 新建 MEMO 落组：按 group.order 取首/末组 */

export type SummaryGroupPlacement = 'first' | 'last'

export function parseSummaryGroupPlacement(raw: unknown): SummaryGroupPlacement {
  return raw === 'first' ? 'first' : 'last'
}

export function resolveSummaryTargetGroupId(
  groups: { id: string; order: number }[],
  placement: SummaryGroupPlacement,
): string | undefined {
  if (!groups.length) return undefined
  const sorted = groups
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const g = placement === 'first' ? sorted[0] : sorted[sorted.length - 1]
  const id = typeof g?.id === 'string' ? g.id.trim() : ''
  return id || undefined
}
