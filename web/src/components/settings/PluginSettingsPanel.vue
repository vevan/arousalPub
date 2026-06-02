<script setup lang="ts">
import PluginSchemaForm from '@/components/settings/PluginSchemaForm.vue'
import type { PluginManageEntry } from '@/plugins/plugin-settings-types'
import {
  fetchPluginSettings,
  fetchPluginsManage,
  savePluginRegistry,
  savePluginSettings,
} from '@/utils/plugin-settings-api'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const errorText = ref('')
const plugins = ref<PluginManageEntry[]>([])
const dragIndex = ref<number | null>(null)

const settingsOpen = ref(false)
const settingsPlugin = ref<PluginManageEntry | null>(null)
const settingsModel = ref<Record<string, unknown>>({})
const settingsSaving = ref(false)
const settingsError = ref('')

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    plugins.value = await fetchPluginsManage()
  } catch (e) {
    errorText.value = t('settings.plugins.loadFailed')
    console.warn('[plugins-settings]', e)
  } finally {
    loading.value = false
  }
}

async function persistRegistry() {
  saving.value = true
  errorText.value = ''
  try {
    await savePluginRegistry(
      plugins.value.map((p, i) => ({
        id: p.id,
        enabled: p.enabled,
        order: (i + 1) * 10,
      })),
    )
    plugins.value = plugins.value.map((p, i) => ({
      ...p,
      order: (i + 1) * 10,
    }))
  } catch (e) {
    errorText.value = t('settings.plugins.saveFailed')
    console.warn('[plugins-settings] save registry', e)
  } finally {
    saving.value = false
  }
}

function onToggleEnabled(plugin: PluginManageEntry, enabled: boolean | null) {
  if (enabled === null) return
  plugin.enabled = enabled
  void persistRegistry()
}

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from == null || from === index) return
  const list = [...plugins.value]
  const [item] = list.splice(from, 1)
  if (!item) return
  list.splice(index, 0, item)
  plugins.value = list
  void persistRegistry()
}

async function openSettings(plugin: PluginManageEntry) {
  settingsPlugin.value = plugin
  settingsError.value = ''
  settingsOpen.value = true
  try {
    settingsModel.value = await fetchPluginSettings(plugin.id)
  } catch {
    settingsError.value = t('settings.plugins.settingsLoadFailed')
    settingsModel.value = {}
  }
}

function closeSettings() {
  settingsOpen.value = false
  settingsPlugin.value = null
}

async function submitSettings() {
  const plugin = settingsPlugin.value
  if (!plugin) return
  settingsSaving.value = true
  settingsError.value = ''
  try {
    settingsModel.value = await savePluginSettings(plugin.id, settingsModel.value)
    closeSettings()
  } catch {
    settingsError.value = t('settings.plugins.settingsSaveFailed')
  } finally {
    settingsSaving.value = false
  }
}

const settingsFields = computed(
  () => settingsPlugin.value?.settingsSchema?.fields ?? [],
)

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="settings-section">
    <h2 class="text-subtitle-1 font-weight-medium mb-2">
      {{ $t('settings.plugins.title') }}
    </h2>
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ $t('settings.plugins.intro') }}
    </p>

    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      {{ errorText }}
    </v-alert>

    <v-progress-linear
      v-if="loading || saving"
      indeterminate
      color="primary"
      class="mb-3"
    />

    <v-list
      v-if="!loading && plugins.length > 0"
      class="plugin-settings-list rounded-lg border"
      density="comfortable"
    >
      <v-list-item
        v-for="(plugin, index) in plugins"
        :key="plugin.id"
        draggable="true"
        class="plugin-settings-list__item"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver"
        @drop="onDrop(index)"
      >
        <template #prepend>
          <v-icon
            class="plugin-settings-list__drag"
            size="18"
          >
            mdi-drag-vertical
          </v-icon>
        </template>

        <v-list-item-title class="font-weight-medium">
          {{ plugin.name }}
          <span class="text-caption text-medium-emphasis ms-2">v{{ plugin.version }}</span>
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          {{ plugin.id }}
          <template v-if="plugin.hooks.length">
            · {{ plugin.hooks.join(', ') }}
          </template>
        </v-list-item-subtitle>

        <template #append>
          <div class="d-flex align-center ga-2">
            <v-switch
              :model-value="plugin.enabled"
              color="primary"
              density="compact"
              hide-details
              :aria-label="$t('settings.plugins.enabledAria', { name: plugin.name })"
              @update:model-value="onToggleEnabled(plugin, $event)"
            />
            <v-btn
              v-if="plugin.hasSettings"
              variant="text"
              size="small"
              :disabled="!plugin.enabled"
              @click="openSettings(plugin)"
            >
              {{ $t('settings.plugins.configure') }}
            </v-btn>
          </div>
        </template>
      </v-list-item>
    </v-list>

    <p
      v-else-if="!loading"
      class="text-body-2 text-medium-emphasis"
    >
      {{ $t('settings.plugins.empty') }}
    </p>

    <v-dialog
      v-model="settingsOpen"
      max-width="640"
      scrollable
      @click:outside="closeSettings"
    >
      <v-card v-if="settingsPlugin">
        <v-card-title class="text-h6">
          {{ settingsPlugin.name }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4">
          <v-alert
            v-if="settingsError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ settingsError }}
          </v-alert>
          <PluginSchemaForm
            v-model="settingsModel"
            :plugin-id="settingsPlugin.id"
            :fields="settingsFields"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="settingsSaving"
            @click="closeSettings"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="settingsSaving"
            @click="submitSettings"
          >
            {{ $t('settings.plugins.saveSettings') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.plugin-settings-list {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}
.plugin-settings-list__item {
  cursor: grab;
}
.plugin-settings-list__drag {
  opacity: 0.45;
  margin-inline-end: 0.25rem;
}
</style>
