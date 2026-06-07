import type { ChatMessage } from '../assemble-prompts.js'
import type { PromptMacroContext } from '../prompt-macros/types.js'
import type { ChatPluginsBody, TurnPluginEntry } from '../plugin-types.js'

export interface PluginRegistryEntry {
  id: string
  enabled: boolean
  order: number
}

export interface PluginRegistryDocument {
  version: number
  plugins: PluginRegistryEntry[]
}

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
  /** 表单控件：`slider` 用于 number/integer；`promptTemplate` 用于带恢复默认的 text */
  widget?: 'slider' | 'promptTemplate'
  step?: number
  required?: boolean
  defaultKey?: string
  itemFields?: PluginSettingsItemFieldSchema[]
}

export interface PluginSettingsSchema {
  version: number
  fields: PluginSettingsFieldSchema[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  permissions?: string[]
  hooks?: string[]
  ui?: {
    slots?: Array<{ name: string; entry?: string }>
  }
  connection?: { policy?: string }
  settingsSchema?: PluginSettingsSchema
}

export interface PluginServerHostApi {
  applyPromptMacroPipeline: (
    text: string,
    macroContext: PromptMacroContext,
  ) => string
  getUserPluginSettings: (
    pluginId: string,
  ) => Promise<Record<string, unknown>>
}

export interface AfterAssemblePromptsPluginContext {
  pluginId: string
  messages: ChatMessage[]
  macroContext: PromptMacroContext
  plugins?: ChatPluginsBody | null
}

export interface LoadedServerPlugin {
  id: string
  order: number
  module: PluginServerModule
}

export interface PluginServerModule {
  afterAssemblePrompts?: (
    ctx: AfterAssemblePromptsPluginContext,
    api: PluginServerHostApi,
  ) => ChatMessage[] | Promise<ChatMessage[]>
  resolveTurnPluginEntries?: (
    plugins: ChatPluginsBody | null | undefined,
    api: PluginServerHostApi,
  ) => TurnPluginEntry[] | Promise<TurnPluginEntry[]>
}

export interface PluginRegistryPublicEntry {
  id: string
  name: string
  version: string
  order: number
  slots: string[]
  webEntry: string | null
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
