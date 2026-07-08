<script setup lang="ts">
import PluginAutoSummarizeProgressPanel from '@/components/settings/PluginAutoSummarizeProgressPanel.vue'
import PluginSchemaForm from '@/components/settings/PluginSchemaForm.vue'
import type { PluginManageEntry } from '@/plugins/plugin-settings-types'
import {
  fetchConversationPluginSettings,
  patchConversationPluginSettings,
} from '@/plugins/plugin-host-api'
import { useConversationPluginSettingsStore } from '@/stores/conversation-plugin-settings'
import { mergePluginLocales } from '@/plugins/merge-plugin-locales'
import {
  fetchPluginSettings,
  fetchPluginsManage,
} from '@/utils/plugin-settings-api'
import { resolvePluginDisplayName } from '@/utils/plugin-locale-text'
import { validatePluginSettingsModel } from '@/utils/plugin-settings-validate'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  conversationId: string
}>()

const emit = defineEmits<{
  (e: 'saving-change', saving: boolean): void
  (e: 'error', message: string): void
}>()

const { t, te, locale } = useI18n()

function pluginDisplayName(pluginId: string, fallback: string): string {
  void locale.value
  return resolvePluginDisplayName(pluginId, fallback)
}
const settingsStore = useConversationPluginSettingsStore()

const loading = ref(true)
const saving = ref(false)
const plugins = ref<PluginManageEntry[]>([])
const globalModels = ref<Record<string, Record<string, unknown>>>({})
const selectedPluginId = ref<string | null>(null)
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSyncedModels = new Map<string, string>()
const SAVE_BATCH_MS = 150

const conversationPlugins = computed(() =>
  plugins.value.filter((p) => p.enabled && p.hasConversationSettings),
)

const convModels = computed(() =>
  settingsStore.conversationBags(props.conversationId),
)

const selectedPlugin = computed(
  () =>
    conversationPlugins.value.find((p) => p.id === selectedPluginId.value) ??
    null,
)

function emitSaving(v: boolean) {
  saving.value = v
  emit('saving-change', v)
}

async function load() {
  loading.value = true
  try {
    const all = await fetchPluginsManage()
    plugins.value = all
    const active = all.filter((p) => p.enabled && p.hasConversationSettings)
    if (
      selectedPluginId.value &&
      !active.some((p) => p.id === selectedPluginId.value)
    ) {
      selectedPluginId.value = null
    }
    await Promise.all(
      active.map((p) =>
        fetchConversationPluginSettings(props.conversationId, p.id),
      ),
    )
    const globalEntries = await Promise.all(
      active.map((p) => fetchPluginSettings(p.id)),
    )
    const nextGlobal: Record<string, Record<string, unknown>> = {}
    active.forEach((p, i) => {
      nextGlobal[p.id] = { ...(globalEntries[i] ?? {}) }
    })
    globalModels.value = nextGlobal
    for (const p of active) {
      const model = convModels.value[p.id]
      if (model) lastSyncedModels.set(p.id, JSON.stringify(model))
    }
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : t('chat.convSettings.pluginLoadFailed'),
    )
  } finally {
    loading.value = false
  }
}

function buildPatch(
  plugin: PluginManageEntry,
  model: Record<string, unknown>,
): Record<string, unknown> {
  const schema = plugin.conversationSettingsSchema
  if (!schema) return {}
  const patch: Record<string, unknown> = {}
  for (const field of schema.fields) {
    const key = field.key
    if (!(key in model)) {
      if (field.conversationInherit) patch[key] = null
      continue
    }
    const v = model[key]
    const empty =
      v === undefined ||
      v === null ||
      v === '' ||
      (field.type === 'lorebook' && typeof v === 'string' && !v.trim()) ||
      (field.type === 'apiPreset' && typeof v === 'string' && !v.trim())
    if ((field.conversationInherit || field.type === 'lorebook') && empty) {
      patch[key] = null
    } else {
      patch[key] = v
    }
  }
  return patch
}

function scheduleSave(plugin: PluginManageEntry) {
  const existing = saveTimers.get(plugin.id)
  if (existing) clearTimeout(existing)
  saveTimers.set(
    plugin.id,
    setTimeout(() => {
      saveTimers.delete(plugin.id)
      void persistPlugin(plugin)
    }, SAVE_BATCH_MS),
  )
}

