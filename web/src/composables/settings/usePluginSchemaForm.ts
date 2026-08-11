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
  classifySampleStateJsonText,
  sampleStateInvalidJsonMessage,
  sampleStateJsonValidationEnabled,
  parseCheckboxGroupField,
} from '@/utils/plugin-settings-validate'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import { pluginSettingsBundleSelectItems } from '@/utils/plugin-settings-bundle-select'
import {
  applyInheritTriModeBoolean,
  applyInheritTriModeSheet,
  globalBooleanOn,
  globalSheetEnabledLabel,
  globalSheetsFromSettings,
  type InheritTriMode,
} from '@/utils/plugin-inherit-tri-mode'
import {
  loadApiPresetSelectItems,
  loadLorebookSelectItems,
  needsApiPresetSelect,
  needsLorebookSelect,
  type PluginSchemaSelectItem,
} from '@/utils/plugin-schema-selects'
import {
  apiPresetDisplayName,
  formatPluginApiPresetEffectiveHint,
  resolveGlobalPluginApiPresetEffective,
  resolvePluginApiPresetEffective,
} from '@/utils/plugin-api-preset-effective'
import { useConnectionStore } from '@/stores/connection'
import { storeToRefs } from 'pinia'
import {
  fieldsUsingOptionsSource,
  loadCheckboxOptionsForField,
  optionsSourceCacheKey,
} from '@/utils/plugin-settings-options-source'
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginSchemaFormApi } from '@/components/settings/plugin-schema/injection'

export type UsePluginSchemaFormProps = {
  pluginId: string
  fields: PluginSettingsFieldSchema[]
  modelValue: Record<string, unknown>
  globalSettings?: Record<string, unknown>
  fieldCompanionLines?: (fieldKey: string) => string[] | undefined
  deferTextCommit?: boolean
}

export type UsePluginSchemaFormEmit = {
  (e: 'update:modelValue', value: Record<string, unknown>): void
  (e: 'footer-validation-error', message: string | null): void
}

