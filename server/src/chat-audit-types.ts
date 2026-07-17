import type { ChatMessage } from './assemble-prompts.js'

export interface AuditDebugSettings {
  enabled: boolean
  maxStored: number
}

export interface ChatAuditMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
  scoreKind?: 'rrf' | 'vector_fallback'
  included: boolean
}

export interface KnowledgeAuditHit {
  kbId: string
  kbName: string
  fileId: string
  fileName: string
  chunkId: string
  ordinal: number
  score: number
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
  /** 旧条目可能缺省 */
  knowledge?: {
    knowledgeBaseIds: string[]
    enabled: boolean
    hits: KnowledgeAuditHit[]
    droppedCount: number
  }
  history: {
    turnOrdinals: number[]
    droppedCount: number
  }
  budgetTrim?: {
    maxTokens?: number
    /** 插件预留后的实际裁切预算 */
    trimMaxTokens?: number
    /** 裁切前全量组装 token */
    tokensBeforeTrim?: number
  }
  plugins?: {
    tokenReserve: number
    items: { pluginId: string; tokens: number }[]
  }
}

export type CallAuditKind = 'chat' | 'embedding' | 'plugin.complete'

export interface CallAuditEntry {
  kind: CallAuditKind
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

export interface PluginAuditEntry {
  pluginId: string
  event?: string
  meta?: Record<string, unknown>
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

export interface ChatAuditEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  /** 群聊同 turn 多 segment 时区分审计条目；缺省 0（兼容旧条目） */
  segmentIndex?: number
  /** 本段 active receive，便于精确匹配 */
  receiveId?: string
  messages: ChatAuditMessage[]
  assembly?: AssemblyAudit
  groupChat?: import('./group-chat-turn.js').GroupChatAuditSnapshot
  calls?: CallAuditEntry[]
  plugins?: PluginAuditEntry[]
  performance?: PerformanceAudit
}

export interface ChatAuditFile {
  schemaVersion: 2 | 3
  entries: ChatAuditEntry[]
}

/** 落盘成功后写入审计文件的载荷（元数据由 append 补全） */
export interface ChatAuditSnapshotInput {
  messages: ChatMessage[]
  assembly?: AssemblyAudit
  calls?: CallAuditEntry[]
  plugins?: PluginAuditEntry[]
  performance?: PerformanceAudit
  groupChat?: import('./group-chat-turn.js').GroupChatAuditSnapshot
}
