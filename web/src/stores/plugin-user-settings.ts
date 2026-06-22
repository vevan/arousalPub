import { defineStore } from 'pinia'
import { reactive } from 'vue'

export type PluginUserSettingsBag = Record<string, unknown>

type SettingsListener = (settings: PluginUserSettingsBag) => void

export const usePluginUserSettingsStore = defineStore('pluginUserSettings', () => {
  const bags = reactive<Record<string, PluginUserSettingsBag>>({})
  const loadedKeys = reactive(new Set<string>())
  const listeners = new Map<string, Set<SettingsListener>>()

  function isLoaded(pluginId: string): boolean {
    return loadedKeys.has(pluginId.trim())
  }

  function getSnapshot(pluginId: string): PluginUserSettingsBag {
    const id = pluginId.trim()
    const bag = bags[id]
    return bag ? { ...bag } : {}
  }

  function notify(pluginId: string, settings: PluginUserSettingsBag): void {
    const set = listeners.get(pluginId.trim())
    if (!set) return
    const snap = { ...settings }
    for (const cb of set) cb(snap)
  }

  function setBag(
    pluginId: string,
    settings: PluginUserSettingsBag,
    opts?: { markLoaded?: boolean; notify?: boolean },
  ): void {
    const id = pluginId.trim()
    if (!id) return
    bags[id] = { ...settings }
    if (opts?.markLoaded !== false) {
      loadedKeys.add(id)
    }
    if (opts?.notify !== false) {
      notify(id, bags[id])
    }
  }

  function invalidate(pluginId: string): void {
    const id = pluginId.trim()
    if (!id) return
    delete bags[id]
    loadedKeys.delete(id)
  }

  function subscribe(
    pluginId: string,
    listener: SettingsListener,
  ): () => void {
    const id = pluginId.trim()
    if (!listeners.has(id)) listeners.set(id, new Set())
    listeners.get(id)!.add(listener)
    return () => {
      listeners.get(id)?.delete(listener)
    }
  }

  function clearAll(): void {
    for (const key of Object.keys(bags)) {
      delete bags[key]
    }
    loadedKeys.clear()
    listeners.clear()
  }

  return {
    bags,
    isLoaded,
    getSnapshot,
    setBag,
    invalidate,
    subscribe,
    clearAll,
  }
})
