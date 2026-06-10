type PluginUserSettingsHandler = (pluginId: string) => void

const handlers = new Set<PluginUserSettingsHandler>()

export function subscribePluginUserSettingsSaved(
  handler: PluginUserSettingsHandler,
): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function notifyPluginUserSettingsSaved(pluginId: string): void {
  const id = pluginId.trim()
  if (!id) return
  for (const handler of handlers) {
    try {
      handler(id)
    } catch (e) {
      console.warn('[plugin-user-settings]', e)
    }
  }
}
