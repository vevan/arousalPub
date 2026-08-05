import type { DefaultAuthorsNoteTemplate } from './authors-note-settings.js'
import type { BudgetTrimSettings } from './budget-trim-settings.js'
import type { ChunkSettings } from './chunk-settings.js'
import type { EmbeddingApiSettings } from './embedding-api-settings.js'
import type { HistorySettings } from './history-settings.js'
import type { HybridFtsSettings } from './hybrid-fts-settings.js'
import type { KnowledgeSettings } from './knowledge-settings.js'
import type { LorebookSettings } from './lorebook-settings.js'
import type { MemorySettings } from './memory-settings.js'
import type { PostUserInjectionOrderHostPatch } from './shared/post-user-injection-order.js'

export interface UserPreferencesDocument {
  version: 1
  savedAt: string
  lorebook?: Partial<LorebookSettings>
  history?: Partial<HistorySettings>
  memory?: Partial<MemorySettings>
  knowledge?: Partial<KnowledgeSettings>
  budgetTrim?: Partial<BudgetTrimSettings>
  embeddingApi?: Partial<EmbeddingApiSettings>
  chunk?: Partial<ChunkSettings>
  defaultAuthorsNote?: DefaultAuthorsNoteTemplate
  hybridFts?: Partial<HybridFtsSettings>
  /** post-user 区宿主隐式 injectionOrder 覆盖（DOC/devNotes/38 §3.2） */
  postUserInjectionOrder?: PostUserInjectionOrderHostPatch
  /** ST 式全局宏变量（`{{setglobalvar}}` / `{{getglobalvar}}`） */
  macroGlobalVars?: Record<string, string>
}
