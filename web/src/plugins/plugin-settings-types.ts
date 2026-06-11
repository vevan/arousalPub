export type PluginSettingsFieldType =
  | 'boolean'
  | 'integer'
  | 'number'
  | 'string'
  | 'text'
  | 'enum'
  | 'fileAsset'
  | 'apiPreset'
  | 'lorebook'
  | 'objectList'
  | 'checkboxGroup'

export type PluginSettingsOptionsSource = 'regex-rules'

export interface PluginSettingsOptionsFilter {
  enabled?: boolean
  phases?: string[]
}

export interface PluginSettingsCheckboxOption {
  value: string
  label?: string
  labelKey?: string
}

export type PluginSettingsItemFieldType =
  | 'boolean'
  | 'integer'
  | 'number'
  | 'string'
  | 'text'
  | 'enum'

export interface PluginSettingsItemFieldSchema {
  key: string
  type: PluginSettingsItemFieldType
  labelKey: string
  descriptionKey?: string
  default?: unknown
  min?: number
  max?: number
  maxLength?: number
  enum?: string[]
  required?: boolean
  defaultKey?: string
  widget?: 'promptTemplate'
}

export interface PluginSettingsFieldSchema {
  key: string
  type: PluginSettingsFieldType
  labelKey: string
  descriptionKey?: string
  default?: unknown
  min?: number
  max?: number
  maxLength?: number
  enum?: string[]
  accept?: string[]
  purpose?: string
  visibleWhen?: { field: string; equals: unknown }
  widget?: 'slider' | 'promptTemplate'
  step?: number
  required?: boolean
  defaultKey?: string
  itemFields?: PluginSettingsItemFieldSchema[]
  conversationInherit?: boolean
  inheritFromGlobalKey?: string
  /** checkboxGroup：静态选项（与 optionsSource 二选一） */
  options?: PluginSettingsCheckboxOption[]
  /** checkboxGroup：动态选项源 */
  optionsSource?: PluginSettingsOptionsSource
  optionsFilter?: PluginSettingsOptionsFilter
  /** checkboxGroup：折叠展示选项列表（标题行仍可见，并显示已选数量） */
  collapsible?: boolean
  /** checkboxGroup：折叠面板内额外渲染的字段 key（须为同 schema 中的其它字段） */
  panelFieldKeys?: string[]
}

export interface PluginSettingsSchema {
  version: number
  fields: PluginSettingsFieldSchema[]
}

export interface PluginManageEntry {
  id: string
  name: string
  version: string
  enabled: boolean
  order: number
  hooks: string[]
  slots: string[]
  settingsSchema: PluginSettingsSchema | null
  hasSettings: boolean
  conversationSettingsSchema: PluginSettingsSchema | null
  hasConversationSettings: boolean
}
