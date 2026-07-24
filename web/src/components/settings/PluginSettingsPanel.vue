<script setup lang="ts">
import PluginSchemaForm from '@/components/settings/PluginSchemaForm.vue'
import type { PluginManageEntry } from '@/plugins/plugin-settings-types'
import {
  downloadPluginSettingsExport,
  exportPluginSettings,
  fetchPluginSettings,
  fetchPluginsManage,
  importPluginSettings,
  savePluginRegistry,
  savePluginSettings,
} from '@/utils/plugin-settings-api'
import {
  hydratePluginSettingsDefaults,
  validatePluginSettingsModel,
} from '@/utils/plugin-settings-validate'
import { resolvePluginDisplayName } from '@/utils/plugin-locale-text'
import { mergePluginLocales } from '@/plugins/merge-plugin-locales'
import { notifyPluginUserSettingsSaved } from '@/utils/plugin-user-settings-events'
import { translateApiError } from '@/utils/api-error-message'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te, locale } = useI18n()

function pluginDisplayName(pluginId: string, fallback: string): string {
  void locale.value
  return resolvePluginDisplayName(pluginId, fallback)
}

const settingsDialogMaxWidth = computed(
  () => settingsPlugin.value?.settingsSchema?.dialogMaxWidth ?? 640,
)

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
const footerValidationError = ref('')
const settingsFormRef = ref<InstanceType<typeof PluginSchemaForm> | null>(null)
const settingsPortBusy = ref(false)
const importFileInputRef = ref<HTMLInputElement | null>(null)

function onFooterValidationError(message: string | null) {
  footerValidationError.value = message ?? ''
}

function portabilityErrorMessage(code: string): string {
  return translateApiError(code) || t('settings.plugins.importFailed')
}

async function onExportSettings() {
  const plugin = settingsPlugin.value
  if (!plugin || settingsPortBusy.value) return
  settingsPortBusy.value = true
  settingsError.value = ''
  try {
    const envelope = await exportPluginSettings(plugin.id)
    downloadPluginSettingsExport(envelope)
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    settingsError.value = code
      ? portabilityErrorMessage(code)
      : t('settings.plugins.exportFailed')
  } finally {
    settingsPortBusy.value = false
  }
}

function onImportSettingsClick() {
  if (settingsPortBusy.value) return
  importFileInputRef.value?.click()
}

async function onImportFileChange(ev: Event) {
  const plugin = settingsPlugin.value
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!plugin || !file) return
  const importPluginId = plugin.id
  settingsPortBusy.value = true
  settingsError.value = ''
  try {
    const text = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      if (settingsPlugin.value?.id === importPluginId) {
        settingsError.value = t('settings.plugins.importInvalidFile')
      }
      return
    }
    const result = await importPluginSettings(importPluginId, parsed)
    const row = plugins.value.find((p) => p.id === importPluginId)
    if (row) row.enabled = result.enabled
    notifyPluginUserSettingsSaved(importPluginId, result.settings)
    // 对话框已切到其它插件或已关闭：磁盘已写入，勿污染当前表单
    if (settingsPlugin.value?.id !== importPluginId || !settingsOpen.value) {
      return
    }
    settingsModel.value = result.settings
    hydratePluginSettingsDefaults(
      settingsModel.value,
      settingsPlugin.value.settingsSchema,
      importPluginId,
      t,
      te,
    )
    footerValidationError.value = ''
    settingsPlugin.value.enabled = result.enabled
  } catch (e) {
    if (settingsPlugin.value?.id !== importPluginId) return
    const code = e instanceof Error ? e.message : ''
    settingsError.value = code
      ? portabilityErrorMessage(code)
      : t('settings.plugins.importFailed')
  } finally {
    settingsPortBusy.value = false
  }
}

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
  if (enabled === null || settingsPortBusy.value) return
  plugin.enabled = enabled
  void persistRegistry()
}

function requestCloseSettings() {
  if (settingsSaving.value || settingsPortBusy.value) return
  closeSettings()
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
  footerValidationError.value = ''
  settingsOpen.value = true
  try {
    await mergePluginLocales(plugin.id)
    settingsModel.value = await fetchPluginSettings(plugin.id)
    hydratePluginSettingsDefaults(
      settingsModel.value,
      plugin.settingsSchema,
      plugin.id,
      t,
      te,
    )
  } catch {
    settingsError.value = t('settings.plugins.settingsLoadFailed')
    settingsModel.value = {}
  }
}

function closeSettings() {
  settingsOpen.value = false
  settingsPlugin.value = null
  footerValidationError.value = ''
}

