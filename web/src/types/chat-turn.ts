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
  /** 生成该条回复时使用的模型名，来自 runtime.model */
  model?: string
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
  turnOrdinal?: number
  receiveId?: string
  isFirstTurn?: boolean
  /** persist 阶段 regex 后落盘的 user 正文 */
  finalUserText?: string
  /** persist 阶段 regex 后落盘的 assistant 正文 */
  finalAssistantContent?: string
  finalAssistantReasoning?: string
}

/** PATCH 编辑落盘：persist regex 后的轮次正文 */
export interface TurnPatchPersistPayload {
  ok: true
  finalUserText: string
  receives: {
    id: string
    content: string
    reasoning?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
    model?: string
  }[]
  activeReceiveIndex: number
}

export type PersistTurnToServerResult =
  | { ok: false }
  | { ok: true; turn: ChatTurnItem }

export interface ChatPromptSnapshotEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: { role: string; content: string }[]
}

export interface MemoryAuditHit {
  turnId: string
  turnOrdinal: number
  score: number
  included: boolean
}

export interface LoreAuditMatch {
  lorebookId: string
  entryId: string
  title?: string
  mode: 'keyword' | 'vector' | 'constant'
  score?: number
  included: boolean
}

export interface AssemblyAudit {
  estimatedTokens: number
  tokenModel?: string
  memory: {
    enabled: boolean
    hits: MemoryAuditHit[]
    droppedCount: number
  }
  lore: {
    lorebookIds: string[]
    matched: LoreAuditMatch[]
    droppedCount: number
  }
  history: {
    turnOrdinals: number[]
    droppedCount: number
  }
  budgetTrim?: {
    maxTokens?: number
  }
}

export interface CallAuditEntry {
  kind: 'chat' | 'embedding' | 'plugin.complete'
  purpose?: string
  pluginId?: string
  apiConfigId?: string
  model?: string
  latencyMs?: number
  usage?: {
    promptTokens?: number
    completionTokens?: number
  }
}

export interface ChatAuditSnapshotEntry extends ChatPromptSnapshotEntry {
  assembly?: AssemblyAudit
  calls?: CallAuditEntry[]
  plugins?: Record<string, unknown>[]
}

export interface AssembleMessagesResult {
  messages: { role: string; content: string }[]
  estimatedTokens: number
  droppedLoreCount?: number
  droppedHistoryCount: number
  droppedMemoryCount?: number
  memoryTurnIds?: string[]
}
