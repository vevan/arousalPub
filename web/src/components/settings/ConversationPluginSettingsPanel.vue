<script setup lang="ts">
import PluginSchemaForm from '@/components/settings/PluginSchemaForm.vue'
import type { PluginManageEntry } from '@/plugins/plugin-settings-types'
import {
  fetchConversationPluginSettings,
  patchConversationPluginSettings,
} from '@/plugins/plugin-host-api'
import { useConversationPluginSettingsStore } from '@/stores/conversation-plugin-settings'
import {
  fetchPluginSettings,
  fetchPluginsManage,
} from '@/utils/plugin-settings-api'
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

const { t, te } = useI18n()
const settingsStore = useConversationPluginSettingsStore()

const loading = ref(true)
const saving = ref(false)
const plugins = ref<PluginManageEntry[]>([])
const globalModels = ref<Record<string, Record<string, unknown>>>({})
const selectedPluginId = ref<string | null>(null)
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
      (field.type === 'lorebook' && typeof v === 'string' && !v.trim())
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
    }, 400),
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
  emitSaving(true)
  try {
    await patchConversationPluginSettings(
      props.conversationId,
      plugin.id,
      patch,
    )
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

function openPlugin(plugin: PluginManageEntry) {
  selectedPluginId.value = plugin.id
}

function backToList() {
  selectedPluginId.value = null
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
            {{ plugin.name }}
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
            <v-btn
              variant="text"
              size="small"
              @click="openPlugin(plugin)"
            >
              {{ $t('chat.convSettings.pluginConfigure') }}
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <div
        v-else
        class="conv-plugin-settings-detail"
      >
        <v-btn
          variant="text"
          size="small"
          prepend-icon="mdi-arrow-left"
          class="mb-3 px-0"
          @click="backToList"
        >
          {{ $t('chat.convSettings.pluginBackToList') }}
        </v-btn>

        <h4 class="text-subtitle-1 font-weight-medium mb-1">
          {{ selectedPlugin.name }}
        </h4>
        <p class="text-caption text-medium-emphasis mb-4">
          {{ selectedPlugin.id }}
        </p>

        <PluginSchemaForm
          v-if="convModels[selectedPlugin.id]"
          :plugin-id="selectedPlugin.id"
          :fields="selectedPlugin.conversationSettingsSchema?.fields ?? []"
          :model-value="convModels[selectedPlugin.id]!"
          :global-settings="globalModels[selectedPlugin.id]"
          @update:model-value="onModelUpdate(selectedPlugin, $event)"
        />
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
</style>