async function submitSettings() {
  const plugin = settingsPlugin.value
  if (!plugin || settingsPortBusy.value) return
  settingsFormRef.value?.commitAllTextDrafts()
  const sampleError =
    settingsFormRef.value?.validateAllJsonSampleStateFields() ?? null
  if (sampleError) {
    footerValidationError.value = sampleError
    return
  }
  const validationError = validatePluginSettingsModel(
    plugin.settingsSchema,
    settingsModel.value,
    t,
    te,
    plugin.id,
  )
  if (validationError) {
    footerValidationError.value = validationError
    return
  }
  settingsSaving.value = true
  settingsError.value = ''
  footerValidationError.value = ''
  try {
    settingsModel.value = await savePluginSettings(plugin.id, settingsModel.value)
    notifyPluginUserSettingsSaved(plugin.id, settingsModel.value)
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
          {{ pluginDisplayName(plugin.id, plugin.name) }}
          <span class="text-caption text-medium-emphasis ms-2">v{{ plugin.version }}</span>
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          {{ plugin.id }}
          <template v-if="plugin.hooks.length">
            · {{ plugin.hooks.join(', ') }}
          </template>
        </v-list-item-subtitle>

        <template #append>
          <div class="plugin-settings-list__actions">
            <v-switch
              :model-value="plugin.enabled"
              color="primary"
              density="compact"
              hide-details
              :disabled="settingsPortBusy || saving"
              :aria-label="$t('settings.plugins.enabledAria', { name: pluginDisplayName(plugin.id, plugin.name) })"
              @update:model-value="onToggleEnabled(plugin, $event)"
            />
            <v-tooltip
              v-if="plugin.hasSettings"
              location="top"
              :text="$t('settings.plugins.configure')"
            >
              <template #activator="{ props: tooltipProps }">
                <v-icon-btn
                  v-bind="tooltipProps"
                  icon="mdi-cog"
                  variant="text"
                  color="primary"
                  size="small"
                  :icon-size="24"
                  :disabled="!plugin.enabled"
                  @click="openSettings(plugin)"
                />
              </template>
            </v-tooltip>
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
      :max-width="settingsDialogMaxWidth"
      scrollable
      :persistent="settingsPortBusy || settingsSaving"
      @click:outside="requestCloseSettings"
    >
      <v-card v-if="settingsPlugin">
        <v-card-title class="plugin-settings-dialog__title py-3">
          <div class="plugin-settings-dialog__title-row">
            <span class="text-h6 font-weight-medium text-truncate min-w-0">
              {{ pluginDisplayName(settingsPlugin.id, settingsPlugin.name) }}
            </span>
            <v-spacer />
            <div class="plugin-settings-dialog__port-actions">
              <v-btn
                variant="text"
                size="small"
                class="text-none"
                :loading="settingsPortBusy"
                :disabled="settingsSaving"
                @click="onImportSettingsClick"
              >
                {{ $t('settings.plugins.importSettings') }}
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                class="text-none"
                :loading="settingsPortBusy"
                :disabled="settingsSaving"
                @click="onExportSettings"
              >
                {{ $t('settings.plugins.exportSettings') }}
              </v-btn>
            </div>
          </div>
          <input
            ref="importFileInputRef"
            type="file"
            accept="application/json,.json"
            class="plugin-settings-dialog__file-input"
            @change="onImportFileChange"
          />
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
            ref="settingsFormRef"
            v-model="settingsModel"
            :plugin-id="settingsPlugin.id"
            :fields="settingsFields"
            @footer-validation-error="onFooterValidationError"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="plugin-settings-dialog__actions pa-3">
          <span
            v-if="footerValidationError"
            class="plugin-settings-dialog__validation-error text-error text-body-2"
          >
            {{ footerValidationError }}
          </span>
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            :disabled="settingsSaving || settingsPortBusy"
            @click="requestCloseSettings"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="settingsSaving"
            :disabled="settingsPortBusy"
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

.plugin-settings-list__item :deep(.v-list-item__append) {
  padding-inline-start: 0.5rem;
}

.plugin-settings-list__actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}

.plugin-settings-list__actions :deep(.v-switch) {
  flex-shrink: 0;
}

.plugin-settings-dialog__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.plugin-settings-dialog__title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  min-width: 0;
}

.plugin-settings-dialog__port-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 0.25rem;
}

.plugin-settings-dialog__file-input {
  display: none;
}

.plugin-settings-dialog__validation-error {
  flex: 1 1 12rem;
  min-width: 0;
  line-height: 1.4;
}
</style>
