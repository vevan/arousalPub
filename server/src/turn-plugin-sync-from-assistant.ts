import { resolveTurnPluginEntriesFromAssistant } from './plugin-host.js'
import type { TurnReceive } from './chat-storage.js'
import type { TurnPluginEntry } from './plugin-types.js'
import {
  attachReceiveIdToTurnPluginEntries,
  mergeTurnPluginEntry,
  removeTurnPluginEntriesForReceive,
} from './turn-plugin-utils.js'
import { getReceiveScopedAssistantResolvePluginIds } from './plugin-system/turn-plugin-policies.js'

/** PATCH / 编辑后：按各 receive 正文重解析插件 turn 快照并同步 turn.plugins[] */
export async function buildSyncedTurnPluginsFromReceives(
  existingPlugins: unknown[] | undefined,
  receives: Pick<TurnReceive, 'id' | 'content'>[],
  conversationId: string,
): Promise<TurnPluginEntry[]> {
  let plugins: TurnPluginEntry[] = Array.isArray(existingPlugins)
    ? (existingPlugins as TurnPluginEntry[])
    : []

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
        plugins = mergeTurnPluginEntry(plugins, entry) as TurnPluginEntry[]
      }
    } else {
      for (const pluginId of getReceiveScopedAssistantResolvePluginIds()) {
        plugins = removeTurnPluginEntriesForReceive(
          plugins,
          receiveId,
          pluginId,
        ) as TurnPluginEntry[]
      }
    }
  }

  return plugins
}
