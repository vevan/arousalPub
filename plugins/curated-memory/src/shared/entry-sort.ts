import type { PluginHost } from '../types.js'

export async function applyCuratedLorebookEntrySort(
  host: PluginHost,
  lorebookId: string,
  sidecarEntryIds: Record<string, string>,
  sidecarConfigIds: string[],
): Promise<boolean> {
  const id = lorebookId.trim()
  if (!id) return false
  await host.lorebook.reorderCurated(id, {
    sidecarEntryIds,
    sidecarIds: sidecarConfigIds,
  })
  return true
}
