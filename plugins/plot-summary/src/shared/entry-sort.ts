import type { PluginHost } from '../types.js'
import {
  computePlotSummaryApplyOrderLayout,
  planRenumberMemoryMemosByTurn,
} from './lorebook-sort.js'

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

/**
 * 按 turn 重排 memory 纪要编号与组内顺序，并写回 lastMemoIndex。
 * 与 sidecar 无关。
 */
export async function renumberMemoryMemosByTurn(
  host: PluginHost,
  lorebookId: string,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): Promise<{ changedTitles: number; lastMemoIndex: number | null }> {
  const id = lorebookId.trim()
  if (!id) return { changedTitles: 0, lastMemoIndex: null }

  const lb = await host.lorebook.get(id)
  const entries = (Array.isArray(lb.entries) ? lb.entries : []).map((e) => ({
    id: String(e.id),
    groupId: typeof e.groupId === 'string' ? e.groupId : '',
    title: typeof e.title === 'string' ? e.title : '',
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
  }))

  const plan = planRenumberMemoryMemosByTurn(entries, sidecarEntryIds)
  for (const p of plan.titlePatches) {
    await host.lorebook.patchEntry(id, p.id, { title: p.title })
  }

  // Re-fetch titles after patches for sort layout, or merge patches into local copy
  const byId = new Map(entries.map((e) => [e.id, { ...e }]))
  for (const p of plan.titlePatches) {
    const cur = byId.get(p.id)
    if (cur) cur.title = p.title
  }
  const groups = Array.isArray(lb.groups) ? lb.groups : []
  const { entriesByGroup } = computePlotSummaryApplyOrderLayout(
    {
      groups: groups.map((g) => ({
        id: String(g.id),
        order: typeof g.order === 'number' ? g.order : 0,
      })),
      entries: [...byId.values()],
    },
    sidecarEntryIds,
    sidecarConfigIds,
  )
  await host.lorebook.applyOrder(id, {
    scope: 'full',
    entriesByGroup,
  })

  await host.conversation.patchPluginSettings({
    lastMemoIndex: plan.lastMemoIndex,
  })

  return {
    changedTitles: plan.titlePatches.length,
    lastMemoIndex: plan.lastMemoIndex,
  }
}
