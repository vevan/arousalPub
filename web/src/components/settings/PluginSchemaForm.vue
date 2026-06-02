<script setup lang="ts">
import type { PluginSettingsFieldSchema } from '@/plugins/plugin-settings-types'
import {
  pluginI18nKey,
  pluginMediaUrl,
  uploadPluginUserAsset,
} from '@/utils/plugin-settings-api'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  pluginId: string
  fields: PluginSettingsFieldSchema[]
  modelValue: Record<string, unknown>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const { t, te } = useI18n()
const uploadingKey = ref<string | null>(null)
const uploadError = ref('')

function labelFor(field: PluginSettingsFieldSchema): string {
  const key = pluginI18nKey(props.pluginId, field.labelKey)
  return te(key) ? t(key) : field.labelKey
}

function hintFor(field: PluginSettingsFieldSchema): string | undefined {
  if (!field.descriptionKey) return undefined
  const key = pluginI18nKey(props.pluginId, field.descriptionKey)
  return te(key) ? t(key) : field.descriptionKey
}

function fieldValue(key: string): unknown {
  return props.modelValue[key]
}

function setField(key: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function isFieldVisible(field: PluginSettingsFieldSchema): boolean {
  const vw = field.visibleWhen
  if (!vw) return true
  return fieldValue(vw.field) === vw.equals
}

function enumLabel(field: PluginSettingsFieldSchema, value: string): string {
  const suffix = value.charAt(0).toUpperCase() + value.slice(1)
  const key = pluginI18nKey(props.pluginId, `${field.key}${suffix}`)
  return te(key) ? t(key) : value
}

const enumItems = computed(() => {
  return (field: PluginSettingsFieldSchema) =>
    (field.enum ?? []).map((v) => ({
      title: enumLabel(field, v),
      value: v,
    }))
})

function fileAccept(field: PluginSettingsFieldSchema): string {
  return (field.accept ?? ['.mp3', '.wav']).join(',')
}

function previewUrl(field: PluginSettingsFieldSchema): string | null {
  const name = String(fieldValue(field.key) ?? '').trim()
  if (!name) return null
  return pluginMediaUrl(props.pluginId, 'user-assets', name)
}

async function onFilePicked(field: PluginSettingsFieldSchema, files: File[] | File | null) {
  uploadError.value = ''
  const file = Array.isArray(files) ? files[0] : files
  if (!file) return
  uploadingKey.value = field.key
  try {
    const filename = await uploadPluginUserAsset(props.pluginId, field.key, file)
    setField(field.key, filename)
  } catch {
    uploadError.value = te(pluginI18nKey(props.pluginId, 'uploadFailed'))
      ? t(pluginI18nKey(props.pluginId, 'uploadFailed'))
      : t('settings.plugins.uploadFailed')
  } finally {
    uploadingKey.value = null
  }
}

function previewDefaultSound(): string {
  return pluginMediaUrl(props.pluginId, 'assets', 'default.mp3')
}

function sliderStep(field: PluginSettingsFieldSchema): number {
  if (typeof field.step === 'number' && field.step > 0) return field.step
  return field.type === 'integer' ? 1 : 0.05
}

function sliderValue(field: PluginSettingsFieldSchema): number {
  const raw = fieldValue(field.key)
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return typeof field.min === 'number' ? field.min : 0
  let v = n
  if (typeof field.min === 'number') v = Math.max(field.min, v)
  if (typeof field.max === 'number') v = Math.min(field.max, v)
  return v
}

function sliderReadout(field: PluginSettingsFieldSchema): string {
  const v = sliderValue(field)
  if (field.max === 1 && field.min === 0) {
    return `${Math.round(v * 100)}%`
  }
  return String(v)
}
</script>

<template>
  <div class="plugin-schema-form d-flex flex-column ga-4">
    <template
      v-for="field in fields"
      :key="field.key"
    >
      <template v-if="isFieldVisible(field)">
        <v-switch
          v-if="field.type === 'boolean'"
          :model-value="Boolean(fieldValue(field.key))"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          color="primary"
          hide-details="auto"
          @update:model-value="setField(field.key, $event)"
        />

        <div
          v-else-if="
            field.widget === 'slider' &&
            (field.type === 'integer' || field.type === 'number')
          "
        >
          <div class="text-body-2 font-weight-medium mb-1">
            {{ labelFor(field) }}
          </div>
          <p
            v-if="hintFor(field)"
            class="text-caption text-medium-emphasis mb-2"
          >
            {{ hintFor(field) }}
          </p>
          <div class="d-flex align-center ga-4">
            <v-slider
              :model-value="sliderValue(field)"
              :min="field.min ?? 0"
              :max="field.max ?? 1"
              :step="sliderStep(field)"
              color="primary"
              class="flex-grow-1"
              hide-details
              @update:model-value="setField(field.key, $event)"
            />
            <span class="text-body-2 font-mono plugin-slider-readout">
              {{ sliderReadout(field) }}
            </span>
          </div>
        </div>

        <v-text-field
          v-else-if="field.type === 'integer' || field.type === 'number'"
          :model-value="fieldValue(field.key)"
          type="number"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          :min="field.min"
          :max="field.max"
          :step="field.type === 'integer' ? 1 : 0.05"
          @update:model-value="setField(field.key, $event)"
        />

        <v-select
          v-else-if="field.type === 'enum'"
          :model-value="fieldValue(field.key)"
          :items="enumItems(field)"
          item-title="title"
          item-value="value"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          @update:model-value="setField(field.key, $event)"
        />

        <v-textarea
          v-else-if="field.type === 'text'"
          :model-value="String(fieldValue(field.key) ?? '')"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          auto-grow
          rows="4"
          :max-rows="16"
          hide-details="auto"
          @update:model-value="setField(field.key, $event)"
        />

        <v-text-field
          v-else-if="field.type === 'string'"
          :model-value="String(fieldValue(field.key) ?? '')"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          @update:model-value="setField(field.key, $event)"
        />

        <div
          v-else-if="field.type === 'fileAsset'"
          class="plugin-file-asset"
        >
          <div class="text-body-2 font-weight-medium mb-1">
            {{ labelFor(field) }}
          </div>
          <p
            v-if="hintFor(field)"
            class="text-caption text-medium-emphasis mb-2"
          >
            {{ hintFor(field) }}
          </p>
          <div class="d-flex flex-wrap align-center ga-2 mb-2">
            <v-file-input
              :accept="fileAccept(field)"
              density="compact"
              variant="outlined"
              hide-details
              prepend-icon="mdi-upload"
              :label="
                te(pluginI18nKey(pluginId, 'upload'))
                  ? t(pluginI18nKey(pluginId, 'upload'))
                  : t('settings.plugins.upload')
              "
              :loading="uploadingKey === field.key"
              @update:model-value="onFilePicked(field, $event)"
            />
          </div>
          <div
            v-if="String(fieldValue(field.key) ?? '').trim()"
            class="text-caption mb-2"
          >
            {{ fieldValue(field.key) }}
          </div>
          <audio
            v-if="previewUrl(field)"
            controls
            preload="none"
            class="plugin-file-asset__player"
            :src="previewUrl(field) ?? undefined"
          />
          <v-alert
            v-if="uploadError && uploadingKey === null"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ uploadError }}
          </v-alert>
        </div>
      </template>
    </template>

    <div
      v-if="pluginId === 'reply-complete-sound'"
      class="plugin-default-preview"
    >
      <div class="text-caption text-medium-emphasis mb-1">
        default.mp3
      </div>
      <audio
        controls
        preload="none"
        class="plugin-file-asset__player"
        :src="previewDefaultSound()"
      />
    </div>
  </div>
</template>

<style scoped>
.plugin-file-asset__player {
  width: 100%;
  max-width: 360px;
  height: 2.5rem;
}
.plugin-slider-readout {
  min-width: 3rem;
  text-align: right;
}
</style>
