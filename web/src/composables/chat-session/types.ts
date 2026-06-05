export type { ChatSessionProps } from '@/types/chat-turn'
export { ConversationHostError } from '@/plugins/conversation-host'

export interface ComposerRef {
  get userInput(): string
}

export interface AssistantReplyCompleteEvent {
  mode: 'send' | 'regenerate'
  traceId?: string
}

export interface AssistantReplyPersistedEvent {
  mode: 'send' | 'regenerate'
  traceId?: string
  turnOrdinal?: number
  receiveId?: string
  isFirstTurn?: boolean
}

export function makeReplyTraceId(mode: 'send' | 'regenerate'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${mode}-${Date.now()}-${rand}`
}
