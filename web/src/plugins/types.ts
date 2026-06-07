import type { ComposerRef, useChatSession } from '@/composables/useChatSession'
import type { ChatTurnItem } from '@/types/chat-turn'
import type { ConversationBatchContext } from '@/plugins/conversation-host'
import type { ConversationChatRequestPlugins } from '@/utils/chat-api'

export type ChatSession = ReturnType<typeof useChatSession>

export interface PluginSlotContext {
  turn?: ChatTurnItem
  listIndex?: number
}

export interface PluginSlotButtonDef {
  id: string
  icon: string | ((ctx: PluginSlotContext) => string)
  tooltipKey: string | ((ctx: PluginSlotContext) => string)
  filled?: boolean | ((ctx: PluginSlotContext) => boolean)
  when?: (ctx: PluginSlotContext) => boolean
  disabled?: (ctx: PluginSlotContext) => boolean
  onClick: (ctx: PluginSlotContext) => void
}

export interface AssistantReplyCompleteEvent {
  mode: 'send' | 'regenerate'
  traceId?: string
}

/** 服务端落盘成功（SSE arousal.persist 或等价 JSON） */
export interface AssistantReplyPersistedEvent {
  mode: 'send' | 'regenerate'
  traceId?: string
  turnOrdinal?: number
  receiveId?: string
  isFirstTurn?: boolean
}

export interface PluginFormFieldOption {
  value: string
  labelKey?: string
  /** 直接展示文案（优先于 labelKey） */
  label?: string
  /** checkboxGroup：为 true 时不可取消勾选 */
  locked?: boolean
}

export interface PluginFormFieldDef {
  key: string
  labelKey: string
  type?: 'text' | 'textarea' | 'integer' | 'radio' | 'apiPreset' | 'lorebook' | 'checkboxGroup'
  options?: PluginFormFieldOption[]
  visibleWhen?: { field: string; equals: unknown }
  hintKey?: string
  /** 为 true 时字段只读展示 */
  readOnly?: boolean
}

export interface PluginFormDialogDef {
  titleKey: string
  bodyKey?: string
  fields: PluginFormFieldDef[]
  /** 双模式（send / regenerate），与 submitKey 二选一 */
  submitKeys?: { send: string; regenerate: string }
  /** 单按钮对话框（如导出） */
  submitKey?: string
  cancelKey?: string
  canSubmit: (model: Record<string, unknown>) => boolean
  onSubmit: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
  onCancel?: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
}

export interface PluginConfirmOptions {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: string
}

export interface PluginToastOptions {
  color?: string
  timeout?: number
}

export interface PluginNotifyOptions extends PluginToastOptions {
  /** reserved for persistent notifications */
  persistent?: boolean
}

export interface PluginProgressOptions {
  message?: string
  phase?: string
  done: number
  total: number
}

export interface ConversationMeta {
  conversationId: string
  title: string
  userDisplayName: string
  assistantDisplayName: string
  exportedAt: string
  characterIds: string[]
  userCharacterId: string | null
}

export interface ConversationScopeOptions {
  /** 默认 true；false 时只读且不占写锁 */
  writeLock?: boolean
  /** 默认 true；loading / 再生中拒绝进入 scope */
  requireIdle?: boolean
}

export type LorebookTriggerMode = 'keyword' | 'constant' | 'vector'

export interface LorebookSummaryDto {
  id: string
  name: string
  updatedAt: string
}

export interface LorebookGroupDto {
  id: string
  name: string
  order: number
  description?: string
}

export interface LorebookEntryDto {
  id: string
  groupId: string
  title: string
  content: string
  comment?: string
  enabled: boolean
  order: number
  keys: string[]
  constant: boolean
  triggerMode?: LorebookTriggerMode
  priority: number
  createdAt: string
  updatedAt: string
}

export interface LorebookDto {
  id: string
  name: string
  description?: string
  groups: LorebookGroupDto[]
  entries: LorebookEntryDto[]
  createdAt: string
  updatedAt: string
}

export interface LorebookEntryCreateBody {
  groupId?: string
  title: string
  content: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  priority?: number
  order?: number
}

export interface LorebookEntryPatchBody {
  title?: string
  content?: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  priority?: number
  order?: number
  groupId?: string
}

export interface PluginCompleteRequest {
  apiConfigId: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  modelOverride?: string
  stream?: boolean
  responseFormat?: 'json_object' | 'text'
}

export interface PluginCompleteResponse {
  ok: true
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
}

