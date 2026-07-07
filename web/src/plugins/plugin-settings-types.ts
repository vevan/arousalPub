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
  widget?: 'promptTemplate' | 'jsonSampleState'
}

export interface PluginSettingsBundleSelectConfig {
  /** objectList 字段 key，选项来自其 id / label */
  listFieldKey: string
  /** 内置 bundle id（如默认场景包） */
  builtinValue?: string
  builtinLabelKey?: string
  /** 会话设置：首项「继承全局」空值 */
  inheritOption?: boolean
  inheritLabelKey?: string
}

export interface PluginSettingsInheritTriModeSheetListConfig {
  /** 全局 settings 中 objectList 字段 key（如 sheets） */
  globalListFieldKey: string
  /** 全局条目 enabled 字段 key；默认 enabled */
  globalEnabledFieldKey?: string
  labelKey: string
  emptyLabelKey?: string
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
  widget?: 'slider' | 'promptTemplate' | 'bundleSelect' | 'inheritTriMode' | 'inheritTriModeSheetList'
  step?: number
  required?: boolean
  defaultKey?: string
  itemFields?: PluginSettingsItemFieldSchema[]
  conversationInherit?: boolean
  inheritFromGlobalKey?: string
  /** string + widget bundleSelect */
  bundleSelect?: PluginSettingsBundleSelectConfig
  /** text + widget inheritTriModeSheetList */
  inheritTriModeSheetList?: PluginSettingsInheritTriModeSheetListConfig
  /** objectList 额外校验规则 */
  objectListValidation?: 'bundleList'
  /** 为 false 时跳过 jsonSampleState 子字段 JSON 校验 */
  validateSampleStateWhen?: string
  /** 新建 objectList 项时保留的 id（不可被 allocateShortId 占用） */
  reservedObjectListIds?: string[]
  /** 对话设置：字段下方挂载 companion 面板（opaque id，由宿主 slot 解析） */
  companionPanel?: string
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
  /** 全局设置对话框 max-width（px） */
  dialogMaxWidth?: number
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
