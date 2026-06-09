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

export interface ChatAuditEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: ChatAuditMessage[]
  assembly?: AssemblyAudit
  calls?: CallAuditEntry[]
  plugins?: PluginAuditEntry[]
}

export interface ChatAuditFile {
  schemaVersion: 2
  entries: ChatAuditEntry[]
}

/** 落盘成功后写入审计文件的载荷（元数据由 append 补全） */
export interface ChatAuditSnapshotInput {
  messages: ChatMessage[]
  assembly?: AssemblyAudit
  calls?: CallAuditEntry[]
  plugins?: PluginAuditEntry[]
}
