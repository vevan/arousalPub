import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { generateShortId } from '../short-id.js'
import { PassThrough, Transform } from 'node:stream'
import { resolveChatFeatureAudit, resolveConversationChatCall, resolvedParamsToChatBodyFields } from '../conversation-api-resolve.js'
import { parseAuthorsNotePatch } from '../authors-note-settings.js'
import { repairConversationChunkIndex, readChunkContainingOrdinal, isTurnOrdinalOffActivePath, isBranchRegistryBrokenError } from '../chunk-chain.js'
import { loadConversationMessages } from '../conversation-messages-api.js'
import { createConversationStub, deleteConversation, readChatList, readConversationIndex, resolvedCharacterIds, removeTurnAtOrdinalInTailChunk, updateConversationAuditDebug, saveOpeningTurn, updateConversationTitle, updateConversationCharacterBindings, updateConversationPromptPresetId, updateConversationLorebookIds, updateConversationLorebookSettings, clearConversationLorebookSettings, updateConversationKnowledgeBaseIds, updateConversationKnowledgeSettings, clearConversationKnowledgeSettings, clearConversationHistorySettings, updateConversationHistorySettings, clearConversationMemorySettings, updateConversationMemorySettings, clearConversationBudgetTrimSettings, updateConversationBudgetTrimSettings, updateConversationUserCharacterId, updateConversationUserName, updateConversationBackgroundImageFileId, updateConversationBgmFileId, updateConversationAuthorsNote, updateConversationGroupChat, clearConversationChatApiSettings, updateConversationChatApiSettings, clearConversationEmbeddingApiSettings, updateConversationEmbeddingApiSettings, updateConversationPluginSettings, parseConversationChatBinding, parseConversationEmbeddingApiOverride, batchUpdateConversationTurns, type TurnReceive } from '../chat-storage.js'
import { appendConversationTurn, saveFirstTurn, updateTurnContentInTailChunk, updateTurnSegmentInTailChunk } from '../chat-group-turn-ops.js'
import { parseGroupContinueBody } from '../group-chat-turn.js'
import { parseConversationMediaFileId } from '../conversation-media-files.js'
import { createEmptyConversationBranch, deleteConversationBranch, getConversationBranchTree, isTurnIdReferencedByBranchRegistry, updateConversationActiveBranchPath, updateConversationBranchLabel } from '../conversation-branches.js'
import { CONVERSATION_BATCH_MAX_TURNS, parseTurnPatchBody } from '../turn-patch-body.js'
import { reindexConversationMemory } from '../memory-index.js'
import { startConversationMemoryReindexSse } from '../memory-reindex-sse.js'
import { mergeCustomParamsIntoPayload } from '../custom-params-merge.js'
import { appendDrySamplerToPayload } from '../dry-sampler.js'
import { attachBestEffortClientSseSink, mergeChatUpstreamAbortSignals, pipeUpstreamSseBody } from '../chat-upstream-stream.js'
import { cancelChatGeneration, getChatGeneration, isChatGenerationIdFormat, registerChatGeneration, unregisterChatGeneration } from '../chat-generation-registry.js'
import { fetchWithTimeout, UPSTREAM_FETCH_TIMEOUT_MS, UPSTREAM_STREAM_FETCH_TIMEOUT_MS } from '../fetch-with-timeout.js'
import { parseBudgetTrimSettingsPatch } from '../budget-trim-settings.js'
import { parseMemorySettingsPatch } from '../memory-settings.js'
import { parseKnowledgeSettingsPatch } from '../knowledge-settings.js'
import { validateKnowledgeBaseIds } from '../knowledge-base-file.js'
import { isValidConversationId } from '../conversation-id.js'
import { parseContextRecallTestBody, runContextRecallTest } from '../context-recall-test.js'
import { readPromptsDocument } from '../prompts-file.js'
import { ApiCredentialError, resolveChatCredentials } from '../api-credential-resolve.js'
import { buildConversationOutboundMessages } from '../chat-assemble.js'
import { resolveTurnPluginEntriesFromBody } from '../plugin-host.js'
import { dispatchConversationLifecycle } from '../plugin-lifecycle.js'
import { applyPromptMacroPipeline, buildPromptMacroContext, extractMacroCharacterFields, type MacroContextCharacterInput } from '../prompt-macros/index.js'
import { loadMacroGlobalVarsForContext, loadMacroLocalVarsForConversation, persistMacroVarMutations } from '../prompt-macros/macro-vars-persist.js'
import { loadCharFileLookupsForIds } from '../load-char-file-lookups.js'
import { importStChatFromStream, previewStChatImport, streamPreviewStChat } from '../st-chat-import.js'
import { persistTurnAfterModelReply } from '../chat-persist-after-chat.js'
import { loadAndApplyRegexPersistToTurnPatch, resolveTurnPatchPersistRegex, resolveConversationTailOrdinal, toTurnPatchPersistPayload } from '../regex-persist-patch.js'
import { buildSyncedTurnPluginsFromReceives } from '../turn-plugin-sync-from-assistant.js'
import { readRegexRulesDocument } from '../regex-rules-file.js'
import { extractCompletionTokens, extractPromptTokens } from '../chat-usage.js'
import { readChatAuditFile } from '../chat-audit-file.js'
import { buildPerformanceForPersist, isSseContentDelta } from '../chat-audit-performance.js'
import type { PerformanceAudit } from '../chat-audit-types.js'
import { formatArousalPersistSseLine, formatArousalSpeakerSseLine, formatArousalStreamErrorSseLine, parseSseDataLine } from '../sse-assistant.js'
import { enrichConversationIndexForClient, readCharacterDocument } from '../character-storage.js'

const DEFAULT_BASE = 'https://api.openai.com/v1'

type ChatRole = 'system' | 'user' | 'assistant'

interface ChatMessage {
  role: ChatRole
  content: string
}

interface ChatBody {
  alias?: string
  baseUrl?: string
  /** 默认 activePresetId */
  apiPresetId?: string
  apiKeyId?: string | null
  model: string
  /** 直传 messages；与 conversationId 模式二选一 */
  messages?: ChatMessage[]
  /**
   * 会话模式：服务端读取尾块与绑定角色、按当前用户 prompts 数据组装 messages。
   * 与 messages 二选一（优先于空 messages）。
   */
  conversationId?: string
  userText?: string
  promptTrigger?: string
  /** 再生等：仅带尾块中 turnOrdinal 小于该值的历史 */
  historyBeforeTurnOrdinalExclusive?: number | null
  /** 再生落盘：向该 turnOrdinal 追加 receive（须与 historyBeforeTurnOrdinalExclusive 一致） */
  regenerateTurnOrdinal?: number | null
  /** 再生/swipe 目标 segment 索引（缺省 activeSegmentIndex） */
  regenerateSegmentIndex?: number
  /** 群聊：当前生成 segment 的 speaker characterId */
  speakerCharacterId?: string
  /** 群聊：/@ 解析后的 characterId 队列 */
  speakerQueue?: string[]
  /** 群聊：/@ displayName 队列（服务端解析为 characterId） */
  speakerQueueDisplayNames?: string[]
  /** 群聊接续：同 turn 追加 segment */
  groupContinue?: {
    turnOrdinal: number
    speakerCharacterId: string
    afterSegmentIndex: number
  }
  /** 聊天请求体中的 per-plugin 载荷（键为 pluginId） */
  plugins?: Record<string, unknown>
  /**
   * 客户端预生成的 generationId（16 hex），便于响应头到达前即可 cancel。
   * 非法则忽略并由服务端签发。
   */
  generationId?: string
  contextLength?: number | null
  maxTokens?: number | null
  stream?: boolean
  /** 为 true 时在 customParams 合并后强制写入 thinking（不受 customParams 覆盖） */
  requestReasoning?: boolean
  temperature?: number | null
  topP?: number | null
  topK?: number | null
  dryMultiplier?: number | null
  dryBase?: number | null
  dryAllowedLength?: number | null
  dryPenaltyLastN?: number | null
  drySequenceBreakers?: string[] | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  customParams?: Record<string, unknown>
}

function normalizeBaseUrl(raw: string | undefined): string {
  const s = (raw ?? DEFAULT_BASE).trim().replace(/\/+$/, '')
  return s || DEFAULT_BASE
}


