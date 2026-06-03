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
  labelKey: string
}

export interface PluginFormFieldDef {
  key: string
  labelKey: string
  type?: 'textarea' | 'integer' | 'radio'
  options?: PluginFormFieldOption[]
  visibleWhen?: { field: string; equals: unknown }
  hintKey?: string
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

export interface PluginWebHost {
  registerSlotButton(slot: string, def: PluginSlotButtonDef): void
  registerFormDialog(pluginId: string, def: PluginFormDialogDef): void
  openFormDialog(pluginId: string, model: Record<string, unknown>): void
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
  }
  render: {
    richMessageToHtml(text: string): string
    reasoningToHtml(text: string): string
  }
  ui: {
    toast(message: string, opts?: PluginToastOptions): void
    notify(title: string, body?: string, opts?: PluginNotifyOptions): void
    confirm(opts: PluginConfirmOptions): Promise<boolean>
    openFormDialog(pluginId: string, model: Record<string, unknown>): void
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
  model: Record<string, unknown>
}
