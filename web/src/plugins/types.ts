import type { ComposerRef, useChatSession } from '@/composables/useChatSession'
import type { ChatTurnItem } from '@/types/chat-turn'
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
}

export interface PluginFormFieldDef {
  key: string
  labelKey: string
}

export interface PluginFormDialogDef {
  titleKey: string
  fields: PluginFormFieldDef[]
  submitKeys: { send: string; regenerate: string }
  canSubmit: (model: Record<string, unknown>) => boolean
  onSubmit: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
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
