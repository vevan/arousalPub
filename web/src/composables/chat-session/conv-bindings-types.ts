import type { AuthorsNoteSettings } from '@/utils/authors-note-settings'
import type { BudgetTrimSettings } from '@/utils/budget-trim-settings'
import type {
  ConversationEmbeddingApiSettingsOverride,
  ResolvedConversationChatDisplay,
} from '@/utils/conversation-api-settings'
import type { GroupChatSettings } from '@/utils/group-chat-settings'
import type { HistorySettings } from '@/utils/history-settings'
import type { KnowledgeSettings } from '@/utils/knowledge-settings'
import type { LorebookSettings } from '@/utils/lorebook-settings'
import type { MemorySettings } from '@/utils/memory-settings'
import type { EmbeddingProvider } from '@/utils/embedding-api-settings'
import type { HybridFtsSettings } from '@/utils/hybrid-fts-settings'

export interface LorebookContextBinding {
  useGlobal: boolean
  effective: LorebookSettings
}

export interface HistoryContextBinding {
  useGlobal: boolean
  effective: HistorySettings
}

export interface MemoryContextBinding {
  useGlobal: boolean
  effective: MemorySettings
}

export interface BudgetTrimContextBinding {
  useGlobal: boolean
  effective: BudgetTrimSettings
}

export interface ApiContextBinding {
  useGlobal: boolean
  effective: ResolvedConversationChatDisplay | null
  apiPresetRaw: unknown
}

export interface EmbeddingApiContextBinding {
  useGlobal: boolean
  effective: {
    provider: EmbeddingProvider
    embeddingModel: string
    embeddingDimensions: number | null
    embeddingProfile: string
  }
  override?: ConversationEmbeddingApiSettingsOverride
}

export interface MemoryHybridFtsContextBinding {
  useGlobal: boolean
  effective: HybridFtsSettings
  override?: HybridFtsSettings
}

export interface KnowledgeContextBinding {
  useGlobal: boolean
  effective: KnowledgeSettings
}

export interface ConvContextBindings {
  promptPresetId: string | null
  characterIds: string[]
  characterNames: string[]
  groupChatEnabled: boolean
  groupChat: GroupChatSettings
  lorebookIds: string[]
  knowledgeBaseIds: string[]
  knowledge: KnowledgeContextBinding
  lorebook: LorebookContextBinding
  history: HistoryContextBinding
  memory: MemoryContextBinding
  budgetTrim: BudgetTrimContextBinding
  chatApi: ApiContextBinding
  embeddingApi: EmbeddingApiContextBinding
  memoryHybridFts: MemoryHybridFtsContextBinding
  /** 会话 `{{user}}`；null 表示未设置 */
  userName: string | null
  /** 用户 persona 卡 id；仅用于 UI 回显头像 */
  userCharacterId: string | null
  /** 对话背景图 fileId */
  backgroundImageFileId: string | null
  /** 对话 BGM fileId */
  bgmFileId: string | null
  authorsNote: AuthorsNoteSettings
}
