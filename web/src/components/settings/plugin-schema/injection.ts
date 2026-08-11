import type { InjectionKey, ComputedRef, Ref } from 'vue'
import { inject } from 'vue'
import type {
  PluginSettingsFieldSchema,
  PluginSettingsItemFieldSchema,
} from '@/plugins/plugin-settings-types'
import type { InheritTriMode } from '@/utils/plugin-inherit-tri-mode'
import type { PluginSchemaSelectItem } from '@/utils/plugin-schema-selects'

export type PluginSchemaFormApi = {
  pluginId: Ref<string>
  modelValue: Ref<Record<string, unknown>>
  globalSettings: Ref<Record<string, unknown> | undefined>
  deferTextCommit: ComputedRef<boolean>
  fields: Ref<PluginSettingsFieldSchema[]>

  fieldValue: (key: string) => unknown
  setField: (key: string, value: unknown) => void
  labelFor: (field: PluginSettingsFieldSchema) => string
  hintFor: (field: PluginSettingsFieldSchema) => string | undefined
  fullHintFor: (field: PluginSettingsFieldSchema) => string | undefined
  companionLinesFor: (fieldKey: string) => string[]

  textDraftGet: (key: string, stored: unknown) => string
  onTextInput: (
    key: string,
    value: unknown,
    getStored: () => unknown,
    commit: (v: string) => void,
  ) => void
  onTextBlur: (
    key: string,
    getStored: () => unknown,
    commit: (v: string) => void,
  ) => void

  displayTextValue: (
    field: PluginSettingsFieldSchema | PluginSettingsItemFieldSchema,
    value: unknown,
  ) => string
  restoreDefaultPrompt: (
    field: PluginSettingsFieldSchema | PluginSettingsItemFieldSchema,
    setValue: (v: string) => void,
  ) => void
  restoreDefaultLabel: () => string

  sliderValue: (field: PluginSettingsFieldSchema) => number
  sliderStep: (field: PluginSettingsFieldSchema) => number
  sliderReadout: (field: PluginSettingsFieldSchema) => string
  inheritNumberDisplay: (field: PluginSettingsFieldSchema) => string | number
  setInheritNumberField: (
    field: PluginSettingsFieldSchema,
    value: string | number | null,
  ) => void

  enumItems: ComputedRef<
    (field: PluginSettingsFieldSchema) => { title: string; value: string }[]
  >

  checkboxOptionsFor: (field: PluginSettingsFieldSchema) => PluginSchemaSelectItem[]
  checkboxGroupSummary: (field: PluginSettingsFieldSchema) => string
  isCheckboxSelected: (key: string, value: string) => boolean
  toggleCheckbox: (key: string, value: string, checked: boolean | null) => void
  optionsSourceLoading: Ref<boolean>
  fieldSchemaByKey: (
    key: string,
    fields: PluginSettingsFieldSchema[],
  ) => PluginSettingsFieldSchema | undefined

  resourceSelectItems: (field: PluginSettingsFieldSchema) => PluginSchemaSelectItem[]
  resourceSelectClearable: (field: PluginSettingsFieldSchema) => boolean
  setResourceSelectField: (field: PluginSettingsFieldSchema, value: unknown) => void
  selectsLoading: Ref<boolean>
  apiPresetSelectHint: (field: PluginSettingsFieldSchema) => string | undefined

  inheritTriModeItems: (
    inheritLabel: string,
  ) => { title: string; value: InheritTriMode }[]
  inheritTriModeGlobalLabel: (field: PluginSettingsFieldSchema) => string
  setInheritTriModeBoolean: (
    field: PluginSettingsFieldSchema,
    mode: InheritTriMode,
  ) => void
  inheritTriModeSheetRows: (
    field: PluginSettingsFieldSchema,
  ) => Record<string, unknown>[]
  inheritTriModeSheetItems: (
    sheet: Record<string, unknown>,
  ) => { title: string; value: InheritTriMode }[]
  setInheritTriModeSheet: (
    field: PluginSettingsFieldSchema,
    sheetId: string,
    mode: InheritTriMode,
  ) => void

  objectListItems: (field: PluginSettingsFieldSchema) => Record<string, unknown>[]
  addObjectListItem: (field: PluginSettingsFieldSchema) => void
  updateObjectListItem: (
    field: PluginSettingsFieldSchema,
    index: number,
    itemKey: string,
    value: unknown,
  ) => void
  objectListPanelKey: (field: PluginSettingsFieldSchema, index: number) => string
  objectListItemTitle: (item: Record<string, unknown>, index: number) => string
  addObjectListLabel: () => string
  removeItemLabel: () => string
  requestRemoveObjectListItem: (
    field: PluginSettingsFieldSchema,
    index: number,
  ) => void
  onObjectListTextBlur: (
    field: PluginSettingsFieldSchema,
    index: number,
    sub: PluginSettingsItemFieldSchema,
    getStored: () => unknown,
    commit: (v: string) => void,
  ) => void
  itemLabelFor: (field: PluginSettingsItemFieldSchema) => string
  itemHintFor: (field: PluginSettingsItemFieldSchema) => string | undefined
  itemEnumItems: (
    field: PluginSettingsItemFieldSchema,
  ) => { title: string; value: string }[]
  objectListTextDraftKey: (
    fieldKey: string,
    index: number,
    subKey: string,
  ) => string
  objectListRemoveOpen: Ref<boolean>
  objectListRemoveTitle: ComputedRef<string>
  cancelRemoveObjectListItem: () => void
  confirmRemoveObjectListItem: () => void

  isBundleSelectField: (field: PluginSettingsFieldSchema) => boolean
  bundleSelectOptions: (
    field: PluginSettingsFieldSchema,
  ) => { title: string; value: string }[]

  bundledAssetPreviewUrl: (field: PluginSettingsFieldSchema) => string | null
  fileAccept: (field: PluginSettingsFieldSchema) => string
  previewUrl: (field: PluginSettingsFieldSchema) => string | null
  onFilePicked: (
    field: PluginSettingsFieldSchema,
    files: File[] | File | null,
  ) => Promise<void>
  uploadingKey: Ref<string | null>
  uploadError: Ref<string>
}

export const PLUGIN_SCHEMA_FORM_KEY: InjectionKey<PluginSchemaFormApi> =
  Symbol('pluginSchemaForm')

export function usePluginSchemaFormApi(): PluginSchemaFormApi {
  const api = inject(PLUGIN_SCHEMA_FORM_KEY)
  if (!api) {
    throw new Error('PluginSchemaFormApi not provided')
  }
  return api
}
