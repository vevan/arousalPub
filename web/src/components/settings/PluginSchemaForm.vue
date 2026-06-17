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
} from '@/utils/plugin-settings-validate'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import {
  loadApiPresetSelectItems,
  loadLorebookSelectItems,
  needsApiPresetSelect,
  needsLorebookSelect,
  type PluginSchemaSelectItem,
} from '@/utils/plugin-schema-selects'
import {
  fieldsUsingOptionsSource,
  loadCheckboxOptionsForField,
  optionsSourceCacheKey,
} from '@/utils/plugin-settings-options-source'
import { parseCheckboxGroupField } from '@/utils/plugin-settings-validate'
import {
  TRACE_KEEPER_PLUGIN_ID,
  traceKeeperBundleSelectItems,
  traceKeeperConvBundleSelectItems,
} from '@/utils/trace-keeper-settings-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  pluginId: string
  fields: PluginSettingsFieldSchema[]
  modelValue: Record<string, unknown>
  /** 会话 schema：展示 inheritFromGlobalKey 对应的全局值 */
  globalSettings?: Record<string, unknown>
  /** 某字段下方的补充说明行（如 plot-summary 自动摘要进度） */
  fieldCompanionLines?: (fieldKey: string) => string[] | undefined
  /** 文本字段失焦后再提交，避免逐字触发保存 */
  deferTextCommit?: boolean
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
const optionsSourceLoading = ref(false)
const checkboxOptionsByKey = ref<Record<string, PluginSchemaSelectItem[]>>({})
const textDraftValues = ref<Record<string, string>>({})
type TextDraftBinding = {
  getStored: () => unknown
  commit: (value: string) => void
}
const textDraftBindings = new Map<string, TextDraftBinding>()

function textDraftGet(key: string, stored: unknown): string {
  if (key in textDraftValues.value) return textDraftValues.value[key]!
  return String(stored ?? '')
}

function textDraftSet(key: string, value: string) {
  textDraftValues.value = { ...textDraftValues.value, [key]: value }
}

function textDraftCommit(
  key: string,
  stored: unknown,
  commit: (value: string) => void,
) {
  const draft = textDraftValues.value[key]
  if (draft === undefined) return
  const cur = String(stored ?? '')
  if (draft !== cur) commit(draft)
  const next = { ...textDraftValues.value }
  delete next[key]
  textDraftValues.value = next
  textDraftBindings.delete(key)
}

function onTextInput(
  key: string,
  value: unknown,
  getStored: () => unknown,
  commit: (v: string) => void,
) {
  const text = String(value ?? '')
  if (props.deferTextCommit) {
    textDraftSet(key, text)
    textDraftBindings.set(key, { getStored, commit })
    return
  }
  commit(text)
}

function onTextBlur(
  key: string,
  getStored: () => unknown,
  commit: (v: string) => void,
) {
  if (props.deferTextCommit) {
    textDraftCommit(key, getStored(), commit)
  }
}

function commitAllTextDrafts() {
  if (!props.deferTextCommit) return
  for (const [key, binding] of [...textDraftBindings.entries()]) {
    if (!(key in textDraftValues.value)) continue
    textDraftCommit(key, binding.getStored(), binding.commit)
  }
}

watch(
  () => props.modelValue,
  () => {
    textDraftValues.value = {}
    textDraftBindings.clear()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  commitAllTextDrafts()
})

async function loadResourceSelects() {
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
}

async function loadOptionsSources() {
  const fields = fieldsUsingOptionsSource(props.fields)
  if (fields.length === 0) return
  optionsSourceLoading.value = true
  try {
    const entries = await Promise.all(
      fields.map(async (field) => {
        const items = await loadCheckboxOptionsForField(field)
        return [optionsSourceCacheKey(field), items] as const
      }),
    )
    const next: Record<string, PluginSchemaSelectItem[]> = {
      ...checkboxOptionsByKey.value,
    }
    for (const [key, items] of entries) {
      next[key] = items
    }
    checkboxOptionsByKey.value = next
  } finally {
    optionsSourceLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadResourceSelects(), loadOptionsSources()])
})

