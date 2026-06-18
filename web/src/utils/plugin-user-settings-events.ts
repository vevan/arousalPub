import { usePluginUserSettingsStore } from '@/stores/plugin-user-settings'
import { clearPluginUserSettingsInflight } from '@/utils/plugin-user-settings-loader'

type PluginUserSettingsHandler = (
  pluginId: string,
  settings?: Record<string, unknown>,
) => void

const handlers = new Set<PluginUserSettingsHandler>()

export function subscribePluginUserSettingsSaved(
  handler: PluginUserSettingsHandler,
): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** 设置页保存后调用；传入 settings 时零 GET 写入 cache 并 notify 订阅者 */
export function notifyPluginUserSettingsSaved(
  pluginId: string,
  settings?: Record<string, unknown>,
): void {
  const id = pluginId.trim()
  if (!id) return

  const store = usePluginUserSettingsStore()
  if (settings !== undefined) {
    store.setBag(id, settings, { notify: true })
  } else {
    store.invalidate(id)
    clearPluginUserSettingsInflight()
  }

  for (const handler of handlers) {
    try {
      handler(id, settings)
    } catch (e) {
      console.warn('[plugin-user-settings]', e)
    }
  }
}
