import type { ChatMessage } from '../assemble-prompts.js'
import type {
  RegexApplyContext,
  RegexPhase,
  RegexRuleSummary,
} from '../regex-rules-types.js'
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

export interface PluginSettingsInheritTriModeSheetListConfig {
  globalListFieldKey: string
  globalEnabledFieldKey?: string
  labelKey: string
  emptyLabelKey?: string
}

export interface PluginSettingsBundleSelectConfig {
  listFieldKey: string
  builtinValue?: string
  builtinLabelKey?: string
  inheritOption?: boolean
  inheritLabelKey?: string
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
  widget?: 'slider' | 'promptTemplate' | 'bundleSelect' | 'inheritTriMode' | 'inheritTriModeSheetList'
  step?: number
  required?: boolean
  defaultKey?: string
  itemFields?: PluginSettingsItemFieldSchema[]
  /** 会话 schema：清空表单项时 PATCH null，继承全局 settings.json */
  conversationInherit?: boolean
  /** 与全局 settings 键名对应，用于 inherit hint */
  inheritFromGlobalKey?: string
  bundleSelect?: PluginSettingsBundleSelectConfig
  inheritTriModeSheetList?: PluginSettingsInheritTriModeSheetListConfig
  objectListValidation?: 'bundleList'
  validateSampleStateWhen?: string
  reservedObjectListIds?: string[]
  companionPanel?: string
  options?: PluginSettingsCheckboxOption[]
  optionsSource?: PluginSettingsOptionsSource
  optionsFilter?: PluginSettingsOptionsFilter
  collapsible?: boolean
  panelFieldKeys?: string[]
}

export interface PluginSettingsSchema {
  version: number
  fields: PluginSettingsFieldSchema[]
  dialogMaxWidth?: number
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  permissions?: string[]
  hooks?: string[]
  memory?: {
    stripBlockTags?: string[]
  }
  ui?: {
    slots?: Array<{ name: string; entry?: string }>
    /** 路由键（如 `chat`）；宿主在匹配页 eager 加载 web.mjs */
    eagerOnRoutes?: string[]
  }
  connection?: { policy?: string }
  settingsSchema?: PluginSettingsSchema
  conversationSettingsSchema?: PluginSettingsSchema
  turnPlugins?: {
    mergeMode?: 'replace-by-plugin-id' | 'receive-scoped'
    receiveIdKey?: string
  }
  serverActions?: Array<{
    name: string
    permissions: string[]
  }>
  lifecycle?: Partial<Record<'onCharacterPrimaryChanged', boolean>>
}