export function usePluginSchemaForm(
  props: UsePluginSchemaFormProps,
  emit: UsePluginSchemaFormEmit,
) {
  const { t, te } = useI18n()
  const connectionStore = useConnectionStore()
  const { activePresetId, presets } = storeToRefs(connectionStore)
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

  function objectListTextDraftKey(
    fieldKey: string,
    index: number,
    subKey: string,
  ): string {
    return `ol:${fieldKey}:${index}:${subKey}`
  }

  function isJsonSampleStateField(sub: PluginSettingsItemFieldSchema): boolean {
    return sub.widget === 'jsonSampleState'
  }

  function jsonSampleStateValidationEnabledForField(
    field: PluginSettingsFieldSchema,
  ): boolean {
    const sub = (field.itemFields ?? []).find(isJsonSampleStateField)
    if (!sub) return false
    const whenKey = field.validateSampleStateWhen ?? 'validateSampleStateJson'
    return sampleStateJsonValidationEnabled(props.modelValue, whenKey)
  }

  function jsonSampleStateSubKey(
    field: PluginSettingsFieldSchema,
  ): string | null {
    const sub = (field.itemFields ?? []).find(isJsonSampleStateField)
    return sub?.key ?? null
  }

  function peekJsonSampleStateValidationError(): string | null {
    for (const field of props.fields) {
      if (field.type !== 'objectList') continue
      if (!jsonSampleStateValidationEnabledForField(field)) continue
      const subKey = jsonSampleStateSubKey(field)
      if (!subKey) continue
      const items = parseObjectListField(props.modelValue[field.key])
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!
        const draftKey = objectListTextDraftKey(field.key, index, subKey)
        const text = textDraftGet(draftKey, item[subKey])
        if (classifySampleStateJsonText(text) === 'invalid') {
          return sampleStateInvalidJsonMessage(props.pluginId, t, te)
        }
      }
    }
    return null
  }

  function emitJsonSampleStateFooterValidationError() {
    emit('footer-validation-error', peekJsonSampleStateValidationError())
  }

  function onObjectListTextBlur(
    field: PluginSettingsFieldSchema,
    index: number,
    sub: PluginSettingsItemFieldSchema,
    getStored: () => unknown,
    commit: (v: string) => void,
  ) {
    const draftKey = objectListTextDraftKey(field.key, index, sub.key)
    onTextBlur(draftKey, getStored, commit)
    if (isJsonSampleStateField(sub)) {
      emitJsonSampleStateFooterValidationError()
    }
  }

  function validateAllJsonSampleStateFields(): string | null {
    const err = peekJsonSampleStateValidationError()
    emit('footer-validation-error', err)
    return err
  }

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

  function pruneTextDraftsOnModelChange() {
    if (!props.deferTextCommit) return
    let changed = false
    const nextDrafts = { ...textDraftValues.value }
    for (const [key, draft] of Object.entries(nextDrafts)) {
      const binding = textDraftBindings.get(key)
      if (!binding) {
        delete nextDrafts[key]
        changed = true
        continue
      }
      const stored = String(binding.getStored() ?? '')
      if (stored === draft) {
        delete nextDrafts[key]
        textDraftBindings.delete(key)
        changed = true
      }
    }
    if (changed) textDraftValues.value = nextDrafts
  }

  watch(
    () =>
      props.fields
        .filter((f) => f.type === 'objectList' && jsonSampleStateSubKey(f))
        .map(
          (f) =>
            props.modelValue[
              f.validateSampleStateWhen ?? 'validateSampleStateJson'
            ],
        ),
    () => {
      emitJsonSampleStateFooterValidationError()
    },
  )

  watch(
    () => props.pluginId,
    () => {
      textDraftValues.value = {}
      textDraftBindings.clear()
      emit('footer-validation-error', null)
    },
  )

  watch(
    () => props.modelValue,
    () => {
      pruneTextDraftsOnModelChange()
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

  function resourceSelectItems(
    field: PluginSettingsFieldSchema,
  ): PluginSchemaSelectItem[] {
    if (field.type === 'apiPreset') return apiPresetItems.value
    if (field.type === 'lorebook') return lorebookItems.value
    return []
  }

  function resourceSelectClearable(field: PluginSettingsFieldSchema): boolean {
    if (field.type === 'lorebook') return true
    if (field.type === 'apiPreset' && !field.required) return true
    return false
  }

  function setResourceSelectField(
    field: PluginSettingsFieldSchema,
    value: unknown,
  ) {
    const raw = value ?? ''
    const empty = typeof raw !== 'string' || !raw.trim()
    if (empty) {
      const next = { ...props.modelValue }
      delete next[field.key]
      emit('update:modelValue', next)
      return
    }
    setField(field.key, raw)
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

  function inheritGlobalHint(
    field: PluginSettingsFieldSchema,
  ): string | undefined {
    if (field.type === 'apiPreset') return undefined
    if (!field.conversationInherit || !field.inheritFromGlobalKey)
      return undefined
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

  function apiPresetEffectiveHint(
    field: PluginSettingsFieldSchema,
  ): string | undefined {
    if (field.type !== 'apiPreset') return undefined
    const inConversation = props.globalSettings !== undefined
    const globalKey = field.inheritFromGlobalKey ?? 'apiConfigId'
    const effective = inConversation
      ? resolvePluginApiPresetEffective({
          conversationApiConfigId: fieldValue(field.key),
          globalPluginApiConfigId: props.globalSettings?.[globalKey],
          activePresetId: activePresetId.value,
        })
      : resolveGlobalPluginApiPresetEffective({
          globalPluginApiConfigId: fieldValue(field.key),
          activePresetId: activePresetId.value,
        })
    if (!effective) return undefined
    const formatted = formatPluginApiPresetEffectiveHint(
      effective,
      apiPresetDisplayName(effective.presetId, {
        selectItems: apiPresetItems.value,
        presets: presets.value,
      }),
      (key, params) => (params ? t(key, params) : t(key)),
    )
    return formatted ?? undefined
  }

  function apiPresetSelectHint(
    field: PluginSettingsFieldSchema,
  ): string | undefined {
    const parts: string[] = []
    const desc = hintFor(field)
    if (desc) parts.push(desc)
    const eff = apiPresetEffectiveHint(field)
    if (eff) parts.push(eff)
    return parts.length > 0 ? parts.join('\n') : undefined
  }

  function isInheritNumberEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === ''
  }

  function inheritNumberDisplay(
    field: PluginSettingsFieldSchema,
  ): string | number {
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

  function itemHintFor(
    field: PluginSettingsItemFieldSchema,
  ): string | undefined {
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

  function checkboxOptionsFor(
    field: PluginSettingsFieldSchema,
  ): PluginSchemaSelectItem[] {
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
      return t('settings.plugins.checkboxGroupSelectedSummary', {
        selected,
        total,
      })
    }
    return t('settings.plugins.checkboxGroupNoneSelected', { total })
  }

  function panelNestedFieldKeys(
    fields: PluginSettingsFieldSchema[],
  ): Set<string> {
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

  async function onFilePicked(
    field: PluginSettingsFieldSchema,
    files: File[] | File | null,
  ) {
    uploadError.value = ''
    const file = Array.isArray(files) ? files[0] : files
    if (!file) return
    uploadingKey.value = field.key
    try {
      const filename = await uploadPluginUserAsset(
        props.pluginId,
        field.key,
        file,
      )
      setField(field.key, filename)
    } catch {
      uploadError.value = te(pluginI18nKey(props.pluginId, 'uploadFailed'))
        ? t(pluginI18nKey(props.pluginId, 'uploadFailed'))
        : t('settings.plugins.uploadFailed')
    } finally {
      uploadingKey.value = null
    }
  }

  function bundledAssetPreviewUrl(
    field: PluginSettingsFieldSchema,
  ): string | null {
    const rel = typeof field.assetPath === 'string' ? field.assetPath.trim() : ''
    if (!rel || rel.includes('..')) return null
    return pluginMediaUrl(props.pluginId, 'assets', rel)
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

  function objectListItems(
    field: PluginSettingsFieldSchema,
  ): Record<string, unknown>[] {
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
    items.push(
      newObjectListItem(
        itemFields,
        props.pluginId,
        t,
        te,
        usedIds,
        field.reservedObjectListIds,
      ),
    )
    setObjectListItems(field, items)
  }

  function removeObjectListItem(
    field: PluginSettingsFieldSchema,
    index: number,
  ) {
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
    return te('settings.plugins.addItem')
      ? t('settings.plugins.addItem')
      : 'Add'
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

  function isBundleSelectField(field: PluginSettingsFieldSchema): boolean {
    return (
      field.type === 'string' &&
      field.widget === 'bundleSelect' &&
      Boolean(field.bundleSelect?.listFieldKey)
    )
  }

  function bundleSelectOptions(
    field: PluginSettingsFieldSchema,
  ): { title: string; value: string }[] {
    const config = field.bundleSelect!
    const listModel = config.inheritOption
      ? (props.globalSettings ?? {})
      : props.modelValue
    return pluginSettingsBundleSelectItems(
      listModel,
      props.pluginId,
      config,
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

  function inheritTriModeItems(inheritLabel: string): {
    title: string
    value: InheritTriMode
  }[] {
    return [
      { title: inheritLabel, value: 'inherit' },
      { title: t('settings.plugins.inheritTriModeOn'), value: 'on' },
      { title: t('settings.plugins.inheritTriModeOff'), value: 'off' },
    ]
  }

  function inheritTriModeGlobalLabel(
    field: PluginSettingsFieldSchema,
  ): string {
    const globalKey = field.inheritFromGlobalKey ?? field.key
    const on = globalBooleanOn(props.globalSettings, globalKey)
    return on
      ? t('settings.plugins.inheritTriModeGlobalOn')
      : t('settings.plugins.inheritTriModeGlobalOff')
  }

  function setInheritTriModeBoolean(
    field: PluginSettingsFieldSchema,
    mode: InheritTriMode,
  ) {
    emit(
      'update:modelValue',
      applyInheritTriModeBoolean(props.modelValue, field.key, mode),
    )
  }

  function inheritTriModeSheetItems(
    sheet: Record<string, unknown>,
  ): { title: string; value: InheritTriMode }[] {
    const onLabel = t('settings.plugins.inheritTriModeGlobalOn')
    const offLabel = t('settings.plugins.inheritTriModeGlobalOff')
    const globalLabel = globalSheetEnabledLabel(sheet, onLabel, offLabel)
    return inheritTriModeItems(
      t('settings.plugins.inheritTriModeInherit', { value: globalLabel }),
    )
  }

  function setInheritTriModeSheet(
    _field: PluginSettingsFieldSchema,
    sheetId: string,
    mode: InheritTriMode,
  ) {
    emit(
      'update:modelValue',
      applyInheritTriModeSheet(props.modelValue, sheetId, mode),
    )
  }

  function inheritTriModeSheetRows(field: PluginSettingsFieldSchema) {
    const config = field.inheritTriModeSheetList
    if (!config) return []
    return globalSheetsFromSettings(
      props.globalSettings,
      config.globalListFieldKey,
    )
  }

  const api: PluginSchemaFormApi = {
    pluginId: toRef(props, 'pluginId'),
    modelValue: toRef(props, 'modelValue'),
    globalSettings: toRef(props, 'globalSettings'),
    deferTextCommit: computed(() => Boolean(props.deferTextCommit)),
    fields: toRef(props, 'fields'),

    fieldValue,
    setField,
    labelFor,
    hintFor,
    fullHintFor,
    companionLinesFor,

    textDraftGet,
    onTextInput,
    onTextBlur,

    displayTextValue,
    restoreDefaultPrompt,
    restoreDefaultLabel,

    sliderValue,
    sliderStep,
    sliderReadout,
    inheritNumberDisplay,
    setInheritNumberField,

    enumItems,

    checkboxOptionsFor,
    checkboxGroupSummary,
    isCheckboxSelected,
    toggleCheckbox,
    optionsSourceLoading,
    fieldSchemaByKey,

    resourceSelectItems,
    resourceSelectClearable,
    setResourceSelectField,
    selectsLoading,
    apiPresetSelectHint,

    inheritTriModeItems,
    inheritTriModeGlobalLabel,
    setInheritTriModeBoolean,
    inheritTriModeSheetRows,
    inheritTriModeSheetItems,
    setInheritTriModeSheet,

    objectListItems,
    addObjectListItem,
    updateObjectListItem,
    objectListPanelKey,
    objectListItemTitle,
    addObjectListLabel,
    removeItemLabel,
    requestRemoveObjectListItem,
    onObjectListTextBlur,
    itemLabelFor,
    itemHintFor,
    itemEnumItems,
    objectListTextDraftKey,
    objectListRemoveOpen,
    objectListRemoveTitle,
    cancelRemoveObjectListItem,
    confirmRemoveObjectListItem,

    isBundleSelectField,
    bundleSelectOptions,

    bundledAssetPreviewUrl,
    fileAccept,
    previewUrl,
    onFilePicked,
    uploadingKey,
    uploadError,
  }

  return {
    api,
    isFieldVisible,
    commitAllTextDrafts,
    validateAllJsonSampleStateFields,
  }
}
