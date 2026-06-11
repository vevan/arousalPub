import type { InjectionKey } from 'vue'

export interface ChatConversationActions {
  openMemoryRebuild: () => void
}

export const CHAT_CONVERSATION_ACTIONS_KEY: InjectionKey<ChatConversationActions> =
  Symbol('chatConversationActions')
