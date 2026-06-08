<script setup lang="ts">
import type {
  PluginSettingsFieldSchema,
  PluginSettingsItemFieldSchema,
} from '@/plugins/plugin-settings-types'
import {
  pluginI18nKey,
  pluginMediaUrl,
  uploadPluginUserAsset,
} from '@/utils/plugin-settings-api'
import {
  defaultTextForField,
  newObjectListItem,
  parseObjectListField,
  serializeObjectListField,
} from '@/utils/plugin-settings-validate'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import {
  loadApiPresetSelectItems,
  loadLorebookSelectItems,
  needsApiPresetSelect,
  needsLorebookSelect,
  type PluginSchemaSelectItem,
} from '@/utils/plugin-schema-selects'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  pluginId: string
  fields: PluginSettingsFieldSchema[]
  modelValue: Record<string, unknown>
  /** 会话 schema：展示 inheritFromGlobalKey 对应的全局值 */
  globalSettings?: Record<string, unknown>
  /** 某字段下方的补充说明行（如 curated-memory 自动摘要进度） */
  fieldCompanionLines?: (fieldKey: string) => string[] | undefined
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const { t, te } = useI18n()
const uploadingKey = ref<string | null>(null)
const uploadError = ref('')
const apiPresetItems = ref<PluginSchemaSelectItem[]>([])
const lorebookItems = ref<PluginSchemaSelectItem[]>([])
const selectsLoading = ref(false)

onMounted(async () => {
  const needApi = needsApiPresetSelect(props.fields)
  const needLb = needsLorebookSelect(props.fields)
  if (!needApi && !needLb) return
  selectsLoading.value = true
  try {
    const [api, lb] = await Promise.all([
      needApi ? loadApiPresetSelectItems() : Promise.resolve([]),
      needLb ? loadLorebookSelectItems() : Promise.resolve([]),
    ])
    apiPresetItems.value = api
    lorebookItems.value = lb
  } finally {
    selectsLoading.value = false
  }
})

function resourceSelectItems(field: PluginSettingsFieldSchema): PluginSchemaSelectItem[] {
  if (field.type === 'apiPreset') return apiPresetItems.value
  if (field.type === 'lorebook') return lorebookItems.value
  return []
}

function resourceSelectClearable(field: PluginSettingsFieldSchema): boolean {
  return field.type === 'lorebook'
}

function pluginText(key: string, params?: Record<string, unknown>): string {
  return translatePluginI18nKey(key, t, te, params)
}

function companionLinesFor(fieldKey: string): string[] {
  return props.fieldCompanionLines?.(fieldKey) ?? []
}

function labelFor(field: PluginSettingsFieldSchema): string {
  const key = pluginI18nKey(props.pluginId, field.labelKey)
  return te(key) ? pluginText(key) : field.labelKey
}

function hintFor(field: PluginSettingsFieldSchema): string | undefined {
  if (!field.descriptionKey) return undefined
  const key = pluginI18nKey(props.pluginId, field.descriptionKey)
  return te(key) ? pluginText(key) : field.descriptionKey
}

function inheritGlobalHint(field: PluginSettingsFieldSchema): string | undefined {
  if (!field.conversationInherit || !field.inheritFromGlobalKey) return undefined
  const global = props.globalSettings
  if (!global) return undefined
  const raw = global[field.inheritFromGlobalKey]
  if (raw === undefined || raw === null || raw === '') return undefined
  return t('chat.convSettings.pluginInheritGlobal', { value: String(raw) })
}

