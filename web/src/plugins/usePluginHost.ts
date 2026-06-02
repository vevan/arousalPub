import {
  cancelOpenPluginForm,
  createPluginWebHost,
  createScopedPluginHost,
  getSlotButtonsFor,
  submitOpenPluginForm,
} from '@/plugins/create-plugin-web-host'
import { loadPluginWebModule } from '@/plugins/load-plugin-web-module'
import { mergePluginLocales } from '@/plugins/merge-plugin-locales'
import type { OpenPluginFormState, PluginRegistryPublicEntry, PluginSlotContext } from '@/plugins/types'
import type { useChatSession } from '@/composables/useChatSession'
import { apiFetch } from '@/utils/api-fetch'
import { onMounted, ref } from 'vue'

type ChatSession = ReturnType<typeof useChatSession>

export function usePluginHost(session: ChatSession) {
  const { host, slotButtons, formDialogs, openForm, formSubmitting, slotButtonRevision } =
    createPluginWebHost(session)
  const registry = ref<PluginRegistryPublicEntry[]>([])
  const loadError = ref('')
  const loaded = ref(false)

  async function loadPlugins() {
    loadError.value = ''
    try {
      const res = await apiFetch('/api/plugins/registry')
      if (!res.ok) {
        loadError.value = 'registry_failed'
        return
      }
      const data = (await res.json()) as { plugins?: PluginRegistryPublicEntry[] }
      registry.value = Array.isArray(data.plugins) ? data.plugins : []
      for (const entry of registry.value) {
        await mergePluginLocales(entry.id)
        if (!entry.webEntry) continue
        try {
          const mod = await loadPluginWebModule(entry.webEntry)
          mod.register?.(createScopedPluginHost(host, entry.id))
        } catch (e) {
          console.warn('[plugin-host] web load failed', entry.id, e)
        }
      }
      loaded.value = true
    } catch (e) {
      console.warn('[plugin-host] registry load failed', e)
      loadError.value = 'registry_failed'
    }
  }

  onMounted(() => {
    void loadPlugins()
  })

  function getSlotButtons(slot: string, ctx: PluginSlotContext = {}) {
    if (!loaded.value) return []
    void slotButtonRevision.value
    return getSlotButtonsFor(slotButtons, slot, ctx)
  }

  return {
    registry,
    loadError,
    loaded,
    openForm,
    formSubmitting,
    formDialogs,
    host,
    getSlotButtons,
    submitOpenForm: () =>
      submitOpenPluginForm({
        openForm: openForm as { value: OpenPluginFormState | null },
        formDialogs,
        host,
        formSubmitting: formSubmitting as { value: boolean },
      }),
    cancelOpenForm: () =>
      cancelOpenPluginForm(openForm as { value: OpenPluginFormState | null }),
  }
}
