import { createPluginServerHostApi } from './plugin-system/host-api.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
import { readPluginManifest } from './plugin-system/manifest.js'
import type { ConversationIndex } from './chat-storage.js'

export type ConversationLifecycleEvent = 'onCharacterPrimaryChanged'

export async function dispatchConversationLifecycle(
  event: ConversationLifecycleEvent,
  ctx: { conversationId: string; conversationIndex: ConversationIndex },
  userId?: string,
): Promise<Record<string, Record<string, unknown>>> {
  const loaded = await loadEnabledServerPlugins(userId)
  const api = createPluginServerHostApi(undefined, userId)
  const patches: Record<string, Record<string, unknown>> = {}

  for (const plugin of loaded) {
    const manifest = await readPluginManifest(plugin.id)
    if (!manifest?.lifecycle?.[event]) continue
    const handler = plugin.module[event]
    if (typeof handler !== 'function') continue
    const patch = await handler(ctx, api)
    if (!patch || typeof patch !== 'object') continue
    const settings = (patch as { pluginSettings?: unknown }).pluginSettings
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      continue
    }
    patches[plugin.id] = settings as Record<string, unknown>
  }

  return patches
}

export async function resolvePluginPersistExtras(
  conversationIndex: ConversationIndex,
  userId?: string,
): Promise<Record<string, unknown>> {
  const loaded = await loadEnabledServerPlugins(userId)
  const api = createPluginServerHostApi(undefined, userId)
  const extras: Record<string, unknown> = {}
  const ctx = { conversationIndex }

  for (const plugin of loaded) {
    if (typeof plugin.module.resolveConversationPersistExtras !== 'function') {
      continue
    }
    const part = await plugin.module.resolveConversationPersistExtras(ctx, api)
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue
    Object.assign(extras, part as Record<string, unknown>)
  }

  return extras
}