function extractReasoningFromMessage(msg: unknown): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as Record<string, unknown>
  for (const k of ['reasoning_content', 'reasoning', 'thinking'] as const) {
    const v = m[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function buildUpstreamPayload(body: ChatBody): Record<string, unknown> {
  const {
    model,
    messages,
    temperature,
    topP,
    topK,
    frequencyPenalty,
    presencePenalty,
    maxTokens,
    contextLength,
    customParams,
    stream,
    requestReasoning,
  } = body

  const payload: Record<string, unknown> = { model, messages }

  if (temperature !== undefined && temperature !== null) {
    payload.temperature = temperature
  }
  if (topP !== undefined && topP !== null) payload.top_p = topP
  if (topK !== undefined && topK !== null) payload.top_k = topK
  appendDrySamplerToPayload(payload, body)
  if (frequencyPenalty !== undefined && frequencyPenalty !== null) {
    payload.frequency_penalty = frequencyPenalty
  }
  if (presencePenalty !== undefined && presencePenalty !== null) {
    payload.presence_penalty = presencePenalty
  }
  if (maxTokens !== undefined && maxTokens !== null) {
    payload.max_tokens = maxTokens
  }
  if (contextLength !== undefined && contextLength !== null) {
    payload.context_length = contextLength
  }

  mergeCustomParamsIntoPayload(
    payload,
    customParams &&
      typeof customParams === 'object' &&
      !Array.isArray(customParams)
      ? customParams
      : undefined,
  )

  if (stream) payload.stream = true
  if (requestReasoning === true) {
    payload.thinking = { type: 'enabled' }
  }

  return payload
}

function validateChatMessages(
  messages: unknown,
): { ok: true; msgs: ChatMessage[] } | { ok: false; error: string } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: ApiErrorCodes.messages_required_nonempty }
  }
  for (const m of messages) {
    if (
      !m ||
      typeof (m as ChatMessage).content !== 'string' ||
      !['system', 'user', 'assistant'].includes((m as ChatMessage).role)
    ) {
      return { ok: false, error: ApiErrorCodes.messages_item_role_content }
    }
  }
  return { ok: true, msgs: messages as ChatMessage[] }
}

