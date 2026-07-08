import type { PluginRegistryPublicEntry } from '@/plugins/types'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePluginPermissionsStore = defineStore('pluginPermissions', () => {
  const byId = ref(new Map<string, readonly string[]>())

  function syncFromRegistry(entries: PluginRegistryPublicEntry[]): void {
    const next = new Map<string, readonly string[]>()
    for (const entry of entries) {
      next.set(entry.id, entry.permissions ?? [])
    }
    byId.value = next
  }

  function getPermissions(pluginId: string): readonly string[] {
    return byId.value.get(pluginId.trim()) ?? []
  }

  return { syncFromRegistry, getPermissions }
})
