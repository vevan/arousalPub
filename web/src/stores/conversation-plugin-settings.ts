import { defineStore } from 'pinia'
import { reactive } from 'vue'

export type ConversationPluginSettingsBag = Record<string, unknown>

type SettingsListener = (settings: ConversationPluginSettingsBag) => void

function convPluginKey(conversationId: string, pluginId: string): string {
  return `${conversationId}\x1f${pluginId}`
}

export const useConversationPluginSettingsStore = defineStore(
  'conversationPluginSettings',
  () => {
    const bags = reactive<
      Record<string, Record<string, ConversationPluginSettingsBag>>
    >({})
    const loadedKeys = reactive(new Set<string>())
    const listeners = new Map<string, Set<SettingsListener>>()

    function isLoaded(conversationId: string, pluginId: string): boolean {
      return loadedKeys.has(convPluginKey(conversationId, pluginId))
    }

    function getSnapshot(
      conversationId: string,
      pluginId: string,
    ): ConversationPluginSettingsBag {
      const bag = bags[conversationId]?.[pluginId]
      return bag ? { ...bag } : {}
    }

    function conversationBags(
      conversationId: string,
    ): Record<string, ConversationPluginSettingsBag> {
      const conv = bags[conversationId]
      if (!conv) return {}
      const out: Record<string, ConversationPluginSettingsBag> = {}
      for (const [pluginId, bag] of Object.entries(conv)) {
        out[pluginId] = { ...bag }
      }
      return out
    }

    function notify(
      conversationId: string,
      pluginId: string,
      settings: ConversationPluginSettingsBag,
    ): void {
      const set = listeners.get(convPluginKey(conversationId, pluginId))
      if (!set) return
      const snap = { ...settings }
      for (const cb of set) cb(snap)
    }

    function setBag(
      conversationId: string,
      pluginId: string,
      settings: ConversationPluginSettingsBag,
      opts?: { markLoaded?: boolean; notify?: boolean },
    ): void {
      if (!bags[conversationId]) bags[conversationId] = {}
      bags[conversationId][pluginId] = { ...settings }
      if (opts?.markLoaded !== false) {
        loadedKeys.add(convPluginKey(conversationId, pluginId))
      }
      if (opts?.notify !== false) {
        notify(conversationId, pluginId, bags[conversationId][pluginId])
      }
    }

    function subscribe(
      conversationId: string,
      pluginId: string,
      listener: SettingsListener,
    ): () => void {
      const key = convPluginKey(conversationId, pluginId)
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)!.add(listener)
      return () => {
        listeners.get(key)?.delete(listener)
      }
    }

    function clearConversation(conversationId: string): void {
      delete bags[conversationId]
      for (const key of [...loadedKeys]) {
        if (key.startsWith(`${conversationId}\x1f`)) loadedKeys.delete(key)
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
      conversationBags,
      setBag,
      subscribe,
      clearConversation,
      clearAll,
    }
  },
)
