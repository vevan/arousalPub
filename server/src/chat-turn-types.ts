import type { AuthorsNoteSettings } from './authors-note-settings.js'
import type { BudgetTrimSettingsOverride } from './budget-trim-settings.js'
import type { ConversationEmbeddingApiSettingsOverride } from './conversation-api-settings.js'
import type { GroupChatSpeakerAudit } from './group-chat/types.js'
import type { HistorySettings } from './history-settings.js'
import type { KnowledgeSettingsOverride } from './knowledge-settings.js'
import type { LorebookSettings } from './lorebook-settings.js'
import type { MemorySettings } from './memory-settings.js'
import type {
  GroupChatSettings,
  GroupChatTurnState,
} from './shared/group-chat-settings.js'

export interface ConversationIndex {
  schemaVersion: 1
  conversationId: string
  title: string
  /** 多卡绑定 */
  characterIds?: string[]
  createdAt: string
  updatedAt: string
  headChunkFile: string | null
  tailChunkFile: string | null
  /** 当前选中分支（会话根相对；主路径 "" 或省略） */
  activeBranchPath?: string | null
  apiPreset?: Record<string, unknown>
  backupSettings?: { everyNRounds: number; maxKeptBackups: number }
  branches?: unknown[]
  /**
   * 调试：chat-audit.json（`auditDebug`）。
   * `enabled === false` 或 `maxStored < 1` 时不写入新审计条目。
   */
  auditDebug?: { enabled: boolean; maxStored: number }
  /**
   * 对话级提示词预设（`data/{user}/prompts/` 内预设 `id`）。
   * 缺省或未写入：客户端使用全局「当前激活预设」。
   */
  promptPresetId?: string | null
  /**
   * 对话绑定的世界书 / lorebook id 列表（占位；检索与注入未接前可恒为空数组）。
   */
  lorebookIds?: string[]
  /** 资料库递归稀疏覆盖（未写字段继承全局 user-preferences） */
  lorebookSettings?: Partial<LorebookSettings>
  /** 历史轮数稀疏覆盖（未写字段继承全局 user-preferences） */
  historySettings?: Partial<HistorySettings>
  /** 对话记忆稀疏覆盖（未写字段继承全局 user-preferences） */
  memorySettings?: Partial<MemorySettings>
  /** 对话绑定的知识库 id 列表（顺序 = 检索合并顺序） */
  knowledgeBaseIds?: string[]
  /** 知识库 RAG 稀疏覆盖（未写字段继承全局 user-preferences） */
  knowledgeSettings?: KnowledgeSettingsOverride
  /** §14.4.1 预算裁切稀疏覆盖（未写字段继承全局 user-preferences） */
  budgetTrimSettings?: BudgetTrimSettingsOverride
  /**
   * 对话级 Embedding 模型参数稀疏覆盖（连接仍用全局 embeddingApi）。
   */
  embeddingApiSettings?: ConversationEmbeddingApiSettingsOverride
  /**
   * 远期记忆向量索引所用 embedding 模型（与全局 embeddingApi.embeddingModel 对齐）。
   * 未写入表示尚未按当前模型完成索引或需重建。
   */
  memoryEmbeddingModel?: string | null
  /** 与 memoryEmbeddingModel 一并记录；null 表示索引时未指定 dimensions */
  memoryEmbeddingDimensions?: number | null
  /** 重建记忆索引时使用的 Hybrid FTS 分词 profile */
  memoryHybridFtsProfile?: string | null
  /**
   * 对话内用户展示名（宏 `{{user}}`）；缺省由服务端用默认「用户」。
   */
  userName?: string
  /**
   * 用户 persona 卡 id：UI 回显 + 组装注入 persona。卡删除后仅保留 userName 快照与宏。
   */
  userCharacterId?: string
  /** 会话级 Author's Note（作者注） */
  authorsNote?: AuthorsNoteSettings
  /**
   * 会话级插件配置。键为 pluginId，值为插件自定义 JSON；
   * 宿主只做对象校验与 PATCH 浅合并，不解释业务字段。
   */
  pluginSettings?: Record<string, Record<string, unknown>>
  /** persist retro 待重试的 turnOrdinal（写盘失败时写入） */
  retroPersistPending?: number[]
  /** ST 式会话局部宏变量（`{{setvar}}` / `{{getvar}}`） */
  macroLocalVars?: Record<string, string>
  /** 已注册分支的 fork turnId 索引（加速 DELETE turn 校验；repair 可重建） */
  branchForkTurnIds?: string[]
  /** 群聊开关与接续策略（§35） */
  groupChat?: GroupChatSettings
  /** 对话背景图（文件库 image `fileId`；公开 `/api/m`；M3） */
  backgroundImageFileId?: string
  /** 对话 BGM（文件库 audio `fileId`；公开 `/api/m`；M3） */
  bgmFileId?: string
}

export interface TurnReceive {
  id: string
  content: string
  /** 思维链 / reasoning（与上游 reasoning_content 等对应） */
  reasoning?: string
  runtime?: Record<string, unknown>
}

export interface AssistantSegmentRecord {
  id: string
  speakerCharacterId: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  meta?: {
    nextSpeakerHint?: string
    /** 本段落盘时下一段选人 audit（供下一段 segmentPick 展示掷骰表） */
    resolvedNextSpeakerAudit?: GroupChatSpeakerAudit
    /** 本段 segmentPick audit（regen 时复用） */
    segmentPickAudit?: GroupChatSpeakerAudit
  }
}

export interface TurnRecord {
  turnId: string
  turnOrdinal: number
  /** 用户发消息 / 该轮落盘时刻（ISO8601）；旧 chunk 可无此字段 */
  createdAt?: string
  send: { userText: string }
  plugins: unknown[]
  /** 群聊：同 turn 多 assistant segment（§35）；单 bot 亦 ≥1 段 */
  segments: AssistantSegmentRecord[]
  activeSegmentIndex: number
  /** 来自 /@ 的待发言 characterId 队列 */
  speakerQueue?: string[]
  /** 群聊 G ID 内 per-bot 额度与发言计数（G3） */
  groupChatTurnState?: GroupChatTurnState
  /** 当前 active segment 的 speaker */
  speakerCharacterId?: string
}

export interface ChunkFile {
  schemaVersion: 1
  meta: {
    chunkId: string
    ordinalRange: { start: number; end: number }
    /** 本块创建时的轮数容量；缺省从文件名推断 */
    turnsPerFile?: number
    links: {
      previous: string | null
      next: string | null
      branches: unknown[]
    }
  }
  turns: TurnRecord[]
}