function fullHintFor(field: PluginSettingsFieldSchema): string | undefined {
  const parts: string[] = []
  const base = hintFor(field)
  if (base) parts.push(base)
  const inh = inheritGlobalHint(field)
  if (inh) parts.push(inh)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function isInheritNumberEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function inheritNumberDisplay(field: PluginSettingsFieldSchema): string | number {
  const v = fieldValue(field.key)
  if (isInheritNumberEmpty(v)) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(String(v))
  return Number.isFinite(n) ? n : ''
}

function setInheritNumberField(
  field: PluginSettingsFieldSchema,
  value: string | number | null,
) {
  const next = { ...props.modelValue }
  const raw = value === null ? '' : String(value).trim()
  if (!raw) {
    delete next[field.key]
  } else {
    const n = field.type === 'integer' ? Math.round(Number(raw)) : Number(raw)
    if (Number.isFinite(n)) {
      let v = n
      if (typeof field.min === 'number') v = Math.max(field.min, v)
      if (typeof field.max === 'number') v = Math.min(field.max, v)
      next[field.key] = v
    }
  }
  emit('update:modelValue', next)
}

function itemLabelFor(field: PluginSettingsItemFieldSchema): string {
  const key = pluginI18nKey(props.pluginId, field.labelKey)
  return te(key) ? pluginText(key) : field.labelKey
}

function itemHintFor(field: PluginSettingsItemFieldSchema): string | undefined {
  if (!field.descriptionKey) return undefined
  const key = pluginI18nKey(props.pluginId, field.descriptionKey)
  return te(key) ? pluginText(key) : field.descriptionKey
}

function itemEnumLabel(
  field: PluginSettingsItemFieldSchema,
  value: string,
): string {
  const suffix = value.charAt(0).toUpperCase() + value.slice(1)
  const key = pluginI18nKey(props.pluginId, `${field.key}${suffix}`)
  return te(key) ? t(key) : value
}

function itemEnumItems(field: PluginSettingsItemFieldSchema) {
  return (field.enum ?? []).map((v) => ({
    title: itemEnumLabel(field, v),
    value: v,
  }))
}

function displayTextValue(
  field: PluginSettingsFieldSchema | PluginSettingsItemFieldSchema,
  value: unknown,
): string {
  const s = String(value ?? '')
  if (s.trim()) return s
  return defaultTextForField(field, props.pluginId, t, te)
}

function restoreDefaultPrompt(
  field: PluginSettingsFieldSchema | PluginSettingsItemFieldSchema,
  setValue: (v: string) => void,
) {
  const text = defaultTextForField(field, props.pluginId, t, te)
  if (text) setValue(text)
}

function restoreDefaultLabel(): string {
  const key = pluginI18nKey(props.pluginId, 'promptTemplateRestoreDefault')
  if (te(key)) return t(key)
  return te('settings.plugins.restoreDefault')
    ? t('settings.plugins.restoreDefault')
    : 'Restore default'
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

function objectListItems(field: PluginSettingsFieldSchema): Record<string, unknown>[] {
  return parseObjectListField(fieldValue(field.key))
}

function setObjectListItems(
  field: PluginSettingsFieldSchema,
  items: Record<string, unknown>[],
) {
  setField(field.key, serializeObjectListField(items))
}

function addObjectListItem(field: PluginSettingsFieldSchema) {
  const itemFields = field.itemFields ?? []
  const items = [...objectListItems(field)]
  items.push(newObjectListItem(itemFields, props.pluginId, t, te))
  setObjectListItems(field, items)
}

function removeObjectListItem(field: PluginSettingsFieldSchema, index: number) {
  const items = objectListItems(field).filter((_, i) => i !== index)
  setObjectListItems(field, items)
}

function updateObjectListItem(
  field: PluginSettingsFieldSchema,
  index: number,
  itemKey: string,
  value: unknown,
) {
  const items = objectListItems(field).map((item, i) =>
    i === index ? { ...item, [itemKey]: value } : item,
  )
  setObjectListItems(field, items)
}

function objectListItemTitle(
  item: Record<string, unknown>,
  index: number,
): string {
  const name = String(item.name ?? '').trim()
  if (name) return name
  const addKey = pluginI18nKey(props.pluginId, 'sidecarItemUntitled')
  const untitled = te(addKey) ? t(addKey) : `Sidecar ${index + 1}`
  return untitled
}

function addObjectListLabel(): string {
  const key = pluginI18nKey(props.pluginId, 'sidecarAddItem')
  if (te(key)) return t(key)
  return te('settings.plugins.addItem') ? t('settings.plugins.addItem') : 'Add'
}
</script>

<template>
  <div class="plugin-schema-form d-flex flex-column ga-4">
    <template
      v-for="field in fields"
      :key="field.key"
    >
      <template v-if="isFieldVisible(field)">
        <div v-if="field.type === 'boolean'">
          <v-switch
            :model-value="Boolean(fieldValue(field.key))"
            :label="labelFor(field)"
            :hint="fullHintFor(field)"
            persistent-hint
            color="primary"
            hide-details="auto"
            @update:model-value="setField(field.key, $event)"
          />
          <slot
            v-if="$slots['field-companion-panel']"
            name="field-companion-panel"
            :field-key="field.key"
          />
          <template v-else>
            <div
              v-if="companionLinesFor(field.key).length > 0"
              class="plugin-field-companion ps-1 mt-n1 mb-3"
            >
              <p
                v-for="(line, ci) in companionLinesFor(field.key)"
                :key="ci"
                class="text-caption text-medium-emphasis mb-0"
              >
                {{ line }}
              </p>
            </div>
            <div
              v-if="$slots['field-companion-extra']"
              class="plugin-field-companion-extra ps-1 mb-3"
            >
              <slot
                name="field-companion-extra"
                :field-key="field.key"
              />
            </div>
          </template>
        </div>

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
          v-else-if="
            field.conversationInherit &&
            (field.type === 'integer' || field.type === 'number')
          "
          :model-value="inheritNumberDisplay(field)"
          type="number"
          :label="labelFor(field)"
          :hint="fullHintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          clearable
          :min="field.min"
          :max="field.max"
          :step="field.type === 'integer' ? 1 : 0.05"
          @update:model-value="setInheritNumberField(field, $event)"
        />

        <v-text-field
          v-else-if="field.type === 'integer' || field.type === 'number'"
          :model-value="fieldValue(field.key)"
          type="number"
          :label="labelFor(field)"
          :hint="fullHintFor(field)"
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

        <v-select
          v-else-if="field.type === 'apiPreset' || field.type === 'lorebook'"
          :model-value="String(fieldValue(field.key) ?? '') || null"
          :items="resourceSelectItems(field)"
          item-title="title"
          item-value="value"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          :loading="selectsLoading"
          :clearable="resourceSelectClearable(field)"
          :placeholder="
            field.type === 'lorebook'
              ? t('settings.plugins.selectEmptyDefault')
              : t('settings.plugins.selectApiPreset')
          "
          @update:model-value="setField(field.key, $event ?? '')"
        />

        <div
          v-else-if="field.type === 'text' && field.widget === 'promptTemplate'"
          class="plugin-prompt-template"
        >
          <v-textarea
            :model-value="displayTextValue(field, fieldValue(field.key))"
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
          <v-btn
            v-if="field.defaultKey"
            variant="text"
            size="small"
            class="mt-1"
            @click="restoreDefaultPrompt(field, (v) => setField(field.key, v))"
          >
            {{ restoreDefaultLabel() }}
          </v-btn>
        </div>

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

        <div
          v-else-if="field.type === 'objectList'"
          class="plugin-object-list"
        >
          <div class="text-body-2 font-weight-medium mb-1">
            {{ labelFor(field) }}
          </div>
          <p
            v-if="hintFor(field)"
            class="text-caption text-medium-emphasis mb-3"
          >
            {{ hintFor(field) }}
          </p>
          <v-expansion-panels
            multiple
            class="plugin-object-list__panels mb-3"
          >
            <v-expansion-panel
              v-for="(item, index) in objectListItems(field)"
              :key="String(item.id ?? index)"
              class="plugin-object-list__item"
            >
              <v-expansion-panel-title class="text-subtitle-2 py-2">
                <span class="text-truncate">{{ objectListItemTitle(item, index) }}</span>
                <v-spacer />
                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  size="small"
                  :aria-label="$t('settings.plugins.removeItem')"
                  @click.stop="removeObjectListItem(field, index)"
                />
              </v-expansion-panel-title>
              <v-expansion-panel-text class="d-flex flex-column ga-3 pt-1">
              <template
                v-for="sub in field.itemFields ?? []"
                :key="sub.key"
              >
                <v-switch
                  v-if="sub.type === 'boolean'"
                  :model-value="Boolean(item[sub.key])"
                  :label="itemLabelFor(sub)"
                  :hint="itemHintFor(sub)"
                  persistent-hint
                  color="primary"
                  hide-details="auto"
                  @update:model-value="
                    updateObjectListItem(field, index, sub.key, $event)
                  "
                />
                <v-text-field
                  v-else-if="sub.type === 'string'"
                  :model-value="String(item[sub.key] ?? '')"
                  :label="itemLabelFor(sub)"
                  :hint="itemHintFor(sub)"
                  persistent-hint
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                  @update:model-value="
                    updateObjectListItem(field, index, sub.key, $event)
                  "
                />
                <v-text-field
                  v-else-if="sub.type === 'integer' || sub.type === 'number'"
                  :model-value="item[sub.key]"
                  type="number"
                  :label="itemLabelFor(sub)"
                  :hint="itemHintFor(sub)"
                  persistent-hint
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                  :min="sub.min"
                  :max="sub.max"
                  @update:model-value="
                    updateObjectListItem(field, index, sub.key, $event)
                  "
                />
                <v-select
                  v-else-if="sub.type === 'enum'"
                  :model-value="String(item[sub.key] ?? '')"
                  :items="itemEnumItems(sub)"
                  item-title="title"
                  item-value="value"
                  :label="itemLabelFor(sub)"
                  :hint="itemHintFor(sub)"
                  persistent-hint
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                  @update:model-value="
                    updateObjectListItem(field, index, sub.key, $event)
                  "
                />
                <div
                  v-else-if="sub.type === 'text' && sub.widget === 'promptTemplate'"
                  class="plugin-prompt-template"
                >
                  <v-textarea
                    :model-value="displayTextValue(sub, item[sub.key])"
                    :label="itemLabelFor(sub)"
                    :hint="itemHintFor(sub)"
                    persistent-hint
                    variant="outlined"
                    density="compact"
                    auto-grow
                    rows="3"
                    :max-rows="12"
                    hide-details="auto"
                    @update:model-value="
                      updateObjectListItem(field, index, sub.key, $event)
                    "
                  />
                  <v-btn
                    v-if="sub.defaultKey"
                    variant="text"
                    size="small"
                    class="mt-1"
                    @click="
                      restoreDefaultPrompt(sub, (v) =>
                        updateObjectListItem(field, index, sub.key, v),
                      )
                    "
                  >
                    {{ restoreDefaultLabel() }}
                  </v-btn>
                </div>
                <v-textarea
                  v-else-if="sub.type === 'text'"
                  :model-value="String(item[sub.key] ?? '')"
                  :label="itemLabelFor(sub)"
                  :hint="itemHintFor(sub)"
                  persistent-hint
                  variant="outlined"
                  density="compact"
                  auto-grow
                  rows="3"
                  :max-rows="12"
                  hide-details="auto"
                  @update:model-value="
                    updateObjectListItem(field, index, sub.key, $event)
                  "
                />
              </template>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
          <v-btn
            variant="tonal"
            size="small"
            prepend-icon="mdi-plus"
            @click="addObjectListItem(field)"
          >
            {{ addObjectListLabel() }}
          </v-btn>
        </div>

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
.plugin-object-list__panels {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}
.plugin-object-list__panels :deep(.v-expansion-panel) {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.plugin-object-list__panels :deep(.v-expansion-panel:last-child) {
  border-bottom: none;
}
</style>