export interface PluginCompletePreflightResult {
  ok: boolean
  promptTokens: number
  budget: number
  contextLength: number | null
  outputReserve: number
  model: string | null
  encoding: string
  code?: string
}

export type { PluginHostApiError } from '@/plugins/plugin-host-api-error'
export { isPluginHostApiError } from '@/plugins/plugin-host-api-error'

export interface PluginWebHost {
  registerSlotButton(slot: string, def: PluginSlotButtonDef): void
  registerFormDialog(
    pluginId: string,
    def: PluginFormDialogDef,
    dialogId?: string,
  ): void
  openFormDialog(
    pluginId: string,
    model: Record<string, unknown>,
    dialogId?: string,
  ): void
  composer: ComposerRef
  session: ChatSession
  t: (key: string, params?: Record<string, unknown>) => string
  /** 解析插件命名空间键：`plugins.{pluginId}.{key}` */
  pluginKey: (key: string) => string
  turn: {
    isLastUserTurn: (turn: ChatTurnItem) => boolean
    isTurnAwaitingAssistant: (turn: ChatTurnItem) => boolean
  }
  chat: {
    sendWithPlugins: (
      userText: string,
      plugins: ConversationChatRequestPlugins,
    ) => Promise<void>
    regenerateWithPlugins: (
      listIndex: number,
      userText: string,
      plugins: ConversationChatRequestPlugins,
    ) => Promise<void>
  }
  lifecycle: {
    onAssistantReplyComplete: (
      handler: (event: AssistantReplyCompleteEvent) => void,
    ) => () => void
    onAssistantReplyPersisted: (
      handler: (event: AssistantReplyPersistedEvent) => void,
    ) => () => void
  }
  conversation: {
    getId(): string
    getMeta(): Promise<ConversationMeta>
    runScope(
      opts: ConversationScopeOptions,
      fn: (ctx: ConversationBatchContext) => Promise<void>,
    ): Promise<void>
    /** `runScope({ writeLock: true, requireIdle: true }, fn)` 的别名 */
    runBatch(fn: (ctx: ConversationBatchContext) => Promise<void>): Promise<void>
    refresh(): Promise<void>
    getPluginSettings(): Promise<Record<string, unknown>>
    patchPluginSettings(
      partial: Record<string, unknown>,
    ): Promise<Record<string, unknown>>
    /** 摘要预览等插件流程占用对话：禁止发送新消息 */
    setPluginHold(hold: boolean): void
  }
  lorebook: {
    list(): Promise<LorebookSummaryDto[]>
    get(id: string): Promise<LorebookDto>
    createEntry(
      lorebookId: string,
      body: LorebookEntryCreateBody,
    ): Promise<LorebookEntryDto>
    patchEntry(
      lorebookId: string,
      entryId: string,
      body: LorebookEntryPatchBody,
    ): Promise<LorebookEntryDto>
  }
  api: {
    listPresets(): Promise<{ id: string; alias: string }[]>
  }
  plugin: {
    complete(req: PluginCompleteRequest): Promise<PluginCompleteResponse>
  }
  token: {
    preflightComplete(req: {
      apiConfigId: string
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    }): Promise<PluginCompletePreflightResult>
  }
  plugins: {
    getUserSettings(): Promise<Record<string, unknown>>
  }
  macros: {
    /** 按当前会话上下文展开 `{{user}}` `{{char}}` 等与主对话一致的宏 */
    expand(
      text: string,
      opts?: { apiConfigId?: string },
    ): Promise<string>
  }
  render: {
    richMessageToHtml(text: string): string
    reasoningToHtml(text: string): string
  }
  ui: {
    toast(message: string, opts?: PluginToastOptions): void
    notify(title: string, body?: string, opts?: PluginNotifyOptions): void
    confirm(opts: PluginConfirmOptions): Promise<boolean>
    openFormDialog(
      pluginId: string,
      model: Record<string, unknown>,
      dialogId?: string,
    ): void
    progress(opts: PluginProgressOptions): void
    clearProgress(): void
  }
  /** 插件切换 slot 按钮外观后调用，触发 UI 刷新 */
  refreshSlotButtons: () => void
}

export interface PluginWebModule {
  register?: (host: PluginWebHost) => void
}

export interface PluginRegistryPublicEntry {
  id: string
  name: string
  version: string
  order: number
  slots: string[]
  webEntry: string | null
}

export interface OpenPluginFormState {
  pluginId: string
  dialogId?: string
  model: Record<string, unknown>
}