async function persistPlugin(plugin: PluginManageEntry) {
  const model = convModels.value[plugin.id]
  if (!model) return
  const validationError = validatePluginSettingsModel(
    plugin.conversationSettingsSchema,
    model,
    t,
    te,
    plugin.id,
  )
  if (validationError) {
    emit('error', validationError)
    return
  }
  const patch = buildPatch(plugin, model)
  if (Object.keys(patch).length === 0) return
  const modelSnapshot = JSON.stringify(model)
  if (modelSnapshot === lastSyncedModels.get(plugin.id)) return
  emitSaving(true)
  try {
    await patchConversationPluginSettings(
      props.conversationId,
      plugin.id,
      patch,
    )
    lastSyncedModels.set(plugin.id, modelSnapshot)
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed'),
    )
    await load()
  } finally {
    emitSaving(false)
  }
}

function onModelUpdate(plugin: PluginManageEntry, model: Record<string, unknown>) {
  settingsStore.setBag(props.conversationId, plugin.id, model)
  scheduleSave(plugin)
}

async function openPlugin(plugin: PluginManageEntry) {
  selectedPluginId.value = plugin.id
  await mergePluginLocales(plugin.id)
}

function backToList() {
  selectedPluginId.value = null
}

function onPointerResetError(message: string) {
  emit('error', message)
}

watch(
  () => props.conversationId,
  () => {
    selectedPluginId.value = null
    void load()
  },
)

onMounted(() => {
  void load()
})

defineExpose({ reload: load, backToList })
</script>

<template>
  <div class="conv-plugin-settings">
    <v-progress-linear
      v-if="loading"
      indeterminate
      color="primary"
      class="mb-3"
    />

    <template v-if="!loading && conversationPlugins.length > 0">
      <v-list
        v-if="!selectedPlugin"
        class="conv-plugin-settings-list rounded-lg border"
        density="comfortable"
      >
        <v-list-item
          v-for="plugin in conversationPlugins"
          :key="plugin.id"
          class="conv-plugin-settings-list__item"
        >
          <v-list-item-title class="font-weight-medium">
            {{ pluginDisplayName(plugin.id, plugin.name) }}
            <span class="text-caption text-medium-emphasis ms-2">
              v{{ plugin.version }}
            </span>
          </v-list-item-title>
          <v-list-item-subtitle class="text-caption">
            {{ plugin.id }}
            <template v-if="plugin.hooks.length">
              · {{ plugin.hooks.join(', ') }}
            </template>
          </v-list-item-subtitle>

          <template #append>
            <v-tooltip
              location="top"
              :text="$t('chat.convSettings.pluginConfigure')"
            >
              <template #activator="{ props: tooltipProps }">
                <v-icon-btn
                  v-bind="tooltipProps"
                  icon="mdi-cog"
                  variant="text"
                  color="primary"
                  size="small"
                  :icon-size="24"
                  @click="openPlugin(plugin)"
                />
              </template>
            </v-tooltip>
          </template>
        </v-list-item>
      </v-list>

      <div
        v-else
        class="conv-plugin-settings-detail"
      >
        <v-btn
          variant="tonal"
          color="primary"
          size="small"
          prepend-icon="mdi-arrow-left"
          class="conv-plugin-settings-detail__back mb-3"
          @click="backToList"
        >
          {{ $t('chat.convSettings.pluginBackToList') }}
        </v-btn>

        <h4 class="conv-plugin-settings-detail__name text-subtitle-1 font-weight-medium mb-1">
          {{ pluginDisplayName(selectedPlugin.id, selectedPlugin.name) }}
        </h4>
        <p class="conv-plugin-settings-detail__id text-caption text-medium-emphasis mb-4">
          {{ selectedPlugin.id }}
        </p>

        <PluginSchemaForm
          v-if="convModels[selectedPlugin.id]"
          defer-text-commit
          :plugin-id="selectedPlugin.id"
          :fields="selectedPlugin.conversationSettingsSchema?.fields ?? []"
          :model-value="convModels[selectedPlugin.id]!"
          :global-settings="globalModels[selectedPlugin.id]"
          @update:model-value="onModelUpdate(selectedPlugin, $event)"
        >
          <template #field-companion-panel="{ companionPanel }">
            <PluginAutoSummarizeProgressPanel
              v-if="companionPanel === 'auto-summarize-progress'"
              :plugin-id="selectedPlugin.id"
              :conversation-id="conversationId"
              :conv-model="convModels[selectedPlugin.id]"
              :global-model="globalModels[selectedPlugin.id]"
              @error="onPointerResetError"
            />
          </template>
        </PluginSchemaForm>
      </div>
    </template>

    <p
      v-else-if="!loading"
      class="text-body-2 text-medium-emphasis"
    >
      {{ $t('chat.convSettings.pluginTabEmpty') }}
    </p>
  </div>
</template>

<style scoped>
.conv-plugin-settings-list {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.conv-plugin-settings-detail__back {
  align-self: flex-start;
}

.conv-plugin-settings-detail__id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