watch(
  () => props.fields,
  () => {
    void loadResourceSelects()
    void loadOptionsSources()
  },
)

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
  _field: PluginSettingsFieldSchema | PluginSettingsItemFieldSchema,
  value: unknown,
): string {
  return String(value ?? '')
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

function checkboxValues(key: string): string[] {
  return parseCheckboxGroupField(fieldValue(key))
}

function isCheckboxSelected(key: string, value: string): boolean {
  return checkboxValues(key).includes(value)
}

function toggleCheckbox(key: string, value: string, checked: boolean | null) {
  const cur = checkboxValues(key)
  const next =
    checked === true
      ? [...new Set([...cur, value])]
      : cur.filter((x) => x !== value)
  setField(key, next)
}

function checkboxOptionsFor(field: PluginSettingsFieldSchema): PluginSchemaSelectItem[] {
  if (field.optionsSource) {
    return checkboxOptionsByKey.value[optionsSourceCacheKey(field)] ?? []
  }
  return (field.options ?? []).map((o) => {
    let title = o.label?.trim() || ''
    if (!title && o.labelKey) {
      const key = pluginI18nKey(props.pluginId, o.labelKey)
      title = te(key) ? pluginText(key) : o.labelKey
    }
    return { value: o.value, title: title || o.value }
  })
}

function checkboxGroupSummary(field: PluginSettingsFieldSchema): string {
  const total = checkboxOptionsFor(field).length
  if (total === 0) return ''
  const selected = checkboxValues(field.key).length
  if (selected > 0) {
    return t('settings.plugins.checkboxGroupSelectedSummary', { selected, total })
  }
  return t('settings.plugins.checkboxGroupNoneSelected', { total })
}

function panelNestedFieldKeys(fields: PluginSettingsFieldSchema[]): Set<string> {
  const keys = new Set<string>()
  for (const f of fields) {
    if (f.type === 'checkboxGroup' && f.panelFieldKeys?.length) {
      for (const k of f.panelFieldKeys) keys.add(k)
    }
  }
  return keys
}

function fieldSchemaByKey(
  key: string,
  fields: PluginSettingsFieldSchema[],
): PluginSettingsFieldSchema | undefined {
  return fields.find((f) => f.key === key)
}

function isFieldVisible(field: PluginSettingsFieldSchema): boolean {
  const vw = field.visibleWhen
  if (vw && fieldValue(vw.field) !== vw.equals) return false
  return !panelNestedFieldKeys(props.fields).has(field.key)
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
  setField(field.key, items)
}

function addObjectListItem(field: PluginSettingsFieldSchema) {
  const itemFields = field.itemFields ?? []
  const items = [...objectListItems(field)]
  const usedIds = new Set(
    items
      .map((item) => String(item.id ?? '').trim())
      .filter((id) => id.length > 0),
  )
  items.push(newObjectListItem(itemFields, props.pluginId, t, te, usedIds))
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

function objectListPanelKey(
  field: PluginSettingsFieldSchema,
  index: number,
): string {
  return `${field.key}-row-${index}`
}

function objectListItemTitle(
  item: Record<string, unknown>,
  index: number,
): string {
  const name = String(item.label ?? item.name ?? '').trim()
  if (name) return name
  const pluginKey = pluginI18nKey(props.pluginId, 'objectListItemUntitled')
  if (te(pluginKey)) {
    return t(pluginKey, { index: index + 1 })
  }
  const globalKey = 'settings.plugins.objectListItemUntitled'
  if (te(globalKey)) {
    return t(globalKey, { index: index + 1 })
  }
  return `List item ${index + 1}`
}

function addObjectListLabel(): string {
  const pluginKey = pluginI18nKey(props.pluginId, 'objectListAddItem')
  if (te(pluginKey)) return t(pluginKey)
  const globalKey = 'settings.plugins.objectListAddItem'
  if (te(globalKey)) return t(globalKey)
  return te('settings.plugins.addItem') ? t('settings.plugins.addItem') : 'Add'
}

function removeItemLabel(): string {
  return te('settings.plugins.removeItem')
    ? t('settings.plugins.removeItem')
    : 'Remove'
}

const objectListRemoveOpen = ref(false)
const objectListRemovePending = ref<{
  fieldKey: string
  index: number
  title: string
} | null>(null)

const objectListRemoveTitle = computed(
  () => objectListRemovePending.value?.title ?? '',
)

function requestRemoveObjectListItem(
  field: PluginSettingsFieldSchema,
  index: number,
) {
  const item = objectListItems(field)[index]
  if (!item) return
  objectListRemovePending.value = {
    fieldKey: field.key,
    index,
    title: objectListItemTitle(item, index),
  }
  objectListRemoveOpen.value = true
}

function isTraceKeeperActiveBundleField(field: PluginSettingsFieldSchema): boolean {
  return (
    props.pluginId === TRACE_KEEPER_PLUGIN_ID && field.key === 'activeBundleId'
  )
}

function isTraceKeeperConvBundleField(field: PluginSettingsFieldSchema): boolean {
  return props.pluginId === TRACE_KEEPER_PLUGIN_ID && field.key === 'bundleId'
}

function traceKeeperUserBundleOptions(): { title: string; value: string }[] {
  return traceKeeperBundleSelectItems(props.modelValue, props.pluginId, t, te)
}

function traceKeeperConvBundleOptions(): { title: string; value: string }[] {
  return traceKeeperConvBundleSelectItems(
    props.globalSettings ?? {},
    props.pluginId,
    t,
    te,
  )
}

function cancelRemoveObjectListItem() {
  objectListRemoveOpen.value = false
  objectListRemovePending.value = null
}

function confirmRemoveObjectListItem() {
  const pending = objectListRemovePending.value
  if (!pending) return
  const field = props.fields.find(
    (f) => f.key === pending.fieldKey && f.type === 'objectList',
  )
  if (field) removeObjectListItem(field, pending.index)
  cancelRemoveObjectListItem()
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

        <div
          v-else-if="field.type === 'checkboxGroup'"
          class="plugin-schema-form__checkbox-group"
        >
          <template v-if="field.collapsible">
            <v-expansion-panels
              variant="accordion"
              class="plugin-schema-form__checkbox-group-panels"
            >
              <v-expansion-panel>
                <v-expansion-panel-title class="text-body-2 py-2">
                  <div class="d-flex flex-column align-start min-w-0">
                    <span class="font-weight-medium">{{ labelFor(field) }}</span>
                    <span
                      v-if="checkboxGroupSummary(field)"
                      class="text-caption text-medium-emphasis text-truncate"
                    >
                      {{ checkboxGroupSummary(field) }}
                    </span>
                  </div>
                </v-expansion-panel-title>
                <v-expansion-panel-text class="pt-1">
                  <p
                    v-if="fullHintFor(field)"
                    class="text-caption text-medium-emphasis mb-2"
                  >
                    {{ fullHintFor(field) }}
                  </p>
                  <v-progress-linear
                    v-if="optionsSourceLoading && field.optionsSource"
                    indeterminate
                    color="primary"
                    class="mb-2"
                  />
                  <div
                    v-if="checkboxOptionsFor(field).length > 0"
                    class="plugin-schema-form__checkbox-group-scroll"
                  >
                    <v-checkbox
                      v-for="opt in checkboxOptionsFor(field)"
                      :key="opt.value"
                      :model-value="isCheckboxSelected(field.key, opt.value)"
                      :label="opt.title"
                      hide-details
                      density="compact"
                      @update:model-value="toggleCheckbox(field.key, opt.value, $event)"
                    />
                  </div>
                  <p
                    v-else-if="!optionsSourceLoading || !field.optionsSource"
                    class="text-caption text-medium-emphasis mb-0"
                  >
                    {{ t('settings.plugins.checkboxGroupEmpty') }}
                  </p>
                  <template
                    v-for="panelKey in field.panelFieldKeys ?? []"
                    :key="panelKey"
                  >
                    <v-switch
                      v-if="fieldSchemaByKey(panelKey, fields)?.type === 'boolean'"
                      :model-value="Boolean(fieldValue(panelKey))"
                      :label="labelFor(fieldSchemaByKey(panelKey, fields)!)"
                      :hint="fullHintFor(fieldSchemaByKey(panelKey, fields)!)"
                      persistent-hint
                      color="primary"
                      hide-details="auto"
                      class="mt-2"
                      @update:model-value="setField(panelKey, $event)"
                    />
                  </template>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </template>
          <template v-else>
            <div class="text-body-2 font-weight-medium mb-1">
              {{ labelFor(field) }}
            </div>
            <p
              v-if="fullHintFor(field)"
              class="text-caption text-medium-emphasis mb-2"
            >
              {{ fullHintFor(field) }}
            </p>
            <v-progress-linear
              v-if="optionsSourceLoading && field.optionsSource"
              indeterminate
              color="primary"
              class="mb-2"
            />
            <template v-if="checkboxOptionsFor(field).length > 0">
              <v-checkbox
                v-for="opt in checkboxOptionsFor(field)"
                :key="opt.value"
                :model-value="isCheckboxSelected(field.key, opt.value)"
                :label="opt.title"
                hide-details
                density="compact"
                @update:model-value="toggleCheckbox(field.key, opt.value, $event)"
              />
            </template>
            <p
              v-else-if="!optionsSourceLoading || !field.optionsSource"
              class="text-caption text-medium-emphasis mb-0"
            >
              {{ t('settings.plugins.checkboxGroupEmpty') }}
            </p>
          </template>
        </div>

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
            :model-value="
              deferTextCommit
                ? textDraftGet(
                    field.key,
                    displayTextValue(field, fieldValue(field.key)),
                  )
                : displayTextValue(field, fieldValue(field.key))
            "
            :label="labelFor(field)"
            :hint="hintFor(field)"
            persistent-hint
            variant="outlined"
            density="compact"
            auto-grow
            rows="4"
            :max-rows="16"
            hide-details="auto"
            @update:model-value="
              onTextInput(
                field.key,
                $event,
                () => displayTextValue(field, fieldValue(field.key)),
                (v) => setField(field.key, v),
              )
            "
            @blur="
              onTextBlur(
                field.key,
                () => displayTextValue(field, fieldValue(field.key)),
                (v) => setField(field.key, v),
              )
            "
          />
          <v-btn
            v-if="field.defaultKey"
            variant="tonal"
            color="primary"
            size="small"
            prepend-icon="mdi-backup-restore"
            class="mt-1 text-none"
            @click="restoreDefaultPrompt(field, (v) => setField(field.key, v))"
          >
            {{ restoreDefaultLabel() }}
          </v-btn>
        </div>

        <v-textarea
          v-else-if="field.type === 'text'"
          :model-value="
            deferTextCommit
              ? textDraftGet(field.key, fieldValue(field.key))
              : String(fieldValue(field.key) ?? '')
          "
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          auto-grow
          rows="4"
          :max-rows="16"
          hide-details="auto"
          @update:model-value="
            onTextInput(
              field.key,
              $event,
              () => fieldValue(field.key),
              (v) => setField(field.key, v),
            )
          "
          @blur="
            onTextBlur(
              field.key,
              () => fieldValue(field.key),
              (v) => setField(field.key, v),
            )
          "
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
              :key="objectListPanelKey(field, index)"
              class="plugin-object-list__item"
            >
              <v-expansion-panel-title class="text-subtitle-2 py-2">
                <span class="text-truncate">{{ objectListItemTitle(item, index) }}</span>
              </v-expansion-panel-title>
              <v-expansion-panel-text class="plugin-object-list__body pt-2">
              <div class="d-flex flex-column ga-4">
              <div
                v-for="sub in field.itemFields ?? []"
                :key="sub.key"
                class="plugin-object-list__field"
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
                  :model-value="
                    deferTextCommit
                      ? textDraftGet(
                          `ol:${field.key}:${index}:${sub.key}`,
                          item[sub.key],
                        )
                      : String(item[sub.key] ?? '')
                  "
                  :label="itemLabelFor(sub)"
                  :hint="itemHintFor(sub)"
                  persistent-hint
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                  @update:model-value="
                    onTextInput(
                      `ol:${field.key}:${index}:${sub.key}`,
                      $event,
                      () => item[sub.key],
                      (v) => updateObjectListItem(field, index, sub.key, v),
                    )
                  "
                  @blur="
                    onTextBlur(
                      `ol:${field.key}:${index}:${sub.key}`,
                      () => item[sub.key],
                      (v) => updateObjectListItem(field, index, sub.key, v),
                    )
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
                    :model-value="
                      deferTextCommit
                        ? textDraftGet(
                            `ol:${field.key}:${index}:${sub.key}`,
                            displayTextValue(sub, item[sub.key]),
                          )
                        : displayTextValue(sub, item[sub.key])
                    "
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
                      onTextInput(
                        `ol:${field.key}:${index}:${sub.key}`,
                        $event,
                        () => displayTextValue(sub, item[sub.key]),
                        (v) => updateObjectListItem(field, index, sub.key, v),
                      )
                    "
                    @blur="
                      onTextBlur(
                        `ol:${field.key}:${index}:${sub.key}`,
                        () => displayTextValue(sub, item[sub.key]),
                        (v) => updateObjectListItem(field, index, sub.key, v),
                      )
                    "
                  />
                  <v-btn
                    v-if="sub.defaultKey"
                    variant="tonal"
                    color="primary"
                    size="small"
                    prepend-icon="mdi-backup-restore"
                    class="mt-1 text-none"
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
                  :model-value="
                    deferTextCommit
                      ? textDraftGet(
                          `ol:${field.key}:${index}:${sub.key}`,
                          item[sub.key],
                        )
                      : String(item[sub.key] ?? '')
                  "
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
                    onTextInput(
                      `ol:${field.key}:${index}:${sub.key}`,
                      $event,
                      () => item[sub.key],
                      (v) => updateObjectListItem(field, index, sub.key, v),
                    )
                  "
                  @blur="
                    onTextBlur(
                      `ol:${field.key}:${index}:${sub.key}`,
                      () => item[sub.key],
                      (v) => updateObjectListItem(field, index, sub.key, v),
                    )
                  "
                />
              </div>
              <div class="plugin-object-list__remove">
                <v-btn
                  variant="outlined"
                  color="error"
                  size="small"
                  prepend-icon="mdi-delete-outline"
                  class="text-none"
                  @click="requestRemoveObjectListItem(field, index)"
                >
                  {{ removeItemLabel() }}
                </v-btn>
              </div>
              </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
          <v-btn
            variant="tonal"
            color="primary"
            size="small"
            prepend-icon="mdi-plus"
            class="text-none"
            @click="addObjectListItem(field)"
          >
            {{ addObjectListLabel() }}
          </v-btn>
        </div>

        <v-select
          v-else-if="
            field.type === 'string' &&
            (isTraceKeeperActiveBundleField(field) ||
              isTraceKeeperConvBundleField(field))
          "
          :model-value="String(fieldValue(field.key) ?? '')"
          :items="
            isTraceKeeperConvBundleField(field)
              ? traceKeeperConvBundleOptions()
              : traceKeeperUserBundleOptions()
          "
          item-title="title"
          item-value="value"
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          @update:model-value="setField(field.key, $event ?? '')"
        />

        <v-text-field
          v-else-if="field.type === 'string'"
          :model-value="
            deferTextCommit
              ? textDraftGet(field.key, fieldValue(field.key))
              : String(fieldValue(field.key) ?? '')
          "
          :label="labelFor(field)"
          :hint="hintFor(field)"
          persistent-hint
          variant="outlined"
          density="compact"
          hide-details="auto"
          @update:model-value="
            onTextInput(
              field.key,
              $event,
              () => fieldValue(field.key),
              (v) => setField(field.key, v),
            )
          "
          @blur="
            onTextBlur(
              field.key,
              () => fieldValue(field.key),
              (v) => setField(field.key, v),
            )
          "
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

    <v-dialog
      v-model="objectListRemoveOpen"
      max-width="400"
      @click:outside="cancelRemoveObjectListItem"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ t('settings.plugins.removeItemConfirmTitle') }}
        </v-card-title>
        <v-card-text class="text-body-2">
          {{
            t('settings.plugins.removeItemConfirmBody', {
              name: objectListRemoveTitle,
            })
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            @click="cancelRemoveObjectListItem"
          >
            {{ t('settings.plugins.removeItemCancel') }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            @click="confirmRemoveObjectListItem"
          >
            {{ t('settings.plugins.removeItemConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
  overflow: hidden;
}
.plugin-object-list__body :deep(.v-input) {
  margin-bottom: 2px;
}
.plugin-object-list__field + .plugin-object-list__field {
  margin-top: 2px;
}
.plugin-prompt-template :deep(.v-btn) {
  margin-bottom: 4px;
}
.plugin-object-list__remove {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.plugin-schema-form__checkbox-group-panels {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
}
.plugin-schema-form__checkbox-group-scroll {
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}
</style>
