import { fetchPluginUserSettings } from '@/plugins/plugin-host-api'
import { usePluginUserSettingsStore } from '@/stores/plugin-user-settings'

const inflight = new Map<string, Promise<Record<string, unknown>>>()

/** 已加载返回 snapshot；否则 GET 一次并写入 store（并发去重） */
export function loadPluginUserSettings(
  pluginId: string,
): Promise<Record<string, unknown>> {
  const id = pluginId.trim()
  if (!id) return Promise.resolve({})

  const store = usePluginUserSettingsStore()
  if (store.isLoaded(id)) {
    return Promise.resolve(store.getSnapshot(id))
  }

  const pending = inflight.get(id)
  if (pending) return pending

  const promise = fetchPluginUserSettings(id)
    .then((settings) => {
      store.setBag(id, settings, { notify: false })
      return store.getSnapshot(id)
    })
    .finally(() => {
      inflight.delete(id)
    })
  inflight.set(id, promise)
  return promise
}

export function clearPluginUserSettingsInflight(): void {
  inflight.clear()
}
