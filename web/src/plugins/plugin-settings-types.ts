export type PluginSettingsFieldType =
  | 'boolean'
  | 'integer'
  | 'number'
  | 'string'
  | 'text'
  | 'enum'
  | 'fileAsset'

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
  widget?: 'slider'
  step?: number
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
}
