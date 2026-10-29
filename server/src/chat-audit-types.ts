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
    /**
     * 裁切上限。PromptSlot 管线下等于 `maxTokens`（插件已入槽、不再预留双扣）。
     * 旧条目可能小于 maxTokens（曾扣插件预留）。
     */
    trimMaxTokens?: number
    /** 宏+regex 后、裁切前全量 token */
    tokensBeforeTrim?: number
  }
  plugins?: {
    /** 插件注入合计 token（不可裁；字段名历史遗留，非「预留双扣」） */
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
  /**
   * lore 结束后 → 裁切投影完成。
   * 子项顺序（PromptSlot）：knowledge → pluginsAfterAssemble → macros → regexOutgoing → budgetTrim；
   * `pluginReserve` 新管线恒为 0（旧条目可有值）。
   */
  assembleAndTrim?: number
  knowledge?: number
  /** 旧管线：estimatePlugins 预留耗时；新管线写 0 */
  pluginReserve?: number
  budgetTrim?: number
  /** 组装次数（PromptSlot：恒为 1；旧裁切循环可为 2） */
  budgetTrimAssemblePasses?: number
  macros?: number
  regexOutgoing?: number
  /** 插件入槽（在宏/regex/裁切之前） */
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
