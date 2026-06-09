import type { PluginHost } from '../types.js'
import { computePlotSummaryApplyOrderLayout } from './lorebook-sort.js'

export async function applyPlotSummaryEntrySort(
  host: PluginHost,
  lorebookId: string,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): Promise<boolean> {
  const id = lorebookId.trim()
  if (!id) return false

  const lb = await host.lorebook.get(id)
  const groups = Array.isArray(lb.groups) ? lb.groups : []
  const entries = Array.isArray(lb.entries) ? lb.entries : []
  const { entriesByGroup } = computePlotSummaryApplyOrderLayout(
    {
      groups: groups.map((g) => ({
        id: String(g.id),
        order: typeof g.order === 'number' ? g.order : 0,
      })),
      entries: entries.map((e) => ({
        id: String(e.id),
        groupId: typeof e.groupId === 'string' ? e.groupId : '',
        title: typeof e.title === 'string' ? e.title : '',
        createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
      })),
    },
    sidecarEntryIds,
    sidecarConfigIds,
  )

  await host.lorebook.applyOrder(id, {
    scope: 'full',
    entriesByGroup,
  })
  return true
}