export interface PluginCompleteDraftMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PluginServerHostApi {
  applyPromptMacroPipeline: (
    text: string,
    macroContext: PromptMacroContext,
  ) => string
  getUserPluginSettings: (
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  runPluginComplete: (req: {
    apiConfigId?: string
    conversationId?: string
    messages: PluginCompleteDraftMessage[]
    modelOverride?: string
    responseFormat?: 'json_object' | 'text'
    fallbackToChat?: boolean
    captureDebug?: boolean
  }) => Promise<
    | { ok: true; content: string; usage?: { promptTokens?: number; completionTokens?: number }; latencyMs: number; debug?: import('../plugin-complete.js').PluginCompleteDebugCapture }
    | { ok: false; code: string; status?: number; detail?: string; debug?: import('../plugin-complete.js').PluginCompleteDebugCapture }
  >
  runPluginCompletePreflight: (req: {
    apiConfigId?: string
    conversationId?: string
    messages: PluginCompleteDraftMessage[]
  }) => Promise<{
    ok: boolean
    promptTokens: number
    budget: number
    contextLength: number | null
    code?: string
  }>
  runPluginMacroExpand: (req: {
    text: string
    conversationId?: string
    apiConfigId?: string
    toTurn?: number
    persistVars?: boolean
  }) => Promise<string>
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  readConversationTurnsTail: (
    conversationId: string,
    limit?: number,
  ) => Promise<
    {
      turnOrdinal: number
      activeReceiveIndex: number
      userText: string
      plugins: unknown[]
      receives: { id: string; content: string }[]
    }[]
  >
  readConversationTurnAtOrdinal: (
    conversationId: string,
    turnOrdinal: number,
  ) => Promise<{
    turnOrdinal: number
    activeReceiveIndex: number
    userText: string
    plugins: unknown[]
    receives: { id: string; content: string }[]
  } | null>
  readPluginPackageText: (
    pluginId: string,
    relPath: string,
  ) => Promise<string | null>
  /** DOC/39 · 插件二次 LLM 一键管线（Server 侧） */
  completeWithContext: (
    req: import('../shared/plugin-context-blocks.js').CompleteWithContextRequest,
  ) => Promise<import('../shared/plugin-context-blocks.js').CompleteWithContextResult>
  regex: {
    listRules: (opts?: { phases?: RegexPhase[] }) => Promise<RegexRuleSummary[]>
    applyText: (
      text: string,
      ruleIds: string[] | 'all',
      ctx: RegexApplyContext,
    ) => Promise<string>
    applyMessages: (
      messages: ChatMessage[],
      ruleIds: string[] | 'all',
      ctx: {
        phase: RegexPhase
        tailOrdinal: number
        turnOrdinalByIndex?: (
          index: number,
          msg: ChatMessage,
        ) => number | undefined
      },
    ) => Promise<ChatMessage[]>
  }
}

export interface PluginParseCompleteDraftContext {
  pluginId: string
  conversationId: string
  /** 解析后填入；插件 hook 内 complete/preflight 可省略 apiConfigId */
  apiConfigId?: string
  kind: string
  /** 解析 completeWithContext 出站 JSON 为 draft */
  systemReferenceContext?: string
  userContent?: string
  systemPromptTemplate?: string
  fromTurn?: number
  toTurn?: number
  blockTurns?: number
  /** complete 请求 pluginSettings 原样透传；语义由插件解释 */
  pluginSettings?: Record<string, unknown>
}

export interface PluginParseCompleteDraftResult {
  draft: { title: string; content: string; keywords: string[] }
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
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

export interface ResolveTurnPluginEntriesFromAssistantContext {
  assistantContent: string
  plugins?: ChatPluginsBody | null
  conversationId?: string
}

export interface PluginServerActionTurnMerge {
  turnOrdinal: number
  receiveId: string
  assistantContent: string
  entry: TurnPluginEntry
}

export type PluginServerActionResult =
  | ({
      ok: true
      turnMerge?: PluginServerActionTurnMerge
    } & Record<string, unknown>)
  | { ok: false; code: string; status?: number; debug?: unknown }

export interface PluginServerModule {
  afterAssemblePrompts?: (
    ctx: AfterAssemblePromptsPluginContext,
    api: PluginServerHostApi,
  ) => ChatMessage[] | Promise<ChatMessage[]>
  /** 预估追加 messages（用于 token 预算预留；不可被 budget trim 裁切） */
  resolveAfterAssemblePromptsAddition?: (
    ctx: Omit<AfterAssemblePromptsPluginContext, 'messages'>,
    api: PluginServerHostApi,
  ) =>
    | ChatMessage[]
    | import('../shared/plugin-prompt-injection.js').PluginPromptInjection[]
    | null
    | Promise<
        | ChatMessage[]
        | import('../shared/plugin-prompt-injection.js').PluginPromptInjection[]
        | null
      >
  resolveTurnPluginEntries?: (
    plugins: ChatPluginsBody | null | undefined,
    api: PluginServerHostApi,
  ) => TurnPluginEntry[] | Promise<TurnPluginEntry[]>
  resolveTurnPluginEntriesFromAssistant?: (
    ctx: ResolveTurnPluginEntriesFromAssistantContext,
    api: PluginServerHostApi,
  ) => TurnPluginEntry[] | Promise<TurnPluginEntry[]>
  /** DOC/39 · completeWithContext 步骤 1 后格式化 blocks（插件 hook） */
  formatPluginContextBlocks?: (
    resolved: import('../shared/plugin-context-blocks.js').PluginContextBlocksSuccess,
    ctx: { anchorToTurn: number },
  ) => Record<string, string> | Promise<Record<string, string>>
  /** DOC/39 · completeWithContext 出站后解析 draft */
  parseCompleteDraftContent?: (
    ctx: PluginParseCompleteDraftContext,
    content: string,
    api: PluginServerHostApi,
  ) => PluginParseCompleteDraftResult | Promise<PluginParseCompleteDraftResult>
  /** manifest.serverActions 声明的自定义动作 */
  runPluginAction?: (
    action: string,
    body: Record<string, unknown>,
    api: PluginServerHostApi,
  ) => Promise<PluginServerActionResult>
  /** 落盘响应附加字段（键由插件自定，宿主 opaque 合并） */
  resolveConversationPersistExtras?: (
    ctx: { conversationIndex: import('../chat-storage.js').ConversationIndex },
    api: PluginServerHostApi,
  ) => Promise<Record<string, unknown> | void>
  onCharacterPrimaryChanged?: (
    ctx: {
      conversationId: string
      conversationIndex: import('../chat-storage.js').ConversationIndex
    },
    api: PluginServerHostApi,
  ) => Promise<{ pluginSettings?: Record<string, unknown> } | void>
}

export interface PluginRegistryPublicEntry {
  id: string
  name: string
  version: string
  order: number
  slots: string[]
  webEntry: string | null
  eagerOnRoutes?: string[]
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
