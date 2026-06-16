import { resolveTurnPluginEntriesFromAssistant } from './plugin-host.js'
import type { TurnReceive } from './chat-storage.js'
import {
  attachReceiveIdToTurnPluginEntries,
  mergeTurnPluginEntry,
  removeTraceKeeperPluginForReceive,
} from './turn-plugin-utils.js'

/** PATCH / 编辑后：按各 receive 正文重解析 trace-keeper 并同步 turn.plugins[] */
export async function buildSyncedTurnPluginsFromReceives(
  existingPlugins: unknown[] | undefined,
  receives: Pick<TurnReceive, 'id' | 'content'>[],
  conversationId: string,
): Promise<unknown[]> {
  let plugins = Array.isArray(existingPlugins) ? [...existingPlugins] : []

  for (const rec of receives) {
    const receiveId = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!receiveId) continue
    const content = typeof rec.content === 'string' ? rec.content : ''

    const resolved = await resolveTurnPluginEntriesFromAssistant(content, {
      conversationId,
    })
    const attached =
      attachReceiveIdToTurnPluginEntries(resolved, receiveId) ?? []

    if (attached.length > 0) {
      for (const entry of attached) {
        plugins = mergeTurnPluginEntry(plugins, entry)
      }
    } else {
      plugins = removeTraceKeeperPluginForReceive(plugins, receiveId)
    }
  }

  return plugins
}
