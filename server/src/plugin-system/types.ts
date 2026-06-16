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
  /** 会话 schema：清空表单项时 PATCH null，继承全局 settings.json */
  conversationInherit?: boolean
  /** 与全局 settings 键名对应，用于 inherit hint */
  inheritFromGlobalKey?: string
  options?: PluginSettingsCheckboxOption[]
  optionsSource?: PluginSettingsOptionsSource
  optionsFilter?: PluginSettingsOptionsFilter
  collapsible?: boolean
  panelFieldKeys?: string[]
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
  conversationSettingsSchema?: PluginSettingsSchema
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
  readPluginPackageText: (
    pluginId: string,
    relPath: string,
  ) => Promise<string | null>
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

export interface PluginCompleteDraftContext {
  pluginId: string
  conversationId: string
  /** 解析后填入；插件 hook 内 complete/preflight 可省略 apiConfigId */
  apiConfigId?: string
  kind: 'memory' | 'sidecar'
  /** 参考上下文，与 systemPromptTemplate 拼成 system 消息 */
  systemReferenceContext: string
  userContent: string
  systemPromptTemplate: string
  fromTurn?: number
  toTurn?: number
  sidecarName?: string
}

export interface PluginCompleteDraftResult {
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

export interface PluginServerModule {
  afterAssemblePrompts?: (
    ctx: AfterAssemblePromptsPluginContext,
    api: PluginServerHostApi,
  ) => ChatMessage[] | Promise<ChatMessage[]>
  /** 预估追加 messages（用于 token 预算预留；不可被 budget trim 裁切） */
  resolveAfterAssemblePromptsAddition?: (
    ctx: Omit<AfterAssemblePromptsPluginContext, 'messages'>,
    api: PluginServerHostApi,
  ) => ChatMessage[] | null | Promise<ChatMessage[] | null>
  resolveTurnPluginEntries?: (
    plugins: ChatPluginsBody | null | undefined,
    api: PluginServerHostApi,
  ) => TurnPluginEntry[] | Promise<TurnPluginEntry[]>
  resolveTurnPluginEntriesFromAssistant?: (
    ctx: ResolveTurnPluginEntriesFromAssistantContext,
    api: PluginServerHostApi,
  ) => TurnPluginEntry[] | Promise<TurnPluginEntry[]>
  completeDraft?: (
    ctx: PluginCompleteDraftContext,
    api: PluginServerHostApi,
  ) => PluginCompleteDraftResult | Promise<PluginCompleteDraftResult>
  /** trace-keeper：Separate 重新生成 state 并返回待落盘条目 */
  regenerateSeparateState?: (
    input: {
      conversationId: string
      turnOrdinal?: number
      debugCapture?: boolean
    },
    api: PluginServerHostApi,
  ) => Promise<
    | {
        ok: true
        state: Record<string, unknown>
        turnOrdinal: number
        receiveId: string
        assistantContent: string
        entry: TurnPluginEntry
        debug?: unknown
      }
    | { ok: false; code: string; debug?: unknown }
  >
  /** trace-keeper：手动 patch state 到 turn.plugins[] 并写回 assistant 正文 */
  patchTraceKeeperState?: (
    input: { conversationId: string; turnOrdinal: number; state: unknown },
    api: PluginServerHostApi,
  ) => Promise<
    | {
        ok: true
        state: Record<string, unknown>
        turnOrdinal: number
        receiveId: string
        assistantContent: string
        entry: TurnPluginEntry
      }
    | { ok: false; code: string }
  >
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
  conversationSettingsSchema: PluginSettingsSchema | null
  hasConversationSettings: boolean
}
