import {
  cancelOpenPluginForm,
  regenerateOpenPluginForm,
  createPluginWebHost,
  createScopedPluginHost,
  getSlotButtonsFor,
  skipOpenPluginForm,
  submitOpenPluginForm,
} from '@/plugins/create-plugin-web-host'
import { loadPluginWebModule } from '@/plugins/load-plugin-web-module'
import { mergePluginLocales } from '@/plugins/merge-plugin-locales'
import type {
  OpenPluginFormState,
  PluginRegistryPublicEntry,
  PluginSlotContext,
} from '@/plugins/types'
import type { useChatSession } from '@/composables/useChatSession'
import { apiFetch } from '@/utils/api-fetch'
import { onMounted, ref, watch } from 'vue'

type ChatSession = ReturnType<typeof useChatSession>

export function usePluginHost(session: ChatSession) {
  const { host, slotButtons, formDialogs, openForm, formSubmitting, slotButtonRevision } =
    createPluginWebHost(session)
  const registry = ref<PluginRegistryPublicEntry[]>([])
  const loadError = ref('')
  /** registry 已拉取；web 模块按 slot 懒加载 */
  const registryLoaded = ref(false)
  const loadedPluginIds = new Set<string>()
  const loadingPlugins = new Map<string, Promise<void>>()
  const loadingSlots = new Map<string, Promise<void>>()
  let loadRegistryInflight: Promise<void> | null = null

  async function loadRegistry(): Promise<void> {
    if (registryLoaded.value) return
    if (loadRegistryInflight) return loadRegistryInflight
    loadRegistryInflight = (async () => {
      loadError.value = ''
      try {
        const res = await apiFetch('/api/plugins/registry')
        if (!res.ok) {
          loadError.value = 'registry_failed'
          return
        }
        const data = (await res.json()) as { plugins?: PluginRegistryPublicEntry[] }
        registry.value = Array.isArray(data.plugins)
          ? [...data.plugins].sort(
              (a, b) => a.order - b.order || a.id.localeCompare(b.id),
            )
          : []
        registryLoaded.value = true
      } catch (e) {
        console.warn('[plugin-host] registry load failed', e)
        loadError.value = 'registry_failed'
      } finally {
        loadRegistryInflight = null
      }
    })()
    return loadRegistryInflight
  }

  async function ensurePluginLoaded(entry: PluginRegistryPublicEntry): Promise<void> {
    if (loadedPluginIds.has(entry.id) || !entry.webEntry) return
    const inflight = loadingPlugins.get(entry.id)
    if (inflight) {
      await inflight
      return
    }

    const task = (async () => {
      try {
        await mergePluginLocales(entry.id)
        const mod = await loadPluginWebModule(entry.webEntry!)
        mod.register?.(createScopedPluginHost(host, entry.id))
        loadedPluginIds.add(entry.id)
        slotButtonRevision.value += 1
      } catch (e) {
        console.warn('[plugin-host] web load failed', entry.id, e)
      } finally {
        loadingPlugins.delete(entry.id)
      }
    })()

    loadingPlugins.set(entry.id, task)
    await task
  }

  /** 无 manifest slot、仅有 lifecycle 的 web 插件：进聊天页即加载 */
  async function ensureEagerWebPlugins(): Promise<void> {
    await loadRegistry()
    const eager = registry.value.filter(
      (e) => e.webEntry && (!e.slots || e.slots.length === 0),
    )
    await Promise.all(eager.map((e) => ensurePluginLoaded(e)))
  }

  async function ensureSlotPlugins(slotName: string): Promise<void> {
    const slot = slotName.trim()
    if (!slot) return

    const inflight = loadingSlots.get(slot)
    if (inflight) {
      await inflight
      return
    }

    const task = (async () => {
      await loadRegistry()
      if (!registryLoaded.value) return
      const entries = registry.value.filter(
        (e) => e.webEntry && e.slots.includes(slot),
      )
      await Promise.all(entries.map((e) => ensurePluginLoaded(e)))
    })()

    loadingSlots.set(slot, task)
    try {
      await task
    } finally {
      loadingSlots.delete(slot)
    }
  }

  async function ensurePluginById(pluginId: string): Promise<void> {
    const id = pluginId.trim()
    if (!id) return
    await loadRegistry()
    const entry = registry.value.find((e) => e.id === id)
    if (entry) await ensurePluginLoaded(entry)
  }

  onMounted(() => {
    void (async () => {
      await loadRegistry()
      await ensureEagerWebPlugins()
      await ensurePluginById('trace-keeper')
    })()
  })

  watch(
    () =>
      session.turns.map(
        (t) => `${t.turnOrdinal}:${t.receives.length}:${t.activeReceiveIndex}`,
      ),
    () => {
      slotButtonRevision.value += 1
    },
  )

  function getSlotButtons(slot: string, ctx: PluginSlotContext = {}) {
    if (!registryLoaded.value) return []
    void slotButtonRevision.value
    const pluginOrder = new Map(registry.value.map((e) => [e.id, e.order]))
    return getSlotButtonsFor(slotButtons, slot, ctx, pluginOrder)
  }

  return {
    registry,
    loadError,
    registryLoaded,
    /** @deprecated 使用 registryLoaded；保留兼容 */
    loaded: registryLoaded,
    ensureSlotPlugins,
    ensurePluginById,
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
      cancelOpenPluginForm({
        openForm: openForm as { value: OpenPluginFormState | null },
        formDialogs,
        host,
      }),
    skipOpenForm: () =>
      skipOpenPluginForm({
        openForm: openForm as { value: OpenPluginFormState | null },
        formDialogs,
        host,
      }),
    regenerateOpenForm: () =>
      regenerateOpenPluginForm({
        openForm: openForm as { value: OpenPluginFormState | null },
        formDialogs,
        host,
        formSubmitting: formSubmitting as { value: boolean },
      }),
  }
}

