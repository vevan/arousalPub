export interface ChatSessionProps {
  conversationId: string
  conversationPromptPresetId?: string | null
  conversationCharacterIds?: string[]
  conversationLorebookIds?: string[]
  conversationUserName?: string | null
  conversationUserCharacterId?: string | null
}

export interface ReceiveItem {
  id: string
  content: string
  reasoning?: string
  /** 助手生成耗时（毫秒），来自 runtime.durationMs */
  durationMs?: number
  /** 发往模型的 messages 估算 token（tiktoken），来自 runtime.estimatedTokens */
  estimatedTokens?: number
  /** 助手回复 token（上游 usage.completion_tokens，缺省为 tiktoken 估算） */
  completionTokens?: number
}

export interface ChatTurnItem {
  user: string
  receives: ReceiveItem[]
  activeReceiveIndex: number
  turnOrdinal: number
}

export interface ChatPersistPayload {
  ok: boolean
  error?: string
}

export interface ChatPromptSnapshotEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: { role: string; content: string }[]
}

export interface AssembleMessagesResult {
  messages: { role: string; content: string }[]
  estimatedTokens: number
  droppedHistoryCount: number
  memoryTurnIds?: string[]
}
