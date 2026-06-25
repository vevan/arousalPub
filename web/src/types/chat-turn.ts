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
  turnId?: string
  user: string
  receives: ReceiveItem[]
  activeReceiveIndex: number
  turnOrdinal: number
  /** 落盘插件快照（如 trace-keeper） */
  plugins?: unknown[]
}

export interface ChatPersistPayload {
  ok: boolean
  error?: string
  turnOrdinal?: number
  /** 落盘分配的 turnId，供前端增量 patch、避免全量 reload 后分支 fork */
  turnId?: string
  receiveId?: string
  isFirstTurn?: boolean
  /** persist 阶段 regex 后落盘的 user 正文 */
  finalUserText?: string
  /** persist 阶段 regex 后落盘的 assistant 正文 */
  finalAssistantContent?: string
  finalAssistantReasoning?: string
  /** skip 窗口回溯 persist 改动的历史轮 */
  retro?: RetroPersistTurnPayload[]
  retroStatus?: RetroPersistStatus
  /** 落盘轮次的 plugins[] 快照（与磁盘一致） */
  plugins?: unknown[]
  /** 落盘时 trace-keeper trackerEpoch，供前端本地快照对齐 */
  trackerEpoch?: number
  /** 落盘 receive.runtime（供前端增量 patch token，避免 reload） */
  estimatedTokens?: number
  completionTokens?: number
  durationMs?: number
  model?: string
}

export interface RetroPersistTurnPayload {
  turnOrdinal: number
  finalUserText: string
  finalAssistantContent: string
  finalAssistantReasoning?: string
  receives: {
    id: string
    content: string
    reasoning?: string
  }[]
  activeReceiveIndex: number
}

export interface RetroPersistStatus {
  attempted: number[]
  changed: number[]
  failed?: number[]
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
  plugins?: unknown[]
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
    trimMaxTokens?: number
    tokensBeforeTrim?: number
  }
  plugins?: {
    tokenReserve: number
    items: { pluginId: string; tokens: number }[]
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

export interface AssemblyTimingMs {
  total: number
  memory?: number
  characters?: number
  lore?: number
  assembleAndTrim?: number
  regexOutgoing?: number
  pluginsAfterAssemble?: number
}

export interface UpstreamTimingMs {
  toResponseHeaders?: number
  toFirstToken?: number
  firstTokenToLastToken?: number
  total?: number
  tps?: number
  tpsTokenSource?: 'upstream' | 'estimated'
  tpsTokenCount?: number
}

export interface PersistTimingMs {
  regex?: number
  diskAndAudit?: number
  retro?: number
  total?: number
}

export interface StreamAuditStats {
  contentChars: number
  reasoningChars: number
  contentTokensEst?: number
  reasoningTokensEst?: number
  completionTokensUpstream?: number
}

export interface PerformanceAudit {
  assemblyMs?: AssemblyTimingMs
  preUpstreamMs?: number
  upstreamMs?: UpstreamTimingMs
  persistMs?: PersistTimingMs
  stream?: StreamAuditStats
}

export interface ChatAuditSnapshotEntry extends ChatPromptSnapshotEntry {
  assembly?: AssemblyAudit
  calls?: CallAuditEntry[]
  plugins?: Record<string, unknown>[]
  performance?: PerformanceAudit
}

export interface AssembleMessagesResult {
  messages: { role: string; content: string }[]
  estimatedTokens: number
  droppedLoreCount?: number
  droppedHistoryCount: number
  droppedMemoryCount?: number
  memoryTurnIds?: string[]
}
