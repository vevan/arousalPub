import { isLorebookEntryMissingError } from './errors.js'
import { asString, entryKeys } from './shared/utils.js'
import type { PendingLorebookCreate } from './batch-write.js'
import type { MergedSettings, PluginHost, SidecarConfig } from './types.js'

export async function writeSidecarEntry(
  host: PluginHost,
  settings: MergedSettings,
  sidecarEntryIds: Record<string, string>,
  sc: SidecarConfig,
  reviewed: { title: string; content: string; keywords: string[] },
  sidecarKeys: string[],
  pendingCreates?: PendingLorebookCreate[],
) {
  const body = {
    title: sc.name,
    content: reviewed.content,
    keys: sidecarKeys,
    triggerMode: sc.triggerMode || 'constant',
    priority: typeof sc.priority === 'number' ? sc.priority : 90,
  }
  let entryId = asString(sidecarEntryIds[sc.id])
  if (entryId) {
    try {
      await host.lorebook.patchEntry(settings.targetLorebookId, entryId, body)
      return entryId
    } catch (e) {
      if (!isLorebookEntryMissingError(e)) throw e
      delete sidecarEntryIds[sc.id]
      entryId = ''
    }
  }
  if (pendingCreates) {
    pendingCreates.push({ body, sidecarId: sc.id })
    return ''
  }
  const created = await host.lorebook.createEntry(settings.targetLorebookId, body)
  sidecarEntryIds[sc.id] = created.id
  return created.id
}

export { entryKeys }