async function drainReadableStream(
  stream: NodeJS.ReadableStream,
): Promise<void> {
  for await (const chunk of stream) {
    void chunk
  }
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.get('/api/chat/index', async (_request, reply) => {
    try {
      const list = await readChatList()
      return list
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.chat_list_read_failed })
    }
  })

  interface CreateConvBody {
    conversationId: string
    title?: string
  }

  app.post<{ Body: CreateConvBody }>(
    '/api/chat/conversations',
    async (request, reply) => {
      const b = request.body
      if (!b?.conversationId || typeof b.conversationId !== 'string') {
        return reply.status(400).send({ error: ApiErrorCodes.missing_conversation_id })
      }
      if (!isValidConversationId(b.conversationId)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_conversation_id })
      }
      const existing = await readConversationIndex(b.conversationId)
      if (existing) {
        return reply.status(409).send({ error: ApiErrorCodes.conversation_already_exists })
      }
      try {
        const idx = await createConversationStub(
          b.conversationId,
          typeof b.title === 'string' ? b.title : '新对话',
        )
        return { ok: true as const, index: idx }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.conversation_create_failed })
      }
    },
  )

  interface PatchConvBody {
    title?: string
    /** 调试：chat-audit.json；`enabled` + `maxStored`（1～200） */
    auditDebug?: { enabled?: boolean; maxStored?: number }
    /** 会话绑定的多张角色卡 id，顺序即主槽、次槽…；传 [] 清空绑定 */
    characterIds?: string[]
    /** 对话级提示词预设 id；传 `null` 或未设置且显式清除时用 null 移除（见 handler） */
    promptPresetId?: string | null
    /** 世界书 id 列表；传 [] 清空 */
    lorebookIds?: string[]
    /** 知识库 id 列表；传 [] 或 `null` 清空 */
    knowledgeBaseIds?: string[] | null
    /** 资料库递归 / 向量：`recursiveEnabled`、`maxRecursionDepth`、`vectorEnabled`、`vectorTopK` */
    lorebookSettings?: {
      recursiveEnabled?: boolean
      maxRecursionDepth?: number
      vectorEnabled?: boolean
      vectorTopK?: number
    } | null
    /** 知识库 RAG：`enabled`、`topK`、`chunkSizeChars`、`chunkOverlapChars`；`null` 清除覆盖 */
    knowledgeSettings?: {
      enabled?: boolean
      topK?: number
      chunkSizeChars?: number
      chunkOverlapChars?: number
    } | null
    /** 历史轮数：`limitEnabled`、`maxTurns`；`null` 清除覆盖 */
    historySettings?: {
      limitEnabled?: boolean
      maxTurns?: number
    } | null
    /** 对话记忆：`memoryEnabled`、`memoryTopK`；`null` 清除覆盖 */
    memorySettings?: {
      memoryEnabled?: boolean
      memoryTopK?: number
    } | null
    /** §14.4.1 预算裁切：`trimOrder`、`minRetain`；`null` 清除覆盖 */
    budgetTrimSettings?: {
      trimOrder?: ('knowledge' | 'lore' | 'memory' | 'history')[]
      minRetain?: {
        knowledge?: number
        lore?: number
        memory?: number
        history?: number
      }
    } | null
    /** 用户 persona 卡 id；组装注入 persona，宏仍依赖 userName 快照 */
    userCharacterId?: string | null
    /** 宏 `{{user}}` 展示名；传 `null` 清除以使用默认「用户」 */
    userName?: string | null
    /** Author's Note；`null` 清除 */
    authorsNote?: {
      enabled?: boolean
      content?: string
      injectionDepth?: number
      role?: 'system' | 'user'
    } | null
    /** 对话级 chat API 覆盖（apiPreset.chat）；`null` 清除 chat 覆盖 */
    apiPreset?: { chat?: Record<string, unknown> | null } | null
    /** 对话级 Embedding 模型参数；`null` 清除 */
    embeddingApiSettings?: {
      embeddingModel?: string
      embeddingDimensions?: number | null
    } | null
    /** 会话级插件配置；每个 pluginId 一层浅合并 */
    pluginSettings?: Record<string, Record<string, unknown>>
    /** 当前 active 分支路径；`""` / `null` 切回主路径 */
    activeBranchPath?: string | null
    /** 群聊设置；`null` 重置为默认 */
    groupChat?: Record<string, unknown> | null
    /** 对话背景图 fileId（image）；`null` / `""` 清除 */
    backgroundImageFileId?: string | null
    /** 对话 BGM fileId（audio）；`null` / `""` 清除 */
    bgmFileId?: string | null
  }

  app.patch<{ Params: { id: string }; Body: PatchConvBody }>(
    '/api/chat/conversations/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const b = request.body ?? {}
      const hasTitle = typeof b.title === 'string'
      const ad = b.auditDebug
      const hasAuditDebug =
        ad &&
        typeof ad === 'object' &&
        (typeof (ad as { enabled?: unknown }).enabled === 'boolean' ||
          typeof (ad as { maxStored?: unknown }).maxStored === 'number')
      const hasCharIds = Array.isArray(b.characterIds)
      const hasPromptPreset = Object.prototype.hasOwnProperty.call(b, 'promptPresetId')
      const hasLorebookIds = Array.isArray(b.lorebookIds)
      const hasKnowledgeBaseIds =
        Array.isArray(b.knowledgeBaseIds) || b.knowledgeBaseIds === null
      const hasLorebookSettings = Object.prototype.hasOwnProperty.call(
        b,
        'lorebookSettings',
      )
      const hasKnowledgeSettings = Object.prototype.hasOwnProperty.call(
        b,
        'knowledgeSettings',
      )
      const hasHistorySettings = Object.prototype.hasOwnProperty.call(
        b,
        'historySettings',
      )
      const hasMemorySettings = Object.prototype.hasOwnProperty.call(
        b,
        'memorySettings',
      )
      const hasBudgetTrimSettings = Object.prototype.hasOwnProperty.call(
        b,
        'budgetTrimSettings',
      )
      const hasUserCharacterId = Object.prototype.hasOwnProperty.call(b, 'userCharacterId')
      const hasUserName = Object.prototype.hasOwnProperty.call(b, 'userName')
      const hasAuthorsNote = Object.prototype.hasOwnProperty.call(b, 'authorsNote')
      const hasApiPreset = Object.prototype.hasOwnProperty.call(b, 'apiPreset')
      const hasEmbeddingApiSettings = Object.prototype.hasOwnProperty.call(
        b,
        'embeddingApiSettings',
      )
      const hasPluginSettings = Object.prototype.hasOwnProperty.call(b, 'pluginSettings')
      const hasActiveBranchPath = Object.prototype.hasOwnProperty.call(b, 'activeBranchPath')
      const hasGroupChat = Object.prototype.hasOwnProperty.call(b, 'groupChat')
      const hasBackgroundImageFileId = Object.prototype.hasOwnProperty.call(
        b,
        'backgroundImageFileId',
      )
      const hasBgmFileId = Object.prototype.hasOwnProperty.call(b, 'bgmFileId')
      if (
        !hasTitle &&
        !hasAuditDebug &&
        !hasCharIds &&
        !hasPromptPreset &&
        !hasLorebookIds &&
        !hasKnowledgeBaseIds &&
        !hasLorebookSettings &&
        !hasKnowledgeSettings &&
        !hasHistorySettings &&
        !hasMemorySettings &&
        !hasBudgetTrimSettings &&
        !hasUserCharacterId &&
        !hasUserName &&
        !hasAuthorsNote &&
        !hasApiPreset &&
        !hasEmbeddingApiSettings &&
        !hasPluginSettings &&
        !hasActiveBranchPath &&
        !hasGroupChat &&
        !hasBackgroundImageFileId &&
        !hasBgmFileId
      ) {
        return reply
          .status(400)
          .send({
            error: ApiErrorCodes.patch_conversation_requires_field,
          })
      }
      let idx = await readConversationIndex(id)
      if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      if (hasTitle) {
        const next = await updateConversationTitle(id, b.title as string)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasAuditDebug) {
        const raw = ad as { enabled?: boolean; maxStored?: number }
        const prev = idx.auditDebug
        const enabled =
          typeof raw.enabled === 'boolean'
            ? raw.enabled
            : (prev?.enabled ?? false)
        const maxStored =
          typeof raw.maxStored === 'number'
            ? raw.maxStored
            : (prev?.maxStored ?? 10)
        const next = await updateConversationAuditDebug(id, { enabled, maxStored })
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasCharIds) {
        const raw = b.characterIds as unknown[]
        if (!raw.every((x) => typeof x === 'string')) {
          return reply.status(400).send({ error: ApiErrorCodes.character_ids_must_be_string_array })
        }
        const prevPrimary = idx.characterIds?.[0] ?? ''
        const next = await updateConversationCharacterBindings(id, raw)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        const nextPrimary = next.characterIds?.[0] ?? ''
        if (prevPrimary !== nextPrimary) {
          const patches = await dispatchConversationLifecycle(
            'onCharacterPrimaryChanged',
            { conversationId: id, conversationIndex: next },
          )
          if (Object.keys(patches).length > 0) {
            const bumped = await updateConversationPluginSettings(id, patches)
            idx = bumped ?? next
          } else {
            idx = next
          }
        } else {
          idx = next
        }
      }
      if (hasPromptPreset) {
        const raw = b.promptPresetId
        if (raw !== null && typeof raw !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
        }
        const next = await updateConversationPromptPresetId(
          id,
          raw === null ? null : (raw as string),
        )
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasLorebookIds) {
        const raw = b.lorebookIds as unknown[]
        if (!raw.every((x) => typeof x === 'string')) {
          return reply.status(400).send({ error: ApiErrorCodes.lorebook_ids_must_be_string_array })
        }
        const next = await updateConversationLorebookIds(id, raw)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasKnowledgeBaseIds) {
        const raw = b.knowledgeBaseIds
        if (raw === null) {
          const next = await updateConversationKnowledgeBaseIds(id, [])
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else {
          const arr = raw as unknown[]
          if (!arr.every((x) => typeof x === 'string')) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.knowledge_base_ids_must_be_string_array })
          }
          const validated = await validateKnowledgeBaseIds(arr)
          if (!validated.ok) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.knowledge_base_not_found })
          }
          const next = await updateConversationKnowledgeBaseIds(id, validated.ids)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        }
      }
      if (hasLorebookSettings) {
        const raw = b.lorebookSettings
        if (raw === null) {
          const next = await clearConversationLorebookSettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return reply.status(400).send({ error: ApiErrorCodes.lorebook_settings_invalid })
        } else {
          const patch: {
            recursiveEnabled?: boolean
            maxRecursionDepth?: number
            keywordTopK?: number
            vectorEnabled?: boolean
            vectorTopK?: number
          } = {}
          if (Object.prototype.hasOwnProperty.call(raw, 'recursiveEnabled')) {
            if (
              typeof (raw as { recursiveEnabled?: unknown }).recursiveEnabled !==
              'boolean'
            ) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_settings_recursive_enabled_boolean })
            }
            patch.recursiveEnabled = (
              raw as { recursiveEnabled: boolean }
            ).recursiveEnabled
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'maxRecursionDepth')) {
            const d = (raw as { maxRecursionDepth?: unknown }).maxRecursionDepth
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_settings_max_recursion_depth_number })
            }
            patch.maxRecursionDepth = d
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'keywordTopK')) {
            const d = (raw as { keywordTopK?: unknown }).keywordTopK
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_settings_keyword_top_k_number })
            }
            patch.keywordTopK = d
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'vectorEnabled')) {
            if (typeof (raw as { vectorEnabled?: unknown }).vectorEnabled !== 'boolean') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_settings_vector_enabled_boolean })
            }
            patch.vectorEnabled = (raw as { vectorEnabled: boolean }).vectorEnabled
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'vectorTopK')) {
            const d = (raw as { vectorTopK?: unknown }).vectorTopK
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.lorebook_settings_vector_top_k_number })
            }
            patch.vectorTopK = d
          }
          if (Object.keys(patch).length === 0) {
            return reply.status(400).send({
              error: ApiErrorCodes.lorebook_settings_requires_field,
            })
          }
          const next = await updateConversationLorebookSettings(id, patch)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        }
      }
      if (hasKnowledgeSettings) {
        const raw = b.knowledgeSettings
        if (raw === null) {
          const next = await clearConversationKnowledgeSettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return reply.status(400).send({ error: ApiErrorCodes.knowledge_settings_invalid })
        } else {
          const parsed = parseKnowledgeSettingsPatch(raw)
          if (!parsed) {
            return reply.status(400).send({ error: ApiErrorCodes.knowledge_settings_invalid })
          }
          const next = await updateConversationKnowledgeSettings(id, parsed)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        }
      }
      if (hasHistorySettings) {
        const raw = b.historySettings
        if (raw === null) {
          const next = await clearConversationHistorySettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return reply.status(400).send({ error: ApiErrorCodes.history_settings_invalid })
        } else {
          const patch: {
            limitEnabled?: boolean
            maxTurns?: number
          } = {}
          if (Object.prototype.hasOwnProperty.call(raw, 'limitEnabled')) {
            if (typeof (raw as { limitEnabled?: unknown }).limitEnabled !== 'boolean') {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.history_settings_limit_enabled_boolean })
            }
            patch.limitEnabled = (raw as { limitEnabled: boolean }).limitEnabled
          }
          if (Object.prototype.hasOwnProperty.call(raw, 'maxTurns')) {
            const d = (raw as { maxTurns?: unknown }).maxTurns
            if (typeof d !== 'number' || !Number.isFinite(d)) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.history_settings_max_turns_number })
            }
            patch.maxTurns = d
          }
          if (
            !Object.prototype.hasOwnProperty.call(patch, 'limitEnabled') &&
            !Object.prototype.hasOwnProperty.call(patch, 'maxTurns')
          ) {
            return reply.status(400).send({
              error: ApiErrorCodes.history_settings_requires_field,
            })
          }
          const next = await updateConversationHistorySettings(id, patch)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        }
      }
      if (hasMemorySettings) {
        const raw = b.memorySettings
        if (raw === null) {
          const next = await clearConversationMemorySettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return reply.status(400).send({ error: ApiErrorCodes.memory_settings_invalid })
        } else {
          const parsed = parseMemorySettingsPatch(raw, 'conversation')
          if (!parsed.ok) {
            const code = parsed.error as keyof typeof ApiErrorCodes
            return reply
              .status(400)
              .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.memory_settings_invalid })
          }
          const next = await updateConversationMemorySettings(id, parsed.patch)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        }
      }
      if (hasBudgetTrimSettings) {
        const raw = b.budgetTrimSettings
        if (raw === null) {
          const next = await clearConversationBudgetTrimSettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else {
          const parsed = parseBudgetTrimSettingsPatch(raw)
          if (!parsed.ok) {
            const code = parsed.error as keyof typeof ApiErrorCodes
            return reply
              .status(400)
              .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.budget_trim_settings_invalid })
          }
          const next = await updateConversationBudgetTrimSettings(id, parsed.patch)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        }
      }
      if (hasUserCharacterId) {
        const raw = b.userCharacterId
        if (raw !== null && typeof raw !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.user_character_id_invalid })
        }
        const next = await updateConversationUserCharacterId(
          id,
          raw === null ? null : (raw as string),
        )
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasUserName) {
        const raw = b.userName
        if (raw !== null && typeof raw !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.user_name_invalid })
        }
        const next = await updateConversationUserName(
          id,
          raw === null ? null : (raw as string),
        )
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasApiPreset) {
        const raw = b.apiPreset
        if (raw === null) {
          const next = await clearConversationChatApiSettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else if (typeof raw === 'object' && !Array.isArray(raw)) {
          if (Object.prototype.hasOwnProperty.call(raw, 'chat')) {
            const chatRaw = (raw as { chat?: unknown }).chat
            if (chatRaw === null) {
              const next = await clearConversationChatApiSettings(id)
              if (!next) {
                return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
              }
              idx = next
            } else {
              const parsed = parseConversationChatBinding(chatRaw)
              if (!parsed.ok) {
                const code = parsed.error as keyof typeof ApiErrorCodes
                return reply
                  .status(400)
                  .send({
                    error:
                      ApiErrorCodes[code] ??
                      ApiErrorCodes.conversation_api_preset_chat_invalid,
                  })
              }
              try {
                const next = await updateConversationChatApiSettings(
                  id,
                  parsed.binding,
                )
                if (!next) {
                  return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
                }
                idx = next
              } catch (e) {
                const msg = e instanceof Error ? e.message : ''
                if (msg === 'api_preset_not_found') {
                  return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
                }
                throw e
              }
            }
          }
        } else {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.conversation_api_preset_chat_invalid })
        }
      }
      if (hasEmbeddingApiSettings) {
        const raw = b.embeddingApiSettings
        if (raw === null) {
          const next = await clearConversationEmbeddingApiSettings(id)
          if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          idx = next
        } else if (typeof raw === 'object' && !Array.isArray(raw)) {
          const parsed = parseConversationEmbeddingApiOverride(raw)
          if (!parsed.ok) {
            const code = parsed.error as keyof typeof ApiErrorCodes
            return reply
              .status(400)
              .send({
                error:
                  ApiErrorCodes[code] ?? ApiErrorCodes.conversation_embedding_api_invalid,
              })
          }
          if (parsed.patch === null || Object.keys(parsed.patch).length === 0) {
            const next = await clearConversationEmbeddingApiSettings(id)
            if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
            idx = next
          } else {
            const next = await updateConversationEmbeddingApiSettings(id, parsed.patch)
            if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
            idx = next
          }
        } else {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.conversation_embedding_api_invalid })
        }
      }
      if (hasAuthorsNote) {
        const parsed = parseAuthorsNotePatch(b.authorsNote)
        if (!parsed.ok) {
          const code = parsed.error as keyof typeof ApiErrorCodes
          return reply
            .status(400)
            .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.authors_note_invalid })
        }
        const next = await updateConversationAuthorsNote(id, parsed.patch)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasPluginSettings) {
        const raw = b.pluginSettings
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return reply.status(400).send({ error: ApiErrorCodes.plugin_settings_invalid })
        }
        const patches: Record<string, Record<string, unknown>> = {}
        for (const [pluginId, value] of Object.entries(raw)) {
          const pid = pluginId.trim()
          if (!pid) continue
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return reply.status(400).send({ error: ApiErrorCodes.plugin_settings_invalid })
          }
          patches[pid] = value as Record<string, unknown>
        }
        if (Object.keys(patches).length === 0) {
          return reply.status(400).send({ error: ApiErrorCodes.plugin_settings_invalid })
        }
        const next = await updateConversationPluginSettings(id, patches)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasActiveBranchPath) {
        const raw = b.activeBranchPath
        if (raw !== null && raw !== '' && typeof raw !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
        }
        const next = await updateConversationActiveBranchPath(id, raw ?? null)
        if ('error' in next) {
          return reply.status(next.status).send({ error: next.error })
        }
        idx = next
      }
      if (hasGroupChat) {
        const raw = b.groupChat
        if (raw !== null && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
          return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
        }
        const next = await updateConversationGroupChat(id, raw)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasBackgroundImageFileId) {
        const parsed = await parseConversationMediaFileId(
          b.backgroundImageFileId,
          'image',
        )
        if (!parsed.ok) {
          return reply.status(400).send({ error: ApiErrorCodes[parsed.error] })
        }
        const next = await updateConversationBackgroundImageFileId(id, parsed.fileId)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      if (hasBgmFileId) {
        const parsed = await parseConversationMediaFileId(b.bgmFileId, 'audio')
        if (!parsed.ok) {
          return reply.status(400).send({ error: ApiErrorCodes[parsed.error] })
        }
        const next = await updateConversationBgmFileId(id, parsed.fileId)
        if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
        idx = next
      }
      return { ok: true as const, index: idx }
    },
  )

  interface CreateBranchBody {
    forkTurnId?: string
    forkMessageId?: string
    label?: string
    /** 默认 true：创建后切到新分支 */
    setActive?: boolean
  }

  app.post<{ Params: { id: string }; Body: CreateBranchBody }>(
    '/api/chat/conversations/:id/branches',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const b = request.body ?? {}
      if (typeof b.forkTurnId !== 'string' || !b.forkTurnId.trim()) {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      if (b.forkMessageId !== undefined && typeof b.forkMessageId !== 'string') {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      if (b.label !== undefined && b.label !== null && typeof b.label !== 'string') {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      if (b.setActive !== undefined && typeof b.setActive !== 'boolean') {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      const result = await createEmptyConversationBranch({
        conversationId: id,
        forkTurnId: b.forkTurnId.trim(),
        forkMessageId: b.forkMessageId,
        label: b.label,
        setActive: b.setActive,
      })
      if ('error' in result) {
        return reply.status(result.status).send({ error: result.error })
      }
      return reply.status(201).send(result)
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/chat/conversations/:id/branches',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const result = await getConversationBranchTree(id)
      if ('error' in result) {
        return reply.status(result.status).send({ error: result.error })
      }
      return result
    },
  )

  interface PatchBranchBody {
    label?: string | null
  }

  app.patch<{ Params: { id: string }; Querystring: { path?: string }; Body: PatchBranchBody }>(
    '/api/chat/conversations/:id/branches',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const rawPath = request.query.path?.trim()
      if (!rawPath) {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      const b = request.body ?? {}
      if (!Object.prototype.hasOwnProperty.call(b, 'label')) {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      if (b.label !== null && b.label !== undefined && typeof b.label !== 'string') {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      const result = await updateConversationBranchLabel(id, rawPath, b.label)
      if ('error' in result) {
        return reply.status(result.status).send({ error: result.error })
      }
      return result
    },
  )

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/chat/conversations/:id/branches',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const rawPath = request.query.path?.trim()
      if (!rawPath) {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      const result = await deleteConversationBranch(id, rawPath)
      if ('error' in result) {
        return reply.status(result.status).send({ error: result.error })
      }
      return result
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/chat/conversations/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const ok = await deleteConversation(id)
        if (!ok) {
          return reply.status(404).send({ error: ApiErrorCodes.conversation_delete_failed })
        }
        return { ok: true as const }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.conversation_delete_error })
      }
    },
  )

  interface OpeningTurnBody {
    receives?: { id?: unknown; content?: unknown; reasoning?: unknown }[]
    activeReceiveIndex?: number
  }

  app.post<{ Params: { id: string }; Body: OpeningTurnBody }>(
    '/api/chat/conversations/:id/opening',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const b = request.body ?? {}
      if (!Array.isArray(b.receives) || b.receives.length === 0) {
        return reply.status(400).send({ error: ApiErrorCodes.receives_required_nonempty })
      }
      const idxForMacro = await readConversationIndex(id)
      const macroChars: MacroContextCharacterInput[] = []
      let userCharacterForMacro: MacroContextCharacterInput | undefined
      if (idxForMacro) {
        for (const cid of resolvedCharacterIds(idxForMacro)) {
          const doc = await readCharacterDocument(cid)
          if (doc?.card && typeof doc.card === 'object') {
            const card = doc.card as Record<string, unknown>
            const nameRaw = card.name
            macroChars.push({
              name: typeof nameRaw === 'string' ? nameRaw : undefined,
              macroFields: extractMacroCharacterFields(card),
            })
          }
        }
        const userCharId =
          typeof idxForMacro.userCharacterId === 'string'
            ? idxForMacro.userCharacterId.trim()
            : ''
        if (userCharId) {
          const doc = await readCharacterDocument(userCharId)
          if (doc?.card && typeof doc.card === 'object') {
            const card = doc.card as Record<string, unknown>
            const nameRaw = card.name
            userCharacterForMacro = {
              name: typeof nameRaw === 'string' ? nameRaw : undefined,
              macroFields: extractMacroCharacterFields(card),
            }
          }
        }
      }
      const [macroLocalVars, macroGlobalVars, fileLookups] = await Promise.all([
        loadMacroLocalVarsForConversation(id),
        loadMacroGlobalVarsForContext(),
        loadCharFileLookupsForIds(
          resolvedCharacterIds(idxForMacro ?? {}),
          idxForMacro?.userCharacterId,
        ),
      ])
      const openingMacroCtx = buildPromptMacroContext({
        conversationUserName: idxForMacro?.userName,
        characters: macroChars,
        userCharacter: userCharacterForMacro,
        conversationId: id,
        macroLocalVars,
        macroGlobalVars,
        charFileLookups: fileLookups.charFileLookups,
        userFileLookup: fileLookups.userFileLookup,
      })

      const receives: TurnReceive[] = []
      for (const raw of b.receives) {
        if (!raw || typeof raw !== 'object') {
          return reply.status(400).send({ error: ApiErrorCodes.receives_item_invalid })
        }
        const content = raw.content
        if (typeof content !== 'string' || !content.trim()) {
          return reply.status(400).send({ error: ApiErrorCodes.receives_content_required })
        }
        const rec: TurnReceive = {
          id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateShortId(),
          content: applyPromptMacroPipeline(content.trim(), openingMacroCtx),
        }
        if (typeof raw.reasoning === 'string' && raw.reasoning.trim()) {
          rec.reasoning = raw.reasoning.trim()
        }
        receives.push(rec)
      }
      await persistMacroVarMutations(openingMacroCtx)
      const active =
        typeof b.activeReceiveIndex === 'number' && Number.isInteger(b.activeReceiveIndex)
          ? b.activeReceiveIndex
          : 0
      try {
        const result = await saveOpeningTurn({
          conversationId: id,
          receives,
          activeReceiveIndex: active,
        })
        if (!result) {
          const idx = await readConversationIndex(id)
          if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          if (idx.headChunkFile) {
            return reply.status(409).send({ error: ApiErrorCodes.first_turn_already_saved })
          }
          return reply.status(500).send({ error: ApiErrorCodes.opening_persist_failed })
        }
        return { ok: true as const, index: result.index }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.opening_write_failed })
      }
    },
  )

  interface FirstTurnBody {
    userContent: string
    assistantContent: string
    assistantReasoning?: string
    model?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
  }

  app.post<{ Params: { id: string }; Body: FirstTurnBody }>(
    '/api/chat/conversations/:id/first-turn',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const b = request.body
      if (!b || typeof b.userContent !== 'string' || !b.userContent.trim()) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_user_content })
      }
      if (
        typeof b.assistantContent !== 'string' ||
        !b.assistantContent.trim()
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_assistant_content })
      }
      try {
        const ar =
          typeof b.assistantReasoning === 'string'
            ? b.assistantReasoning.trim()
            : ''
        const durationMs =
          typeof b.durationMs === 'number' && Number.isFinite(b.durationMs)
            ? Math.round(b.durationMs)
            : undefined
        const estimatedTokens =
          typeof b.estimatedTokens === 'number' &&
          Number.isFinite(b.estimatedTokens) &&
          b.estimatedTokens > 0
            ? Math.round(b.estimatedTokens)
            : undefined
        const completionTokens =
          typeof b.completionTokens === 'number' &&
          Number.isFinite(b.completionTokens) &&
          b.completionTokens > 0
            ? Math.round(b.completionTokens)
            : undefined
        const result = await saveFirstTurn({
          conversationId: id,
          userText: b.userContent.trim(),
          assistantText: b.assistantContent.trim(),
          reasoning: ar || undefined,
          model: typeof b.model === 'string' ? b.model : undefined,
          durationMs,
          estimatedTokens,
          completionTokens,
        })
        if (!result) {
          const idx = await readConversationIndex(id)
          if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          if (idx.headChunkFile) {
            return reply.status(409).send({ error: ApiErrorCodes.first_turn_already_saved })
          }
          return reply.status(500).send({ error: ApiErrorCodes.persist_failed })
        }
        return { ok: true as const, index: result.index }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.first_turn_write_failed })
      }
    },
  )

  app.get<{
    Params: { id: string }
    Querystring: {
      from?: string
      to?: string
      tail?: string
      before?: string
      limit?: string
      branchPath?: string
    }
  }>(
    '/api/chat/conversations/:id/messages',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const loaded = await loadConversationMessages(id, request.query ?? {})
      if (!loaded.ok) {
        const code =
          loaded.error in ApiErrorCodes
            ? (loaded.error as (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes])
            : ApiErrorCodes.validation_failed
        const status =
          loaded.error === ApiErrorCodes.branch_registry_broken
            ? 409
            : loaded.error === ApiErrorCodes.conversation_chunks_unreadable
              ? 503
              : 400
        return reply.status(status).send({ error: code })
      }
      return loaded.response
    },
  )

  /** 显式中止进行中的流式生成（客户端断线不会调用此接口） */
  app.post<{
    Params: { id: string; generationId: string }
  }>(
    '/api/chat/conversations/:id/generation/:generationId/cancel',
    async (request, reply) => {
      const id = request.params.id
      const generationId = request.params.generationId?.trim() ?? ''
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      if (!generationId || !/^[a-f0-9]{16}$/i.test(generationId)) {
        return reply.status(400).send({ error: ApiErrorCodes.validation_failed })
      }
      const idx = await readConversationIndex(id)
      if (!idx) {
        return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      }
      // 已结束或不存在时仍 200，便于客户端 abort 竞态
      const cancelled = cancelChatGeneration(id, generationId)
      return { ok: true as const, cancelled }
    },
  )

  app.patch<{
    Params: { id: string; turnOrdinal: string }
    Body: {
      userText?: unknown
      receives?: unknown
      activeReceiveIndex?: unknown
    }
  }>(
    '/api/chat/conversations/:id/turns/:turnOrdinal',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const ord = Number.parseInt(request.params.turnOrdinal, 10)
      if (!Number.isInteger(ord) || ord < 0) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_turn_ordinal })
      }
      const b = request.body ?? {}
      const parsed = parseTurnPatchBody({ ...b, turnOrdinal: ord })
      if (!parsed.ok) {
        const code =
          parsed.error in ApiErrorCodes
            ? (parsed.error as (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes])
            : ApiErrorCodes.validation_failed
        return reply.status(400).send({ error: code })
      }
      const patch = parsed.patch
      try {
        const normalized = await loadAndApplyRegexPersistToTurnPatch(id, patch)
        const located = await readChunkContainingOrdinal(id, ord)
        if (!located) {
          const offActive = await isTurnOrdinalOffActivePath(id, ord)
          if (offActive) {
            return reply.status(400).send({ error: ApiErrorCodes.turn_not_on_active_path })
          }
          return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
        }
        const existingTurn = located.chunk.turns.find((t) => t.turnOrdinal === ord)
        const syncedPlugins = await buildSyncedTurnPluginsFromReceives(
          existingTurn?.plugins,
          normalized.receives,
          id,
        )
        const convIdx = await readConversationIndex(id)
        const defaultSpeaker = convIdx ? resolvedCharacterIds(convIdx)[0]?.trim() ?? '' : ''
        let ok: boolean
        if (typeof normalized.segmentIndex === 'number') {
          ok = await updateTurnSegmentInTailChunk(
            id,
            ord,
            normalized.segmentIndex,
            normalized.userText,
            normalized.receives,
            normalized.activeReceiveIndex,
            defaultSpeaker,
            undefined,
            syncedPlugins.length > 0 ? syncedPlugins : undefined,
          )
        } else {
          ok = await updateTurnContentInTailChunk(
            id,
            ord,
            normalized.userText,
            normalized.receives,
            normalized.activeReceiveIndex,
            undefined,
            undefined,
            syncedPlugins,
          )
        }
        if (!ok) {
          const offActive = await isTurnOrdinalOffActivePath(id, ord)
          if (offActive) {
            return reply.status(400).send({ error: ApiErrorCodes.turn_not_on_active_path })
          }
          return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
        }
        return toTurnPatchPersistPayload(normalized, syncedPlugins)
      } catch (e) {
        if (isBranchRegistryBrokenError(e)) {
          return reply.status(409).send({ error: ApiErrorCodes.branch_registry_broken })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.turn_update_failed })
      }
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { turns?: unknown }
  }>(
    '/api/chat/conversations/:id/turns/batch',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const raw = request.body?.turns
      if (!Array.isArray(raw)) {
        return reply.status(400).send({ error: ApiErrorCodes.turns_batch_required })
      }
      if (raw.length === 0) {
        return { ok: 0, failed: [] as { turnOrdinal: number; error: string }[] }
      }
      if (raw.length > CONVERSATION_BATCH_MAX_TURNS) {
        return reply.status(400).send({ error: ApiErrorCodes.turns_batch_too_large })
      }
      const patches = []
      for (const item of raw) {
        const parsed = parseTurnPatchBody(item)
        if (!parsed.ok) {
          const code =
            parsed.error in ApiErrorCodes
              ? (parsed.error as (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes])
              : ApiErrorCodes.validation_failed
          return reply.status(400).send({ error: code })
        }
        patches.push(parsed.patch)
      }
      try {
        const doc = await readRegexRulesDocument()
        const tailOrdinal = await resolveConversationTailOrdinal(id)
        const normalizedPatches = []
        for (const p of patches) {
          normalizedPatches.push(
            await resolveTurnPatchPersistRegex(id, p, doc.rules, tailOrdinal),
          )
        }
        const result = await batchUpdateConversationTurns(id, normalizedPatches)
        return result
      } catch (e) {
        if (isBranchRegistryBrokenError(e)) {
          return reply.status(409).send({ error: ApiErrorCodes.branch_registry_broken })
        }
        if (e instanceof Error && e.message === 'turns_batch_too_large') {
          return reply.status(400).send({ error: ApiErrorCodes.turns_batch_too_large })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.turn_update_failed })
      }
    },
  )

  app.delete<{ Params: { id: string; turnOrdinal: string } }>(
    '/api/chat/conversations/:id/turns/:turnOrdinal',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const ord = Number.parseInt(request.params.turnOrdinal, 10)
      if (!Number.isInteger(ord) || ord < 0) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_turn_ordinal })
      }
      try {
        const located = await readChunkContainingOrdinal(id, ord)
        if (!located) {
          const offActive = await isTurnOrdinalOffActivePath(id, ord)
          if (offActive) {
            return reply.status(400).send({ error: ApiErrorCodes.turn_not_on_active_path })
          }
          return reply.status(404).send({ error: ApiErrorCodes.turn_delete_not_found })
        }
        const victim = located.chunk.turns.find((t) => t.turnOrdinal === ord)
        if (victim?.turnId && (await isTurnIdReferencedByBranchRegistry(id, victim.turnId))) {
          return reply.status(409).send({ error: ApiErrorCodes.fork_turn_has_branches })
        }
        const ok = await removeTurnAtOrdinalInTailChunk(id, ord)
        if (!ok) {
          return reply.status(404).send({ error: ApiErrorCodes.turn_delete_not_found })
        }
        return { ok: true as const }
      } catch (e) {
        if (isBranchRegistryBrokenError(e)) {
          return reply.status(409).send({ error: ApiErrorCodes.branch_registry_broken })
        }
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.turn_delete_failed })
      }
    },
  )

  interface AssembleMessagesBody {
    userText?: string
    promptTrigger?: string
    historyBeforeTurnOrdinalExclusive?: number | null
    contextLength?: number | null
    /** 连接模型名，用于 tiktoken 词表选择 */
    model?: string
  }

  app.post<{ Params: { id: string }; Body: AssembleMessagesBody }>(
    '/api/chat/conversations/:id/assemble-messages',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const b = request.body ?? {}
      const promptsDoc = await readPromptsDocument()
      if (!promptsDoc) {
        return reply.status(500).send({ error: ApiErrorCodes.prompts_unavailable })
      }
      const built = await buildConversationOutboundMessages({
        conversationId: id,
        userText: typeof b.userText === 'string' ? b.userText : '',
        promptTrigger: b.promptTrigger,
        historyBeforeTurnOrdinalExclusive: b.historyBeforeTurnOrdinalExclusive,
        contextLength: b.contextLength,
        tokenModel: typeof b.model === 'string' ? b.model : undefined,
        promptsDoc,
      })
      if ('error' in built) {
        return reply.status(built.status).send({ error: built.error })
      }
      return built
    },
  )

  interface AppendTurnBody {
    userText: string
    receives: { id: string; content: string; reasoning?: string }[]
    activeReceiveIndex: number
    model?: string
  }

  app.post<{ Params: { id: string }; Body: AppendTurnBody }>(
    '/api/chat/conversations/:id/append-turn',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const b = request.body
      if (!b || typeof b.userText !== 'string' || !b.userText.trim()) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_user_text })
      }
      if (!Array.isArray(b.receives) || b.receives.length === 0) {
        return reply.status(400).send({ error: ApiErrorCodes.receives_required_nonempty })
      }
      const mapped: TurnReceive[] = []
      for (let i = 0; i < b.receives.length; i++) {
        const r = b.receives[i]
        if (!r || typeof r.id !== 'string' || typeof r.content !== 'string') {
          return reply.status(400).send({ error: ApiErrorCodes.receives_item_invalid })
        }
        const rec: TurnReceive = { id: r.id, content: r.content }
        if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
          rec.reasoning = r.reasoning
        }
        if (i === 0 && typeof b.model === 'string' && b.model.trim()) {
          rec.runtime = { model: b.model.trim() }
        }
        mapped.push(rec)
      }
      if (
        typeof b.activeReceiveIndex !== 'number' ||
        !Number.isInteger(b.activeReceiveIndex)
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.active_receive_index_must_be_integer })
      }
      try {
        const ok = await appendConversationTurn({
          conversationId: id,
          userText: b.userText.trim(),
          receives: mapped,
          activeReceiveIndex: b.activeReceiveIndex,
        })
        if (!ok) {
          return reply.status(404).send({ error: ApiErrorCodes.conversation_no_tail_chunk })
        }
        return { ok: true as const }
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.append_turn_failed })
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/chat/conversations/:id',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const idx = await readConversationIndex(id)
      if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      return enrichConversationIndexForClient(idx)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/chat/conversations/:id/repair-chunk-index',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      try {
        const result = await repairConversationChunkIndex(id)
        if (!result.ok) {
          if (!result.chunkFileCount) {
            return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
          }
          if (result.brokenChain) {
            return reply.status(409).send({
              error: ApiErrorCodes.chunk_chain_broken,
              headChunkFile: result.headChunkFile,
              tailChunkFile: result.tailChunkFile,
              chunkFileCount: result.chunkFileCount,
            })
          }
          return reply.status(500).send({ error: ApiErrorCodes.chunk_index_repair_failed })
        }
        return {
          ok: true as const,
          repaired: result.repaired,
          headChunkFile: result.headChunkFile,
          tailChunkFile: result.tailChunkFile,
          chunkFileCount: result.chunkFileCount,
          branchScopesRepaired: result.branchScopesRepaired ?? 0,
          branchLabelsRepaired: result.branchLabelsRepaired ?? 0,
          branchLabelRepairFailed: result.branchLabelRepairFailed ?? 0,
          ...(result.branchLabelRepairFailedPaths?.length
            ? { branchLabelRepairFailedPaths: result.branchLabelRepairFailedPaths }
            : {}),
        }
      } catch (e) {
        request.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.chunk_index_repair_failed })
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/chat/conversations/:id/context/recall-test',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const idx = await readConversationIndex(id)
      if (!idx) {
        return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      }
      const parsed = parseContextRecallTestBody(request.body)
      if (!parsed.ok) {
        const code =
          parsed.error in ApiErrorCodes
            ? (parsed.error as (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes])
            : ApiErrorCodes.validation_failed
        return reply.status(400).send({ error: code })
      }
      try {
        return await runContextRecallTest(id, parsed.request, idx)
      } catch (e) {
        request.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.validation_failed })
      }
    },
  )

  app.post<{ Params: { id: string }; Querystring: { stream?: string } }>(
    '/api/chat/conversations/:id/memory/rebuild',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const idx = await readConversationIndex(id)
      if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      const wantStream =
        request.query.stream === '1' || request.query.stream === 'true'
      if (wantStream) {
        const stream = startConversationMemoryReindexSse(id, reply)
        return reply.send(stream)
      }
      try {
        const result = await reindexConversationMemory(id)
        if (!result.ok) {
          return reply.status(502).send(result)
        }
        return result
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ ok: false, error: ApiErrorCodes.memory_rebuild_failed })
      }
    },
  )

  /** 调试：读取会话目录下 chat-audit.json（含 messages + assembly + groupChat + calls） */
  app.get<{ Params: { id: string } }>(
    '/api/chat/conversations/:id/chat-audit',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const idx = await readConversationIndex(id)
      if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      const file = await readChatAuditFile(id)
      return file
    },
  )

  app.post('/api/chat/import-st/preview', async (request, reply) => {
    const ct = request.headers['content-type'] ?? ''
    if (ct.includes('multipart/form-data')) {
      const file = await request.file()
      if (!file) {
        return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
      }
      try {
        return await streamPreviewStChat(file.file)
      } catch (e) {
        app.log.error(e)
        return reply.status(500).send({ error: ApiErrorCodes.st_chat_import_failed })
      }
    }
    const body = request.body
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
    const raw = body as { source?: unknown; text?: unknown }
    const text =
      typeof raw.text === 'string'
        ? raw.text
        : typeof raw.source === 'string'
          ? raw.source
          : ''
    if (!text.trim()) {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
    try {
      return previewStChatImport(text)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.st_chat_import_failed })
    }
  })

  app.post('/api/chat/import-st', async (request, reply) => {
    const ct = request.headers['content-type'] ?? ''
    if (!ct.includes('multipart/form-data')) {
      return reply.status(400).send({ error: ApiErrorCodes.multipart_payload_required })
    }
    let conversationId = ''
    const parts = request.parts()
    for await (const part of parts) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'field' &&
        (part as { fieldname?: string }).fieldname === 'conversationId'
      ) {
        const v = (part as { value?: unknown }).value
        conversationId = typeof v === 'string' ? v.trim() : ''
      } else if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'file' &&
        'file' in part
      ) {
        const fileStream = (part as { file: NodeJS.ReadableStream }).file
        if (!conversationId || !isValidConversationId(conversationId)) {
          await drainReadableStream(fileStream)
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.invalid_conversation_id })
        }
        const idx = await readConversationIndex(conversationId)
        if (!idx) {
          await drainReadableStream(fileStream)
          return reply
            .status(404)
            .send({ error: ApiErrorCodes.conversation_not_found })
        }
        if (idx.headChunkFile) {
          await drainReadableStream(fileStream)
          return reply
            .status(409)
            .send({ error: ApiErrorCodes.st_chat_conversation_not_empty })
        }
        const charIds = resolvedCharacterIds(idx)
        const speakerCharacterId = charIds[0]?.trim() ?? ''
        if (!speakerCharacterId || !idx.userCharacterId?.trim()) {
          await drainReadableStream(fileStream)
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.st_chat_bindings_required })
        }
        try {
          const result = await importStChatFromStream({
            conversationId,
            speakerCharacterId,
            stream: fileStream,
          })
          if (!result) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.st_import_invalid_format })
          }
          return {
            ok: true as const,
            conversationId,
            turnCount: result.turnCount,
            warnings: result.warnings,
          }
        } catch (e) {
          app.log.error(e)
          return reply
            .status(500)
            .send({ error: ApiErrorCodes.st_chat_import_failed })
        }
      }
    }
    return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
  })

  app.post<{ Body: ChatBody }>('/api/chat', async (request, reply) => {
    const body = request.body ?? ({} as ChatBody)
    const convId =
      typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
    if (convId && !isValidConversationId(convId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_conversation_id })
    }

    let apiKey: string
    let baseUrl: string
    let mergedBody: ChatBody = body
    const resolvedFeature = await resolveChatFeatureAudit(convId || undefined)
    try {
      if (convId) {
        const resolved = await resolveConversationChatCall(convId, body)
        apiKey = resolved.apiKey
        baseUrl = resolved.baseUrl
        const fields = resolvedParamsToChatBodyFields(resolved.params)
        mergedBody = {
          ...body,
          ...fields,
          apiPresetId: resolved.presetId,
          baseUrl: undefined,
          apiKeyId: undefined,
        }
      } else {
        const creds = await resolveChatCredentials({
          apiPresetId: body.apiPresetId,
          apiKeyId: body.apiKeyId,
          baseUrl: body.baseUrl,
        })
        apiKey = creds.apiKey
        baseUrl = creds.baseUrl
      }
    } catch (e) {
      if (e instanceof ApiCredentialError) {
        return reply.status(400).send({ error: e.code })
      }
      throw e
    }

    const model = mergedBody.model
    if (!model || typeof model !== 'string') {
      return reply.status(400).send({ error: ApiErrorCodes.missing_model })
    }

    const userText = typeof body.userText === 'string' ? body.userText : ''
    let messages: ChatMessage[]
    let estimatedTokens: number | undefined
    let assemblyAudit: import('../chat-audit-types.js').AssemblyAudit | undefined
    let assemblyEmbeddingCalls:
      | import('../chat-audit-types.js').CallAuditEntry[]
      | undefined
    let performanceAuditBase: PerformanceAudit | undefined
    let buildFinishedAt = 0
    let assembledSpeakerCharacterId = ''
    if (convId) {
      const promptsDoc = await readPromptsDocument()
      if (!promptsDoc) {
        return reply.status(500).send({ error: ApiErrorCodes.prompts_unavailable })
      }
      const regenSegRaw = body.regenerateSegmentIndex
      const regenerateSegmentIndex =
        typeof regenSegRaw === 'number' &&
        Number.isInteger(regenSegRaw) &&
        regenSegRaw >= 0
          ? regenSegRaw
          : undefined
      const groupContinue = parseGroupContinueBody(body.groupContinue)
      const built = await buildConversationOutboundMessages({
        conversationId: convId,
        userText,
        promptTrigger: body.promptTrigger,
        historyBeforeTurnOrdinalExclusive: body.historyBeforeTurnOrdinalExclusive,
        regenerateTurnOrdinal: body.regenerateTurnOrdinal,
        regenerateSegmentIndex,
        speakerCharacterId:
          typeof body.speakerCharacterId === 'string'
            ? body.speakerCharacterId.trim()
            : groupContinue?.speakerCharacterId,
        speakerQueue: Array.isArray(body.speakerQueue)
          ? body.speakerQueue.filter(
              (id): id is string => typeof id === 'string' && id.trim().length > 0,
            )
          : undefined,
        speakerQueueDisplayNames: Array.isArray(body.speakerQueueDisplayNames)
          ? body.speakerQueueDisplayNames.filter(
              (n): n is string => typeof n === 'string' && n.trim().length > 0,
            )
          : undefined,
        groupContinue: groupContinue ?? undefined,
        contextLength: mergedBody.contextLength,
        tokenModel: model,
        promptsDoc,
        plugins: body.plugins,
      })
      if ('error' in built) {
        return reply.status(built.status).send({ error: built.error })
      }
      messages = built.messages
      estimatedTokens = built.estimatedTokens
      assemblyAudit = built.assemblyAudit
      assemblyEmbeddingCalls = built.assemblyEmbeddingCalls
      performanceAuditBase = built.performanceAudit
      assembledSpeakerCharacterId = built.speakerCharacterId?.trim() ?? ''
      buildFinishedAt = performance.now()
    } else {
      const v = validateChatMessages(body.messages)
      if (!v.ok) {
        return reply.status(400).send({ error: v.error })
      }
      messages = v.msgs
    }

    const regenOrdRaw = body.regenerateTurnOrdinal
    const regenerateTurnOrdinal =
      typeof regenOrdRaw === 'number' &&
      Number.isInteger(regenOrdRaw) &&
      regenOrdRaw >= 0
        ? regenOrdRaw
        : undefined

    const turnPluginEntries = await resolveTurnPluginEntriesFromBody(body.plugins)

    const groupContinueForPersist = parseGroupContinueBody(body.groupContinue)
    const hasGroupContinue = groupContinueForPersist !== null

    const persistParams =
      convId && (userText.trim() || hasGroupContinue)
        ? {
            conversationId: convId,
            userText: userText.trim(),
            model: model.trim() || undefined,
            assembledMessages: messages,
            regenerateTurnOrdinal,
            regenerateSegmentIndex:
              typeof body.regenerateSegmentIndex === 'number' &&
              Number.isInteger(body.regenerateSegmentIndex) &&
              body.regenerateSegmentIndex >= 0
                ? body.regenerateSegmentIndex
                : undefined,
            speakerCharacterId:
              assembledSpeakerCharacterId ||
              (typeof body.speakerCharacterId === 'string'
                ? body.speakerCharacterId.trim()
                : undefined),
            speakerQueue: Array.isArray(body.speakerQueue)
              ? body.speakerQueue.filter(
                  (id): id is string => typeof id === 'string' && id.trim().length > 0,
                )
              : undefined,
            speakerQueueDisplayNames: Array.isArray(body.speakerQueueDisplayNames)
              ? body.speakerQueueDisplayNames.filter(
                  (n): n is string => typeof n === 'string' && n.trim().length > 0,
                )
              : undefined,
            groupContinue: hasGroupContinue ? groupContinueForPersist! : undefined,
            estimatedTokens,
            resolvedFeature,
            assemblyAudit,
            assemblyEmbeddingCalls,
            turnPluginEntries:
              turnPluginEntries.length > 0 ? turnPluginEntries : undefined,
            chatPlugins: body.plugins,
            performanceAudit: performanceAuditBase,
          }
        : null

    const wantStream = Boolean(mergedBody.stream)
    const payload = buildUpstreamPayload({
      ...mergedBody,
      messages,
      stream: wantStream,
    })
    const url = `${baseUrl}/chat/completions`
    const upstreamStartedAt = performance.now()
    const preUpstreamMs =
      performanceAuditBase && buildFinishedAt > 0
        ? Math.round(upstreamStartedAt - buildFinishedAt)
        : undefined

    const streamTimeoutMs = wantStream
      ? UPSTREAM_STREAM_FETCH_TIMEOUT_MS
      : UPSTREAM_FETCH_TIMEOUT_MS
    /** 仅显式 cancel / timeout 会 abort；客户端断线不绑定 */
    const generationAbort = wantStream ? new AbortController() : null
    let generationId: string | null = null
    if (wantStream && generationAbort && convId) {
      const clientGid =
        typeof body.generationId === 'string' ? body.generationId.trim() : ''
      generationId = registerChatGeneration(
        convId,
        generationAbort,
        isChatGenerationIdFormat(clientGid) ? clientGid : undefined,
      )
    }

    /** 流式：组装（含掷骰）结束后立刻开 SSE 下发 speaker，再拉上游 */
    if (wantStream) {
      const out = new PassThrough()
      reply.header('Content-Type', 'text/event-stream; charset=utf-8')
      reply.header('Cache-Control', 'no-cache')
      reply.header('Connection', 'keep-alive')
      reply.header('X-Accel-Buffering', 'no')
      if (generationId) {
        reply.header('X-Chat-Generation-Id', generationId)
      }
      if (typeof estimatedTokens === 'number' && estimatedTokens > 0) {
        reply.header('X-Prompt-Estimated-Tokens', String(Math.round(estimatedTokens)))
      }
      if (assembledSpeakerCharacterId) {
        reply.header('X-Speaker-Character-Id', assembledSpeakerCharacterId)
        const speakerLine = formatArousalSpeakerSseLine(assembledSpeakerCharacterId)
        if (speakerLine) out.write(speakerLine)
      }

      void (async () => {
        const finishGeneration = (): void => {
          if (generationId) unregisterChatGeneration(generationId)
        }
        let upstream: Response
        try {
          upstream = await fetchWithTimeout(
            url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(payload),
              ...(generationAbort
                ? {
                    signal: mergeChatUpstreamAbortSignals(
                      generationAbort,
                      streamTimeoutMs,
                    ),
                  }
                : {}),
            },
            streamTimeoutMs,
          )
        } catch (err) {
          finishGeneration()
          request.log.error(err, 'stream upstream fetch error')
          if (!out.destroyed) {
            out.write(
              formatArousalStreamErrorSseLine(
                ApiErrorCodes.upstream_api_error,
                err instanceof Error ? err.message : String(err),
              ),
            )
            out.end()
          }
          return
        }

        if (!upstream.ok || !upstream.body) {
          finishGeneration()
          const text = upstream.ok ? '' : await upstream.text()
          request.log.warn(
            { status: upstream.status, body: text.slice(0, 500) },
            'upstream error',
          )
          if (!out.destroyed) {
            out.write(
              formatArousalStreamErrorSseLine(
                ApiErrorCodes.upstream_api_error,
                text.slice(0, 2000) || `status ${upstream.status}`,
              ),
            )
            out.end()
          }
          return
        }

        const responseHeadersAt = performance.now()
        const trackStreamPerf = Boolean(performanceAuditBase)

        let sseBuffer = ''
        let accContent = ''
        let accReasoning = ''
        let accCompletionTokens: number | undefined
        let firstTokenAt: number | undefined
        let lastTokenAt: number | undefined

        const tap = new Transform({
          transform(chunk, _enc, cb) {
            sseBuffer += chunk.toString('utf8')
            const parts = sseBuffer.split('\n')
            sseBuffer = parts.pop() ?? ''
            for (const line of parts) {
              const d = parseSseDataLine(line)
              if (!d) continue
              if (trackStreamPerf && isSseContentDelta(d)) {
                const now = performance.now()
                if (firstTokenAt === undefined) firstTokenAt = now
                lastTokenAt = now
              }
              if (d.text) accContent += d.text
              if (d.reasoning) accReasoning += d.reasoning
              if (d.completionTokens) accCompletionTokens = d.completionTokens
            }
            cb(null, chunk)
          },
          flush(cb) {
            if (sseBuffer.trim()) {
              for (const line of sseBuffer.split('\n')) {
                const d = parseSseDataLine(line)
                if (!d) continue
                if (trackStreamPerf && isSseContentDelta(d)) {
                  const now = performance.now()
                  if (firstTokenAt === undefined) firstTokenAt = now
                  lastTokenAt = now
                }
                if (d.text) accContent += d.text
                if (d.reasoning) accReasoning += d.reasoning
                if (d.completionTokens) accCompletionTokens = d.completionTokens
              }
              sseBuffer = ''
            }
            const isUserCancelled = (): boolean =>
              generationId != null &&
              Boolean(getChatGeneration(generationId)?.userCancelled)
            if (isUserCancelled() || !persistParams || !accContent.trim()) {
              cb()
              return
            }
            const streamEndedAt = performance.now()
            const performanceAudit = buildPerformanceForPersist(
              persistParams.performanceAudit,
              {
                upstreamStartedAt,
                responseHeadersAt,
                firstTokenAt,
                lastTokenAt,
                streamEndedAt,
                completionTokensUpstream: accCompletionTokens,
                assistantContent: accContent,
                assistantReasoning: accReasoning.trim() || undefined,
                model,
                preUpstreamMs,
              },
            )
            void (async () => {
              if (isUserCancelled()) {
                cb()
                return
              }
              try {
                const persist = await persistTurnAfterModelReply({
                  ...persistParams,
                  assistantContent: accContent,
                  assistantReasoning: accReasoning.trim() || undefined,
                  durationMs: Math.round(streamEndedAt - upstreamStartedAt),
                  estimatedTokens: persistParams.estimatedTokens,
                  completionTokens: accCompletionTokens,
                  performanceAudit,
                  isCancelled: isUserCancelled,
                })
                if (
                  isUserCancelled() ||
                  persist.error === ApiErrorCodes.persist_cancelled_by_user
                ) {
                  cb()
                  return
                }
                if (!persist.ok) {
                  request.log.warn({ persist }, 'stream persist failed')
                }
                this.push(formatArousalPersistSseLine(persist))
                cb()
              } catch (err) {
                request.log.error(err, 'stream persist error')
                if (!isUserCancelled()) {
                  this.push(
                    formatArousalPersistSseLine({
                      ok: false,
                      error: ApiErrorCodes.persist_error,
                    }),
                  )
                }
                cb()
              }
            })()
          },
        })

        const nodeStream = pipeUpstreamSseBody(
          upstream.body as ReadableStream<Uint8Array>,
          tap,
          request.log,
        )
        nodeStream.once('error', (err) => {
          request.log.warn({ err }, 'chat upstream SSE pipeline')
          if (out.destroyed || out.writableEnded) return
          const detail =
            err instanceof Error ? err.message : String(err ?? 'stream error')
          try {
            if (!out.destroyed && out.writable) {
              out.write(
                formatArousalStreamErrorSseLine(
                  ApiErrorCodes.upstream_api_error,
                  detail,
                ),
              )
              out.end()
            }
          } catch {
            try {
              out.destroy(err instanceof Error ? err : undefined)
            } catch {
              /* ignore */
            }
          }
        })
        // 须在 tap.flush（含 cancel 判定与 persist）之后再注销 generation
        nodeStream.once('close', finishGeneration)
        attachBestEffortClientSseSink(nodeStream, out, request.log)
      })()

      return reply.send(out)
    }

    const upstream = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      streamTimeoutMs,
    )

    if (!upstream.ok) {
      const text = await upstream.text()
      request.log.warn(
        { status: upstream.status, body: text.slice(0, 500) },
        'upstream error',
      )
      return reply.status(502).send({
        error: ApiErrorCodes.upstream_api_error,
        status: upstream.status,
        detail: text.slice(0, 2000),
      })
    }

    const responseHeadersAt = performance.now()

    const text = await upstream.text()
    let data: unknown
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      return reply.status(502).send({ error: ApiErrorCodes.upstream_non_json })
    }

    const choices = (data as { choices?: unknown }).choices
    const first = Array.isArray(choices) ? choices[0] : undefined
    const msg =
      first && typeof first === 'object' && first !== null && 'message' in first
        ? (first as { message?: { role?: string; content?: string } }).message
        : undefined
    const content = typeof msg?.content === 'string' ? msg.content : ''
    const reasoning = extractReasoningFromMessage(msg)
    const completionTokens = extractCompletionTokens(data)
    const promptTokens = extractPromptTokens(data)

    let persist: Awaited<ReturnType<typeof persistTurnAfterModelReply>> | undefined
    if (persistParams && content.trim()) {
      const streamEndedAt = performance.now()
      const performanceAudit = buildPerformanceForPersist(
        persistParams.performanceAudit,
        {
          upstreamStartedAt,
          responseHeadersAt,
          streamEndedAt,
          completionTokensUpstream: completionTokens,
          assistantContent: content,
          assistantReasoning: reasoning,
          model,
          preUpstreamMs,
        },
      )
      persist = await persistTurnAfterModelReply({
        ...persistParams,
        assistantContent: content,
        assistantReasoning: reasoning,
        durationMs: Math.round(streamEndedAt - upstreamStartedAt),
        estimatedTokens: persistParams.estimatedTokens,
        completionTokens,
        promptTokens,
        performanceAudit,
      })
      if (!persist.ok) {
        request.log.warn({ persist }, 'persist after chat failed')
      }
    }

    return reply.send({
      message: {
        role: (msg?.role as ChatRole) ?? 'assistant',
        content,
        ...(reasoning ? { reasoning } : {}),
      },
      ...(persist !== undefined ? { persist } : {}),
      ...(assembledSpeakerCharacterId
        ? { speakerCharacterId: assembledSpeakerCharacterId }
        : {}),
      ...(typeof estimatedTokens === 'number' && estimatedTokens > 0
        ? { estimatedTokens }
        : {}),
      ...(typeof completionTokens === 'number' && completionTokens > 0
        ? { completionTokens }
        : {}),
      raw: data,
    })
  })
}
