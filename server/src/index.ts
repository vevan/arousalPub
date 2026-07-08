import cors from '@fastify/cors'
import { ApiErrorCodes } from './api-error-codes.js'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { closeAllLanceConnections } from './lance-connection-pool.js'
import { generateShortId, isValidShortId } from './short-id.js'
import { Transform } from 'node:stream'
import {
  readApiSettingsFromFile,
  writeApiSettingsToFile,
  type ApiPreset,
  type ApiSettingsDocument,
} from './api-settings-file.js'
import {
  resolveChatFeatureAudit,
  resolveConversationChatCall,
  resolvedParamsToChatBodyFields,
} from './conversation-api-resolve.js'
import { parseAuthorsNotePatch, parseDefaultAuthorsNotePatch } from './authors-note-settings.js'
import {
  repairConversationChunkIndex,
  readChunkContainingOrdinal,
  isTurnOrdinalOffActivePath,
  isBranchRegistryBrokenError,
} from './chunk-chain.js'
import { loadConversationMessages } from './conversation-messages-api.js'
import {
  createConversationStub,
  deleteConversation,
  readChatList,
  readConversationIndex,
  resolvedCharacterIds,
  removeTurnAtOrdinalInTailChunk,
  appendConversationTurn,
  updateConversationAuditDebug,
  saveOpeningTurn,
  saveFirstTurn,
  updateConversationTitle,
  updateConversationCharacterBindings,
  updateConversationPromptPresetId,
  updateConversationLorebookIds,
  updateConversationLorebookSettings,
  clearConversationLorebookSettings,
  clearConversationHistorySettings,
  updateConversationHistorySettings,
  clearConversationMemorySettings,
  updateConversationMemorySettings,
  clearConversationBudgetTrimSettings,
  updateConversationBudgetTrimSettings,
  updateConversationUserCharacterId,
  updateConversationUserName,
  updateConversationAuthorsNote,
  updateConversationGroupChat,
  clearConversationChatApiSettings,
  updateConversationChatApiSettings,
  clearConversationEmbeddingApiSettings,
  updateConversationEmbeddingApiSettings,
  updateConversationPluginSettings,
  parseConversationChatBinding,
  parseConversationEmbeddingApiOverride,
  getTurnUserText,
  batchUpdateConversationTurns,
  updateTurnContentInTailChunk,
  updateTurnSegmentInTailChunk,
  type TurnReceive,
} from './chat-storage.js'
import { parseGroupContinueBody } from './group-chat-turn.js'
import {
  createEmptyConversationBranch,
  deleteConversationBranch,
  getConversationBranchTree,
  isTurnIdReferencedByBranchRegistry,
  updateConversationActiveBranchPath,
  updateConversationBranchLabel,
} from './conversation-branches.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  parseTurnPatchBody,
} from './turn-patch-body.js'
import { reindexConversationMemory } from './memory-index.js'
import { startConversationMemoryReindexSse } from './memory-reindex-sse.js'
import {
  resolveClientWhitelist,
  resolveCorsOrigins,
  resolveListenHost,
  resolveServerPort,
} from './config.js'
import { isClientIpAllowed } from './client-ip.js'
import { mergeCustomParamsIntoPayload } from './custom-params-merge.js'
import { appendDrySamplerToPayload } from './dry-sampler.js'
import { tryAcquireAuthRateLimitSlot } from './auth-rate-limit.js'
import {
  bindChatClientAbort,
  mergeChatUpstreamAbortSignals,
  pipeUpstreamSseBody,
} from './chat-upstream-stream.js'
import {
  fetchWithTimeout,
  UPSTREAM_FETCH_TIMEOUT_MS,
  UPSTREAM_STREAM_FETCH_TIMEOUT_MS,
} from './fetch-with-timeout.js'
import { readBuildInfoDocument } from './build-meta.js'
import { registerStaticWeb } from './static-web.js'
import {
  readUserPreferencesDocument,
  updateGlobalHistorySettings,
  updateGlobalLorebookSettings,
  updateGlobalMemorySettings,
  updateGlobalBudgetTrimSettings,
  updateGlobalEmbeddingApiSettings,
  updateGlobalChunkSettings,
  updateGlobalDefaultAuthorsNote,
  updateGlobalHybridFtsSettings,
  updateGlobalPostUserInjectionOrder,
} from './user-preferences-file.js'
import {
  normalizeHybridFtsProfile,
  normalizeHybridFtsSettings,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'
import {
  clampInjectionOrder,
  normalizePostUserInjectionOrderHostPolicy,
  POST_USER_INJECTION_ORDER_HOST_KEYS,
  type PostUserInjectionOrderHostKey,
  type PostUserInjectionOrderHostPatch,
} from './shared/post-user-injection-order.js'
import { registerHybridFtsRoutes } from './hybrid-fts-routes.js'
import { parseBudgetTrimSettingsPatch } from './budget-trim-settings.js'
import { parseMemorySettingsPatch } from './memory-settings.js'
import { normalizeEmbeddingDimensions, normalizeEmbeddingApiSettings } from './embedding-api-settings.js'
import {
  isValidConversationId,
} from './conversation-id.js'
import { registerAdminConsole } from './admin/routes.js'
import { registerAuth } from './auth.js'
import {
  parseContextRecallTestBody,
  runContextRecallTest,
} from './context-recall-test.js'
import { registerRegexRoutes } from './regex-routes.js'
import { resolveDataEncryptionKey } from './data-encryption-key.js'
import { registerMaintenanceGuard } from './maintenance-guard.js'
import {
  getBackupStatus,
  scheduleStartupBackupIfNeeded,
} from './data-backup.js'
import { ensureUsersRegistry, findUserById, readUsersIndex } from './users-index.js'
import {
  assertValidPromptPresetBody,
  assertValidPromptsPayload,
  deletePromptPreset,
  isValidPromptPresetId,
  patchPromptsIndex,
  readPromptPresetById,
  readPromptsDocument,
  readPromptsIndexDocument,
  writePromptPreset,
  writePromptsDocument,
  type PromptsDocument,
} from './prompts-file.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'
import type { PromptPreset } from './assemble-prompts.js'
import { isPromptsSeedPut } from './prompts-default-seed.js'
import {
  assertValidLorebooksPayload,
  LOREBOOKS_BULK_PUT_MAX_JSON_BYTES,
  readLorebookById,
  readLorebooksDocument,
  readLorebooksIndexSummary,
  writeLorebook,
  writeLorebooksDocument,
  LOREBOOK_ID_RE,
  type LorebooksDocument,
} from './lorebook-file.js'
import { tryAcquireLorebooksBulkPutSlot } from './lorebooks-bulk-put-limit.js'
import {
  readApiKeysDocument,
  writeApiKeysDocument,
  type ApiKeysDocument,
} from './api-keys-file.js'
import {
  mergeApiKeysPutPayload,
  parseApiKeysPutPayload,
  sanitizeApiKeysDocumentForGet,
} from './api-keys-sanitize.js'
import {
  mergeApiSettingsPut,
  sanitizeApiSettingsDocumentForGet,
  type ApiSettingsPutBody,
} from './api-settings-sanitize.js'
import {
  ApiConfigInUseError,
  assertRemovedApiKeysNotInUse,
  deleteApiKeyFromFile,
  deleteApiPresetFromFile,
  findApiKeyReferences,
  findApiPresetReferences,
} from './api-config-references.js'
import {
  ApiCredentialError,
  resolveChatCredentials,
} from './api-credential-resolve.js'
import { testApiPresetConnectivity } from './api-preset-test.js'
import { fetchUpstreamModelsList } from './upstream-models.js'
import { sanitizeEmbeddingApiForGet } from './embedding-api-sanitize.js'
import { verifyPassword } from './auth-password.js'
import { getCurrentUserId } from './user-context.js'
import { buildConversationOutboundMessages } from './chat-assemble.js'
import { resolveTurnPluginEntriesFromBody } from './plugin-host.js'
import {
  bootstrapBundledPluginsAtStartup,
  listPublicPluginRegistry,
  listPluginsManage,
  readMergedPluginUserSettings,
  readPluginDistFile,
  readPluginLocaleFile,
  savePluginRegistry,
  writePluginUserSettings,
} from './plugin-system/loader.js'
import {
  readPluginBundledAsset,
  readPluginUserAsset,
  savePluginUserAssetUpload,
} from './plugin-system/plugin-assets.js'
import { readPluginManifest } from './plugin-system/manifest.js'
import { assertValidPluginId } from './plugin-system/plugin-id.js'
import { scheduleLorebookVectorReindex } from './lorebook-vector-index.js'
import {
  createLorebookEntriesBatch,
  createLorebookEntry,
  patchLorebookEntry,
  LOREBOOK_ENTRY_ID_RE,
  type LorebookEntryCreateBody,
} from './lorebook-entries.js'
import { resolvePluginCompleteApi } from './plugin-api-resolve.js'
import {
  listPluginActionPermissions,
  mapPluginActionErrorStatus,
  runPluginActionRoute,
} from './plugin-action-route.js'
import { dispatchConversationLifecycle } from './plugin-lifecycle.js'
import { shutdownAllPluginWorkers } from './plugin-system/plugin-worker-client.js'
import { runPluginComplete } from './plugin-complete.js'
import { runPluginCompletePreflight } from './plugin-complete-preflight.js'
import { runNormalizeLorebookEntryRefs } from './plugin-lorebook-entry-refs.js'
import { runApplyLorebookOrder } from './plugin-lorebook-apply-order.js'
import { ensurePluginLorebook } from './plugin-lorebook-ensure.js'
import { runPluginMacroExpand } from './plugin-macro-expand.js'
import {
  contextBlockSpecsNeedLorebookRead,
  parseContextBlockSpecs,
  runPluginContextBlocksResolve,
} from './plugin-context-blocks-resolve.js'
import {
  parseAssemblePluginPromptBody,
  runAssemblePluginPrompt,
} from './plugin-assemble-prompt.js'
import {
  parseCompleteWithContextBody,
  runCompleteWithContext,
} from './plugin-complete-with-context.js'
import { assertPluginRoutePermission } from './plugin-route-auth.js'
import {
  applyPromptMacroPipeline,
  buildPromptMacroContext,
  extractMacroCharacterFields,
  type MacroContextCharacterInput,
} from './prompt-macros/index.js'
import {
  loadMacroGlobalVarsForContext,
  loadMacroLocalVarsForConversation,
  persistMacroVarMutations,
} from './prompt-macros/macro-vars-persist.js'
import {
  runPromptsAssemblePreview,
  type PromptsAssemblePreviewBody,
} from './prompts-assemble-preview.js'
import { isStOpenAiPreset } from './st-preset-detect.js'
import { convertStPresetToArousalPub } from './st-preset-import.js'
import {
  convertStLorebookToLorebook,
  isStLorebookJson,
  previewStLorebookImport,
  ST_LOREBOOK_IMPORT_MAX_ENTRIES,
} from './st-lorebook-import.js'
import {
  importStChatFromStream,
  previewStChatImport,
  streamPreviewStChat,
} from './st-chat-import.js'
import { StPresetValidationError } from './st-preset-limits.js'
import { persistTurnAfterModelReply } from './chat-persist-after-chat.js'
import {
  loadAndApplyRegexPersistToTurnPatch,
  resolveTurnPatchPersistRegex,
  resolveConversationTailOrdinal,
  toTurnPatchPersistPayload,
} from './regex-persist-patch.js'
import { buildSyncedTurnPluginsFromReceives } from './turn-plugin-sync-from-assistant.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import { extractCompletionTokens, extractPromptTokens } from './chat-usage.js'
import { readChatAuditFile } from './chat-audit-file.js'
import {
  buildPerformanceForPersist,
  isSseContentDelta,
} from './chat-audit-performance.js'
import type { PerformanceAudit } from './chat-audit-types.js'
import {
  formatArousalPersistSseLine,
  parseSseDataLine,
} from './sse-assistant.js'
import { buildStV2CharacterExport, isPngBuffer } from './character-png.js'
import {
  buildCharacterExportFilename,
  cardFromNewCharacterForm,
  contentDispositionAttachment,
  deleteCharacterFile,
  enrichConversationIndexForClient,
  importCharacterCard,
  importCharacterCardPng,
  importCharacterCardWithPortrait,
  listCharacterSummaries,
  normalizeImportCard,
  parseCharacterListKind,
  parseCharacterListSort,
  parseCharacterListSortOrder,
  parseIsUserFromBody,
  patchCharacterDocument,
  readCharacterDocument,
  readCharacterDocumentForApi,
  readCharacterPngBuffer,
  updateCharacterPortrait,
} from './character-storage.js'
import {
  portraitImageCacheControl,
  resolvePortraitImageResponse,
} from './portrait-image.js'

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

interface ModelsListBody {
  baseUrl?: string
  apiPresetId?: string
  apiKeyId?: string | null
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

/** 角色卡 PNG 等 multipart 可能超过默认 1MB，需与 @fastify/multipart 的 fileSize 上限一致 */
const ST_IMPORT_FILE_SIZE_LIMIT = 50 * 1024 * 1024
const app = Fastify({
  logger: true,
  bodyLimit: ST_IMPORT_FILE_SIZE_LIMIT,
})

const corsOrigins = resolveCorsOrigins()
const clientWhitelist = resolveClientWhitelist()
if (clientWhitelist.length > 0) {
  // eslint-disable-next-line no-console
  console.log(
    `[config] clientWhitelist active (${clientWhitelist.length} pattern(s))`,
  )
}
await app.register(cors, {
  origin(origin, cb) {
    if (!origin) {
      cb(null, true)
      return
    }
    if (corsOrigins.length === 0) {
      cb(null, false)
      return
    }
    if (corsOrigins.includes(origin)) {
      cb(null, true)
      return
    }
    cb(null, false)
  },
})
app.addHook('onRequest', (request, reply, done) => {
  if (!clientWhitelist.length) {
    done()
    return
  }
  if (!isClientIpAllowed(request.ip, clientWhitelist)) {
    void reply.status(403).send({ error: ApiErrorCodes.client_ip_not_allowed })
    return
  }
  done()
})
await app.register(multipart, {
  limits: { fileSize: ST_IMPORT_FILE_SIZE_LIMIT },
})

app.addHook('onClose', async () => {
  closeAllLanceConnections()
  await shutdownAllPluginWorkers()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    closeAllLanceConnections()
    void shutdownAllPluginWorkers()
  })
}
registerMaintenanceGuard(app)
await registerAuth(app)
registerRegexRoutes(app)
registerHybridFtsRoutes(app)

app.addHook('preHandler', async (request, reply) => {
  const pluginId = (request.params as { pluginId?: string }).pluginId
  if (typeof pluginId !== 'string' || !pluginId.length) return
  try {
    assertValidPluginId(pluginId)
  } catch {
    return reply.status(400).send({ error: ApiErrorCodes.invalid_plugin_id })
  }
})

await registerAdminConsole(app)
await ensureUsersRegistry()
resolveDataEncryptionKey()
await bootstrapBundledPluginsAtStartup()

app.get('/health', async () => ({ ok: true as const }))

app.get('/api/backup/status', async () => getBackupStatus())

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
  /** 资料库递归 / 向量：`recursiveEnabled`、`maxRecursionDepth`、`vectorEnabled`、`vectorTopK` */
  lorebookSettings?: {
    recursiveEnabled?: boolean
    maxRecursionDepth?: number
    vectorEnabled?: boolean
    vectorTopK?: number
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
    trimOrder?: ('lore' | 'memory' | 'history')[]
    minRetain?: {
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
    const hasLorebookSettings = Object.prototype.hasOwnProperty.call(
      b,
      'lorebookSettings',
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
    if (
      !hasTitle &&
      !hasAuditDebug &&
      !hasCharIds &&
      !hasPromptPreset &&
      !hasLorebookIds &&
      !hasLorebookSettings &&
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
      !hasGroupChat
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
    const [macroLocalVars, macroGlobalVars] = await Promise.all([
      loadMacroLocalVarsForConversation(id),
      loadMacroGlobalVarsForContext(),
    ])
    const openingMacroCtx = buildPromptMacroContext({
      conversationUserName: idxForMacro?.userName,
      characters: macroChars,
      userCharacter: userCharacterForMacro,
      conversationId: id,
      macroLocalVars,
      macroGlobalVars,
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
        loaded.error === ApiErrorCodes.branch_registry_broken ? 409 : 400
      return reply.status(status).send({ error: code })
    }
    return loaded.response
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

app.get('/api/user-preferences', async (_request, reply) => {
  try {
    const doc = await readUserPreferencesDocument()
    const embeddingApi = await sanitizeEmbeddingApiForGet(
      normalizeEmbeddingApiSettings(doc.embeddingApi),
    )
    return { ...doc, embeddingApi }
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.user_preferences_read_failed })
  }
})

interface PatchUserPreferencesBody {
  lorebook?: {
    recursiveEnabled?: boolean
    maxRecursionDepth?: number
    keywordTopK?: number
    vectorEnabled?: boolean
    vectorTopK?: number
  }
  history?: {
    limitEnabled?: boolean
    maxTurns?: number
  }
  memory?: {
    memoryEnabled?: boolean
    memoryTopK?: number
    stripPluginBlocks?: boolean
    stripBlockTags?: string[]
    recallFuseLastAssistant?: boolean
    recallUserWeight?: number
  }
  budgetTrim?: {
    trimOrder?: ('lore' | 'memory' | 'history')[]
    minRetain?: {
      lore?: number
      memory?: number
      history?: number
    }
  }
  embeddingApi?: {
    baseUrl?: string
    apiKey?: string
    apiKeyId?: string | null
    embeddingModel?: string
  }
  chunk?: {
    turnsPerFile?: number
  }
  defaultAuthorsNote?: {
    content?: string
    injectionDepth?: number
    role?: 'system' | 'user'
    enabledForNewChats?: boolean
  } | null
  hybridFts?: {
    profile?: string
    dictVariant?: string | null
  }
  postUserInjectionOrder?: {
    default?: number
    afterUserInput?: number
    presetChatDepth0?: number
  } | null
}

app.patch<{ Body: PatchUserPreferencesBody }>(
  '/api/user-preferences',
  async (request, reply) => {
    const b = request.body ?? {}
    const hasLore = b.lorebook && typeof b.lorebook === 'object'
    const hasHist = b.history && typeof b.history === 'object'
    const hasMem = b.memory && typeof b.memory === 'object'
    const hasBudgetTrim = b.budgetTrim && typeof b.budgetTrim === 'object'
    const hasEmbed = b.embeddingApi && typeof b.embeddingApi === 'object'
    const hasChunk = b.chunk && typeof b.chunk === 'object'
    const hasDefaultAuthorsNote = Object.prototype.hasOwnProperty.call(
      b,
      'defaultAuthorsNote',
    )
    const hasHybridFts = b.hybridFts && typeof b.hybridFts === 'object'
    const hasPostUserInjectionOrder = Object.prototype.hasOwnProperty.call(
      b,
      'postUserInjectionOrder',
    )
    if (
      !hasLore &&
      !hasHist &&
      !hasMem &&
      !hasBudgetTrim &&
      !hasEmbed &&
      !hasChunk &&
      !hasDefaultAuthorsNote &&
      !hasHybridFts &&
      !hasPostUserInjectionOrder
    ) {
      return reply.status(400).send({
        error: ApiErrorCodes.user_preferences_requires_section,
      })
    }
    try {
      let lorebook
      let history
      let memory
      let budgetTrim
      let embeddingApi
      let chunk
      let defaultAuthorsNote
      let hybridFts
      let postUserInjectionOrder
      if (hasLore) {
        const patch: {
          recursiveEnabled?: boolean
          maxRecursionDepth?: number
          keywordTopK?: number
          vectorEnabled?: boolean
          vectorTopK?: number
        } = {}
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'recursiveEnabled')) {
          if (typeof b.lorebook!.recursiveEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.lorebook_recursive_enabled_boolean })
          }
          patch.recursiveEnabled = b.lorebook!.recursiveEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'maxRecursionDepth')) {
          const d = b.lorebook!.maxRecursionDepth
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.lorebook_max_recursion_depth_number })
          }
          patch.maxRecursionDepth = d
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'keywordTopK')) {
          const d = b.lorebook!.keywordTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: ApiErrorCodes.lorebook_keyword_top_k_number })
          }
          patch.keywordTopK = d
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'vectorEnabled')) {
          if (typeof b.lorebook!.vectorEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.lorebook_vector_enabled_boolean })
          }
          patch.vectorEnabled = b.lorebook!.vectorEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'vectorTopK')) {
          const d = b.lorebook!.vectorTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: ApiErrorCodes.lorebook_vector_top_k_number })
          }
          patch.vectorTopK = d
        }
        if (Object.keys(patch).length === 0) {
          return reply.status(400).send({
            error: ApiErrorCodes.global_lorebook_requires_field,
          })
        }
        lorebook = await updateGlobalLorebookSettings(patch)
      }
      if (hasHist) {
        const patch: {
          limitEnabled?: boolean
          maxTurns?: number
        } = {}
        if (Object.prototype.hasOwnProperty.call(b.history, 'limitEnabled')) {
          if (typeof b.history!.limitEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.history_limit_enabled_boolean })
          }
          patch.limitEnabled = b.history!.limitEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.history, 'maxTurns')) {
          const d = b.history!.maxTurns
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: ApiErrorCodes.history_max_turns_number })
          }
          patch.maxTurns = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'limitEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'maxTurns')
        ) {
          return reply.status(400).send({
            error: ApiErrorCodes.global_history_requires_field,
          })
        }
        history = await updateGlobalHistorySettings(patch)
      }
      if (hasMem) {
        const parsed = parseMemorySettingsPatch(b.memory, 'global')
        if (!parsed.ok) {
          const code = parsed.error as keyof typeof ApiErrorCodes
          return reply
            .status(400)
            .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.memory_settings_invalid })
        }
        memory = await updateGlobalMemorySettings(parsed.patch)
      }
      if (hasBudgetTrim) {
        const parsed = parseBudgetTrimSettingsPatch(b.budgetTrim)
        if (!parsed.ok) {
          const code = parsed.error as keyof typeof ApiErrorCodes
          return reply
            .status(400)
            .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.budget_trim_settings_invalid })
        }
        budgetTrim = await updateGlobalBudgetTrimSettings(parsed.patch)
      }
      if (hasEmbed) {
        const raw = b.embeddingApi! as {
          baseUrl?: string
          apiKey?: string
          apiKeyId?: string | null
          embeddingModel?: string
          embeddingDimensions?: number | null
        }
        const patch: {
          baseUrl?: string
          apiKey?: string
          apiKeyId?: string | null
          embeddingModel?: string
          embeddingDimensions?: number | null
        } = {}
        if (Object.prototype.hasOwnProperty.call(raw, 'baseUrl')) {
          if (typeof raw.baseUrl !== 'string') {
            return reply.status(400).send({ error: ApiErrorCodes.embedding_api_base_url_string })
          }
          patch.baseUrl = raw.baseUrl
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'apiKey')) {
          if (typeof raw.apiKey !== 'string') {
            return reply.status(400).send({ error: ApiErrorCodes.embedding_api_api_key_string })
          }
          patch.apiKey = raw.apiKey
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'apiKeyId')) {
          const kid = raw.apiKeyId
          if (kid !== null && typeof kid !== 'string') {
            return reply.status(400).send({ error: ApiErrorCodes.embedding_api_api_key_id_invalid })
          }
          patch.apiKeyId = kid
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'embeddingModel')) {
          if (typeof raw.embeddingModel !== 'string') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.embedding_api_embedding_model_string })
          }
          patch.embeddingModel = raw.embeddingModel
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'embeddingDimensions')) {
          const dim = raw.embeddingDimensions
          if (dim !== null && typeof dim !== 'number') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.embedding_api_embedding_dimensions_invalid })
          }
          patch.embeddingDimensions =
            dim === null ? null : normalizeEmbeddingDimensions(dim)
        }
        if (Object.keys(patch).length === 0) {
          return reply.status(400).send({
            error: ApiErrorCodes.global_embedding_api_requires_field,
          })
        }
        embeddingApi = await updateGlobalEmbeddingApiSettings(patch)
      }
      if (hasChunk) {
        if (!Object.prototype.hasOwnProperty.call(b.chunk, 'turnsPerFile')) {
          return reply.status(400).send({
            error: ApiErrorCodes.global_chunk_requires_field,
          })
        }
        const d = b.chunk!.turnsPerFile
        if (typeof d !== 'number' || !Number.isFinite(d)) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.chunk_turns_per_file_number })
        }
        chunk = await updateGlobalChunkSettings({ turnsPerFile: d })
      }
      if (hasDefaultAuthorsNote) {
        const parsed = parseDefaultAuthorsNotePatch(b.defaultAuthorsNote)
        if (!parsed.ok) {
          const code = parsed.error as keyof typeof ApiErrorCodes
          return reply
            .status(400)
            .send({ error: ApiErrorCodes[code] ?? ApiErrorCodes.default_authors_note_invalid })
        }
        defaultAuthorsNote = await updateGlobalDefaultAuthorsNote(parsed.patch)
      }
      if (hasHybridFts) {
        const patch: Partial<HybridFtsSettings> = {}
        if (Object.prototype.hasOwnProperty.call(b.hybridFts, 'profile')) {
          const rawProfile = b.hybridFts!.profile
          const normalized = normalizeHybridFtsProfile(rawProfile)
          if (typeof rawProfile !== 'string' || normalized !== rawProfile) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.hybrid_fts_profile_invalid })
          }
          patch.profile = normalized
        }
        if (Object.prototype.hasOwnProperty.call(b.hybridFts, 'dictVariant')) {
          const rawVariant = b.hybridFts!.dictVariant
          if (rawVariant !== null && typeof rawVariant !== 'string') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.hybrid_fts_dict_variant_invalid })
          }
          if (rawVariant !== null) {
            const docForVariant = await readUserPreferencesDocument()
            const normalizedSettings = normalizeHybridFtsSettings({
              profile: patch.profile ?? docForVariant.hybridFts?.profile,
              dictVariant: rawVariant,
            })
            if (rawVariant !== normalizedSettings.dictVariant) {
              return reply
                .status(400)
                .send({ error: ApiErrorCodes.hybrid_fts_dict_variant_invalid })
            }
            patch.dictVariant = normalizedSettings.dictVariant
          } else {
            patch.dictVariant = null
          }
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'profile') &&
          !Object.prototype.hasOwnProperty.call(patch, 'dictVariant')
        ) {
          return reply.status(400).send({
            error: ApiErrorCodes.user_preferences_requires_section,
          })
        }
        hybridFts = await updateGlobalHybridFtsSettings(patch)
      }
      if (hasPostUserInjectionOrder) {
        if (b.postUserInjectionOrder === null) {
          postUserInjectionOrder = await updateGlobalPostUserInjectionOrder(null)
        } else if (
          b.postUserInjectionOrder &&
          typeof b.postUserInjectionOrder === 'object' &&
          !Array.isArray(b.postUserInjectionOrder)
        ) {
          const patch: PostUserInjectionOrderHostPatch = {}
          for (const key of POST_USER_INJECTION_ORDER_HOST_KEYS) {
            if (
              !Object.prototype.hasOwnProperty.call(b.postUserInjectionOrder, key)
            ) {
              continue
            }
            const raw = b.postUserInjectionOrder[key as PostUserInjectionOrderHostKey]
            if (typeof raw !== 'number' || !Number.isFinite(raw)) {
              return reply.status(400).send({
                error: ApiErrorCodes.post_user_injection_order_invalid,
              })
            }
            patch[key as PostUserInjectionOrderHostKey] = clampInjectionOrder(raw)
          }
          postUserInjectionOrder = await updateGlobalPostUserInjectionOrder(
            Object.keys(patch).length > 0 ? patch : null,
          )
        } else {
          return reply.status(400).send({
            error: ApiErrorCodes.post_user_injection_order_invalid,
          })
        }
      }
      const doc = await readUserPreferencesDocument()
      const embeddingPublic = embeddingApi
        ? await sanitizeEmbeddingApiForGet(embeddingApi)
        : await sanitizeEmbeddingApiForGet(
            normalizeEmbeddingApiSettings(doc.embeddingApi),
          )
      return {
        ok: true as const,
        lorebook: lorebook ?? doc.lorebook,
        history: history ?? doc.history,
        memory: memory ?? doc.memory,
        budgetTrim: budgetTrim ?? doc.budgetTrim,
        embeddingApi: embeddingPublic,
        chunk: chunk ?? doc.chunk,
        defaultAuthorsNote: defaultAuthorsNote ?? doc.defaultAuthorsNote,
        hybridFts: hybridFts ?? doc.hybridFts,
        postUserInjectionOrder:
          postUserInjectionOrder ??
          normalizePostUserInjectionOrderHostPolicy(doc.postUserInjectionOrder),
        savedAt: doc.savedAt,
      }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.user_preferences_save_failed })
    }
  },
)

interface EmbeddingTestBody {
  text?: string
  embeddingApi?: {
    baseUrl?: string
    apiKey?: string
    apiKeyId?: string | null
    embeddingModel?: string
  }
}

app.post<{ Body: EmbeddingTestBody }>(
  '/api/embedding/test',
  async (request, reply) => {
    try {
      const b = request.body ?? {}
      const text =
        typeof b.text === 'string' && b.text.trim()
          ? b.text.trim()
          : '这是一句用于测试 embedding 的短句。'
      const { resolveEmbeddingApiCredentialsFrom } = await import(
        './embedding-credential-resolve.js'
      )
      const { createEmbeddingWithCredentials, buildEmbeddingRequestUrl } =
        await import('./embedding-client.js')
      const creds = await resolveEmbeddingApiCredentialsFrom(
        b.embeddingApi && typeof b.embeddingApi === 'object'
          ? b.embeddingApi
          : undefined,
      )
      const result = await createEmbeddingWithCredentials(creds, text)
      if ('error' in result) {
        return reply.status(502).send({
          ok: false as const,
          error: result.error,
          status: result.status,
          detail: result.detail,
          requestUrl: buildEmbeddingRequestUrl(creds.baseUrl),
        })
      }
      return {
        ok: true as const,
        model: result.model,
        dimensions: result.vector.length,
        inputText: text,
        requestUrl: buildEmbeddingRequestUrl(creds.baseUrl),
        vector: result.vector,
      }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ ok: false, error: ApiErrorCodes.embedding_test_failed })
    }
  },
)

app.get('/api/build-info', async () => readBuildInfoDocument())

app.get('/api/settings', async (_request, reply) => {
  try {
    const data = await readApiSettingsFromFile()
    if (!data) return null
    return await sanitizeApiSettingsDocumentForGet(data)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.settings_read_failed })
  }
})

type SettingsPutBody = ApiSettingsPutBody

app.put<{ Body: SettingsPutBody }>('/api/settings', async (request, reply) => {
  const b = request.body
  if (!b || typeof b !== 'object') {
    return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
  }
  if (!Array.isArray(b.presets)) {
    return reply.status(400).send({ error: ApiErrorCodes.missing_presets_array })
  }
  const activePresetId =
    typeof b.activePresetId === 'string' ? b.activePresetId : ''
  if (!(b.presets as ApiPreset[]).some((p) => p.id === activePresetId)) {
    return reply.status(400).send({ error: ApiErrorCodes.active_preset_id_mismatch })
  }

  let doc: ApiSettingsDocument
  try {
    doc = await mergeApiSettingsPut({
      activePresetId,
      presets: b.presets,
    })
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.preset_validation_failed,
    })
  }

  try {
    await writeApiSettingsToFile(doc)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.settings_write_failed })
  }

  return { ok: true as const, savedAt: doc.savedAt }
})

app.post<{ Params: { id: string }; Body: { baseUrl?: string; model?: string } }>(
  '/api/settings/presets/:id/test',
  async (request, reply) => {
    const presetId = request.params.id?.trim() ?? ''
    if (!presetId) {
      return reply.status(400).send({ ok: false, error: ApiErrorCodes.invalid_id })
    }
    const body = request.body ?? {}
    const baseUrl =
      typeof body.baseUrl === 'string' ? body.baseUrl : undefined
    const model = typeof body.model === 'string' ? body.model : undefined
    try {
      const result = await testApiPresetConnectivity({
        apiPresetId: presetId,
        baseUrl,
        model,
      })
      if (!result.ok) {
        const status =
          result.error === 'missing_api_key' ||
          result.error === 'api_credential_not_configured' ||
          result.error === 'missing_model' ||
          result.error === 'invalid_id'
            ? 400
            : 502
        return reply.status(status).send(result)
      }
      return result
    } catch (e) {
      app.log.error(e)
      return reply
        .status(500)
        .send({ ok: false, error: ApiErrorCodes.api_preset_test_failed })
    }
  },
)

app.get<{ Params: { id: string } }>(
  '/api/settings/presets/:id/references',
  async (request, reply) => {
    const presetId = request.params.id?.trim() ?? ''
    if (!presetId) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    try {
      const settings = await readApiSettingsFromFile()
      if (!settings?.presets.some((p) => p.id === presetId)) {
        return reply.status(404).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      const references = await findApiPresetReferences(presetId)
      return { references }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.settings_read_failed })
    }
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/settings/presets/:id',
  async (request, reply) => {
    const presetId = request.params.id?.trim() ?? ''
    if (!presetId) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    try {
      const { activePresetId } = await deleteApiPresetFromFile(presetId)
      return { ok: true as const, activePresetId }
    } catch (e) {
      if (e instanceof ApiConfigInUseError) {
        const status =
          e.code === 'api_preset_not_found'
            ? 404
            : e.code === 'api_preset_last_one'
              ? 400
              : 409
        return reply.status(status).send({
          error: e.code,
          references: e.references,
        })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.settings_write_failed })
    }
  },
)

app.get('/api/prompts', async (_request, reply) => {
  try {
    const data = await readPromptsIndexDocument()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.prompts_read_failed })
  }
})

app.get<{ Params: { presetId: string } }>(
  '/api/prompts/:presetId',
  async (request, reply) => {
    const presetId = request.params.presetId?.trim() ?? ''
    if (!isValidPromptPresetId(presetId)) {
      return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
    }
    try {
      const preset = await readPromptPresetById(presetId)
      if (!preset) {
        return reply.status(404).send({ error: ApiErrorCodes.prompts_preset_not_found })
      }
      return normalizePresetForAssemble(preset as PromptPreset)
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_read_failed })
    }
  },
)

app.put<{ Params: { presetId: string } }>(
  '/api/prompts/:presetId',
  async (request, reply) => {
    const presetId = request.params.presetId?.trim() ?? ''
    if (!isValidPromptPresetId(presetId)) {
      return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
    }
    let body: Record<string, unknown>
    try {
      body = assertValidPromptPresetBody(request.body)
    } catch {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    if (body.id !== presetId) {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    try {
      const savedAt = await writePromptPreset(body)
      return { ok: true as const, savedAt }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
    }
  },
)

app.patch('/api/prompts', async (request, reply) => {
  const b = request.body
  if (!b || typeof b !== 'object') {
    return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
  }
  const raw = b as {
    activePresetId?: unknown
    presets?: unknown
  }
  const patch: {
    activePresetId?: string
    presets?: { id: string; name: string; updatedAt: string }[]
  } = {}
  if (Object.prototype.hasOwnProperty.call(raw, 'activePresetId')) {
    if (typeof raw.activePresetId !== 'string' || !raw.activePresetId) {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    if (!isValidPromptPresetId(raw.activePresetId)) {
      return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
    }
    patch.activePresetId = raw.activePresetId
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'presets')) {
    if (!Array.isArray(raw.presets)) {
      return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
    }
    const presets: { id: string; name: string; updatedAt: string }[] = []
    for (const item of raw.presets) {
      if (!item || typeof item !== 'object') {
        return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
      }
      const o = item as { id?: unknown; name?: unknown; updatedAt?: unknown }
      if (typeof o.id !== 'string' || !isValidPromptPresetId(o.id)) {
        return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
      }
      presets.push({
        id: o.id,
        name: typeof o.name === 'string' ? o.name : '',
        updatedAt:
          typeof o.updatedAt === 'string'
            ? o.updatedAt
            : new Date().toISOString(),
      })
    }
    patch.presets = presets
  }
  if (patch.activePresetId === undefined && patch.presets === undefined) {
    return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
  }
  try {
    const savedAt = await patchPromptsIndex(patch)
    return { ok: true as const, savedAt }
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
  }
})

app.delete<{ Params: { presetId: string } }>(
  '/api/prompts/:presetId',
  async (request, reply) => {
    const presetId = request.params.presetId?.trim() ?? ''
    if (!isValidPromptPresetId(presetId)) {
      return reply.status(400).send({ error: ApiErrorCodes.prompt_preset_id_invalid })
    }
    try {
      await deletePromptPreset(presetId)
      return { ok: true as const }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('至少保留')) {
        return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
    }
  },
)

app.put('/api/prompts', async (request, reply) => {
  let validated: { activePresetId: string; presets: unknown[] }
  try {
    validated = assertValidPromptsPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.prompts_validation_failed,
    })
  }
  if (isPromptsSeedPut(validated)) {
    return reply.status(400).send({
      error: ApiErrorCodes.prompts_seed_put_rejected,
    })
  }
  const savedAt = new Date().toISOString()
  const doc: PromptsDocument = {
    version: 3,
    savedAt,
    activePresetId: validated.activePresetId,
    presets: validated.presets,
  }
  try {
    await writePromptsDocument(doc)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.prompts_write_failed })
  }
  return { ok: true as const, savedAt }
})

app.post<{ Body: PromptsAssemblePreviewBody }>(
  '/api/prompts/assemble-preview',
  async (request, reply) => {
    try {
      const doc = await readPromptsDocument()
      if (!doc) {
        return reply.status(500).send({ error: ApiErrorCodes.prompts_unavailable })
      }
      const result = runPromptsAssemblePreview(doc, request.body ?? {})
      if ('error' in result) {
        return reply.status(400).send({ error: result.error })
      }
      return result
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.prompts_preview_failed })
    }
  },
)

app.post('/api/prompts/convert-st', async (request, reply) => {
  const body = request.body
  if (!body || typeof body !== 'object') {
    return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
  }
  const raw = body as {
    source?: unknown
    presetName?: unknown
    characterOrderId?: unknown
    prompts?: unknown
    prompt_order?: unknown
  }
  const stSource =
    raw.source != null && isStOpenAiPreset(raw.source) ? raw.source : body
  if (!isStOpenAiPreset(stSource)) {
    return reply.status(400).send({ error: ApiErrorCodes.prompts_validation_failed })
  }
  try {
    const characterOrderId =
      typeof raw.characterOrderId === 'number' &&
      Number.isFinite(raw.characterOrderId)
        ? raw.characterOrderId
        : undefined
    const presetName =
      typeof raw.presetName === 'string' ? raw.presetName.trim() : undefined
    const preset = convertStPresetToArousalPub(stSource, {
      characterOrderId,
      presetName,
    })
    assertValidPromptPresetBody(preset)
    return { preset }
  } catch (e) {
    if (
      e instanceof StPresetValidationError ||
      (e instanceof Error &&
        e.message.includes('ST preset missing prompt_order'))
    ) {
      return reply.status(400).send({
        error: ApiErrorCodes.prompts_validation_failed,
      })
    }
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.prompts_st_convert_failed })
  }
})

app.get('/api/lorebooks', async (_request, reply) => {
  try {
    const data = await readLorebooksDocument()
    return (
      data ?? {
        schemaVersion: 1,
        savedAt: '',
        lorebooks: [],
      }
    )
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
  }
})

app.get('/api/lorebooks/summary', async (_request, reply) => {
  try {
    const lorebooks = await readLorebooksIndexSummary()
    return { lorebooks }
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
  }
})

app.put('/api/lorebooks', async (request, reply) => {
  const contentLength = Number(request.headers['content-length'])
  if (
    Number.isFinite(contentLength) &&
    contentLength > LOREBOOKS_BULK_PUT_MAX_JSON_BYTES
  ) {
    return reply.status(413).send({
      error: ApiErrorCodes.lorebooks_bulk_put_payload_too_large,
    })
  }
  if (!tryAcquireLorebooksBulkPutSlot(getCurrentUserId())) {
    return reply.status(429).send({
      error: ApiErrorCodes.lorebooks_bulk_put_rate_limited,
    })
  }
  let validated: { lorebooks: LorebooksDocument['lorebooks'] }
  try {
    validated = assertValidLorebooksPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.lorebooks_validation_failed,
    })
  }
  const savedAt = new Date().toISOString()
  const doc: LorebooksDocument = {
    schemaVersion: 1,
    savedAt,
    lorebooks: validated.lorebooks,
  }
  try {
    await writeLorebooksDocument(doc)
    scheduleLorebookVectorReindex(validated.lorebooks)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.lorebooks_write_failed })
  }
  return { ok: true as const, savedAt }
})

async function drainReadableStream(
  stream: NodeJS.ReadableStream,
): Promise<void> {
  for await (const chunk of stream) {
    void chunk
  }
}

app.post('/api/lorebooks/import-st/preview', async (request, reply) => {
  const ct = request.headers['content-type'] ?? ''
  let source: unknown
  if (ct.includes('multipart/form-data')) {
    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
    }
    const buf = await file.toBuffer()
    if (!buf.length) {
      return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
    }
    try {
      source = JSON.parse(buf.toString('utf8')) as unknown
    } catch {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
  } else {
    const body = request.body
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
    }
    const raw = body as { source?: unknown }
    source = raw.source != null ? raw.source : body
  }
  if (!isStLorebookJson(source)) {
    return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
  }
  try {
    const preview = previewStLorebookImport(source)
    if (preview.entryCount > ST_LOREBOOK_IMPORT_MAX_ENTRIES) {
      return reply.status(400).send({
        error: ApiErrorCodes.st_lorebook_too_many_entries,
      })
    }
    return preview
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.st_lorebook_import_failed })
  }
})

app.post('/api/lorebooks/import-st', async (request, reply) => {
  const body = request.body
  if (!body || typeof body !== 'object') {
    return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
  }
  const raw = body as { source?: unknown; name?: unknown }
  const source = raw.source != null ? raw.source : body
  if (!isStLorebookJson(source)) {
    return reply.status(400).send({ error: ApiErrorCodes.st_import_invalid_format })
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : undefined
  try {
    const lorebook = await convertStLorebookToLorebook(source, { name })
    await writeLorebook(lorebook)
    scheduleLorebookVectorReindex([lorebook])
    return { ok: true as const, id: lorebook.id, name: lorebook.name }
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.st_lorebook_import_failed })
  }
})

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

app.get<{ Params: { id: string } }>(
  '/api/lorebooks/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!LOREBOOK_ID_RE.test(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    try {
      const lb = await readLorebookById(id)
      if (!lb) return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
      return lb
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
    }
  },
)

app.get('/api/characters', async (request, reply) => {
  const q = request.query as Record<string, string | undefined>
  const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0)
  const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '24', 10) || 24))
  const search = typeof q.search === 'string' ? q.search : ''
  const rawF = q.filter
  const filter =
    rawF === 'used' || rawF === 'unused' ? rawF : ('all' as const)
  const sort = parseCharacterListSort(q.sort)
  const order = parseCharacterListSortOrder(q.order)
  const kind = parseCharacterListKind(q.kind)
  try {
    const { items, total, filterCounts } = await listCharacterSummaries({
      offset,
      limit,
      search,
      filter,
      kind,
      sort,
      order,
    })
    const hasMore = offset + items.length < total
    return { items, total, filterCounts, offset, limit, hasMore }
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.characters_read_failed })
  }
})

app.post('/api/characters/import', async (request, reply) => {
  try {
    const card = normalizeImportCard(request.body)
    const doc = await importCharacterCard(card)
    return { ok: true as const, id: doc.id }
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.character_import_failed,
    })
  }
})

app.post('/api/characters/import-png', async (request, reply) => {
  try {
    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ error: ApiErrorCodes.missing_file_field })
    }
    const buf = await file.toBuffer()
    const doc = await importCharacterCardPng(buf)
    return { ok: true as const, id: doc.id }
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.character_import_png_failed,
    })
  }
})

app.post('/api/characters', async (request, reply) => {
  const ct = request.headers['content-type'] ?? ''
  if (ct.includes('multipart/form-data')) {
    try {
      let portraitBuf: Buffer | undefined
      let payload = ''
      const parts = request.parts()
      for await (const part of parts) {
        if (part.fieldname === 'portrait' && 'toBuffer' in part) {
          portraitBuf = await part.toBuffer()
        } else if (part.fieldname === 'payload') {
          const v = (part as { value?: unknown }).value
          payload = typeof v === 'string' ? v : ''
        }
      }
      if (!payload.trim()) {
        return reply.status(400).send({ error: ApiErrorCodes.multipart_payload_required })
      }
      let body: unknown
      try {
        body = JSON.parse(payload) as unknown
      } catch {
        return reply.status(400).send({ error: ApiErrorCodes.payload_invalid_json })
      }
      const card = cardFromNewCharacterForm(body)
      const isUser = parseIsUserFromBody(body)
      const doc = await importCharacterCardWithPortrait(card, portraitBuf, {
        isUser: isUser === true,
      })
      return { ok: true as const, id: doc.id }
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.character_create_failed,
      })
    }
  }
  try {
    const card = cardFromNewCharacterForm(request.body)
    const isUser = parseIsUserFromBody(request.body)
    const doc = await importCharacterCardWithPortrait(card, null, {
      isUser: isUser === true,
    })
    return { ok: true as const, id: doc.id }
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.character_create_failed,
    })
  }
})

app.get<{
  Params: { token: string }
  Querystring: { size?: string; v?: string }
}>(
  '/api/i/:token',
  async (request, reply) => {
    const result = await resolvePortraitImageResponse(
      request.params.token,
      request.query.size,
    )
    if (!result.ok) {
      if (result.reason === 'invalid_size') {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
      }
      return reply.status(404).send({
        error: ApiErrorCodes.character_not_found_or_no_png,
      })
    }
    const ifNoneMatch = request.headers['if-none-match']
    if (ifNoneMatch === result.etag) {
      return reply.status(304).send()
    }
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', portraitImageCacheControl(request.query.size))
      .header('ETag', result.etag)
      .send(result.body)
  },
)

app.get<{ Params: { id: string } }>(
  '/api/characters/:id/export-png',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const doc = await readCharacterDocument(id)
    if (!doc) {
      return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
    }
    const buf = await readCharacterPngBuffer(id)
    if (!buf) {
      return reply.status(404).send({ error: ApiErrorCodes.character_not_found_or_no_png })
    }
    const filename = buildCharacterExportFilename(doc.card, id, 'png')
    return reply
      .header('Content-Type', 'image/png')
      .header('Content-Disposition', contentDispositionAttachment(filename))
      .header('Cache-Control', 'private, no-store')
      .send(buf)
  },
)

app.get<{ Params: { id: string } }>(
  '/api/characters/:id/export-json',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const doc = await readCharacterDocument(id)
    if (!doc) {
      return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
    }
    const payload = buildStV2CharacterExport(doc.card)
    const filename = buildCharacterExportFilename(doc.card, id, 'json')
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', contentDispositionAttachment(filename))
      .header('Cache-Control', 'private, no-store')
      .send(JSON.stringify(payload, null, 2))
  },
)

app.post<{ Params: { id: string } }>(
  '/api/characters/:id/portrait',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    try {
      const file = await request.file()
      if (!file) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.missing_portrait_field })
      }
      const buf = await file.toBuffer()
      if (!isPngBuffer(buf)) {
        return reply.status(400).send({ error: ApiErrorCodes.png_image_required })
      }
      const updated = await updateCharacterPortrait(id, buf)
      if (!updated) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      const doc = await readCharacterDocumentForApi(id)
      if (!doc) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      return doc
    } catch (e) {
      app.log.error(e)
      return reply.status(400).send({
        error: ApiErrorCodes.portrait_upload_failed,
      })
    }
  },
)

app.patch<{ Params: { id: string }; Body: { card?: unknown; isUser?: unknown } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const body = request.body as { card?: unknown; isUser?: unknown }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .status(400)
        .send({ error: ApiErrorCodes.card_body_invalid })
    }
    const hasCard =
      body.card &&
      typeof body.card === 'object' &&
      !Array.isArray(body.card)
    const isUser =
      typeof body.isUser === 'boolean' ? body.isUser : undefined
    if (!hasCard && typeof isUser !== 'boolean') {
      return reply
        .status(400)
        .send({ error: ApiErrorCodes.card_body_invalid })
    }
    try {
      const doc = await patchCharacterDocument(id, {
        ...(hasCard
          ? { card: body.card as Record<string, unknown> }
          : {}),
        ...(typeof isUser === 'boolean' ? { isUser } : {}),
      })
      if (!doc) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
      return doc
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.character_update_failed })
    }
  },
)

app.get<{ Params: { id: string } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const doc = await readCharacterDocumentForApi(id)
    if (!doc) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
    return doc
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const ok = await deleteCharacterFile(id)
    if (!ok) return reply.status(404).send({ error: ApiErrorCodes.character_not_found })
    return { ok: true as const }
  },
)

app.get('/api/api-keys', async (_request, reply) => {
  try {
    const data = await readApiKeysDocument()
    if (!data) return null
    return sanitizeApiKeysDocumentForGet(data)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.api_keys_read_failed })
  }
})

app.put('/api/api-keys', async (request, reply) => {
  let validated: { keys: ReturnType<typeof parseApiKeysPutPayload>['keys'] }
  try {
    validated = parseApiKeysPutPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.api_keys_validation_failed,
    })
  }
  let mergedKeys: ApiKeysDocument['keys']
  try {
    const existing = await readApiKeysDocument()
    const incomingIds = new Set(validated.keys.map((k) => k.id))
    await assertRemovedApiKeysNotInUse(incomingIds, existing?.keys ?? [])
    mergedKeys = await mergeApiKeysPutPayload(validated.keys)
  } catch (e) {
    if (e instanceof ApiConfigInUseError) {
      return reply.status(409).send({
        error: e.code,
        references: e.references,
      })
    }
    return reply.status(400).send({
      error: ApiErrorCodes.api_keys_validation_failed,
    })
  }
  const savedAt = new Date().toISOString()
  const doc: ApiKeysDocument = {
    version: 1,
    savedAt,
    keys: mergedKeys,
  }
  try {
    await writeApiKeysDocument(doc)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.api_keys_write_failed })
  }
  return { ok: true as const, savedAt }
})

app.get<{ Params: { id: string } }>(
  '/api/api-keys/:id/references',
  async (request, reply) => {
    const keyId = request.params.id?.trim() ?? ''
    if (!keyId) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    try {
      const doc = await readApiKeysDocument()
      if (!doc?.keys.some((k) => k.id === keyId)) {
        return reply.status(404).send({ error: ApiErrorCodes.api_key_not_found })
      }
      const references = await findApiKeyReferences(keyId)
      return { references }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.api_keys_read_failed })
    }
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/api-keys/:id',
  async (request, reply) => {
    const keyId = request.params.id?.trim() ?? ''
    if (!keyId) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    try {
      await deleteApiKeyFromFile(keyId)
      return { ok: true as const }
    } catch (e) {
      if (e instanceof ApiConfigInUseError) {
        const status = e.code === 'api_key_not_found' ? 404 : 409
        return reply.status(status).send({
          error: e.code,
          references: e.references,
        })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.api_keys_write_failed })
    }
  },
)

app.post<{ Params: { id: string }; Body: { password?: string } }>(
  '/api/api-keys/:id/reveal',
  async (request, reply) => {
    if (!tryAcquireAuthRateLimitSlot('api_key_reveal', request.ip)) {
      return reply.status(429).send({ error: ApiErrorCodes.auth_rate_limited })
    }
    const keyId = request.params.id?.trim()
    if (!keyId) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const password = request.body?.password
    if (typeof password !== 'string' || !password) {
      return reply.status(400).send({ error: ApiErrorCodes.missing_password_fields })
    }
    try {
      const userId = getCurrentUserId()
      const doc = await readUsersIndex()
      const user = findUserById(doc, userId)
      if (!user) {
        return reply.status(401).send({ error: ApiErrorCodes.invalid_user })
      }
      const ok = await verifyPassword(password, user.passwordHash)
      if (!ok) {
        return reply.status(403).send({
          error: ApiErrorCodes.api_key_reveal_wrong_password,
        })
      }
      const keysDoc = await readApiKeysDocument()
      const hit = keysDoc?.keys.find((k) => k.id === keyId)
      if (!hit) {
        return reply.status(404).send({ error: ApiErrorCodes.api_key_not_found })
      }
      return { key: hit.key }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.api_key_reveal_failed })
    }
  },
)

app.post<{ Body: ModelsListBody }>('/api/models', async (request, reply) => {
  const b = request.body ?? ({} as ModelsListBody)
  let apiKey: string
  let baseUrl: string
  try {
    const creds = await resolveChatCredentials({
      apiPresetId: b.apiPresetId,
      apiKeyId: b.apiKeyId,
      baseUrl: b.baseUrl,
    })
    apiKey = creds.apiKey
    baseUrl = creds.baseUrl
  } catch (e) {
    if (e instanceof ApiCredentialError) {
      return reply.status(400).send({ error: e.code })
    }
    throw e
  }
  const result = await fetchUpstreamModelsList({ baseUrl, apiKey })
  if (!result.ok) {
    request.log.warn(
      { status: result.status, body: result.detail?.slice(0, 400) },
      'models list upstream error',
    )
    return reply.status(502).send({
      error: ApiErrorCodes.models_list_failed,
      status: result.status,
      detail: result.detail,
    })
  }
  return { models: result.models }
})

app.get('/api/plugins/registry', async (request, reply) => {
  try {
    const plugins = await listPublicPluginRegistry()
    return { plugins }
  } catch (e) {
    app.log.error(e)
    return reply
      .status(500)
      .send({ error: ApiErrorCodes.plugin_registry_read_failed })
  }
})

app.get('/api/plugins/manage', async (_request, reply) => {
  const plugins = await listPluginsManage()
  return { plugins }
})

app.put<{ Body: { plugins?: Array<{ id: string; enabled?: boolean; order?: number }> } }>(
  '/api/plugins/registry',
  async (request, reply) => {
    const body = request.body ?? {}
    const raw = body.plugins
    if (!Array.isArray(raw)) {
      return reply.status(400).send({ error: 'invalid_body' })
    }
    try {
      const doc = await savePluginRegistry({
        version: 1,
        plugins: raw.map((p, i) => ({
          id: String(p.id ?? '').trim(),
          enabled: p.enabled !== false,
          order:
            typeof p.order === 'number' && Number.isFinite(p.order)
              ? Math.round(p.order)
              : (i + 1) * 10,
        })),
      })
      return { plugins: doc.plugins }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg === 'invalid_plugin_id' || msg === 'plugin_registry_manifest_mismatch') {
        return reply.status(400).send({ error: ApiErrorCodes.plugin_registry_invalid })
      }
      throw e
    }
  },
)

app.get<{ Params: { pluginId: string } }>(
  '/api/plugins/:pluginId/settings',
  async (request, reply) => {
    const settings = await readMergedPluginUserSettings(request.params.pluginId)
    return { settings }
  },
)

app.put<{ Params: { pluginId: string }; Body: Record<string, unknown> }>(
  '/api/plugins/:pluginId/settings',
  async (request, reply) => {
    try {
      const settings = await writePluginUserSettings(
        request.params.pluginId,
        request.body ?? {},
      )
      return { settings }
    } catch (e) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: string }).code === 'plugin_settings_invalid'
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.plugin_settings_invalid })
      }
      return reply.status(404).send({ error: 'not_found' })
    }
  },
)

app.get<{ Params: { pluginId: string } }>(
  '/api/plugins/:pluginId/lorebooks',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    try {
      const lorebooks = await readLorebooksIndexSummary()
      return { lorebooks }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
    }
  },
)

app.post<{
  Params: { pluginId: string }
  Body: { conversationId?: string; nameTemplate?: string }
}>(
  '/api/plugins/:pluginId/lorebooks/ensure',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const writeAuth = await assertPluginRoutePermission(pluginId, 'lorebook.write')
    if (!writeAuth.ok) {
      return reply.status(writeAuth.status).send({ error: ApiErrorCodes[writeAuth.code] })
    }
    const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!readAuth.ok) {
      return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
    }
    const body = request.body ?? {}
    const conversationId =
      typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
    if (!conversationId || !isValidConversationId(conversationId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const nameTemplate =
      typeof body.nameTemplate === 'string' ? body.nameTemplate : undefined
    try {
      const result = await ensurePluginLorebook({ conversationId, nameTemplate })
      if (!result) {
        return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      }
      return {
        ok: true as const,
        id: result.id,
        name: result.name,
        created: result.created,
        lorebook: result.lorebook,
      }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_write_failed })
    }
  },
)

app.get<{ Params: { pluginId: string; lorebookId: string } }>(
  '/api/plugins/:pluginId/lorebooks/:lorebookId',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const lorebookId = request.params.lorebookId
    if (!LOREBOOK_ID_RE.test(lorebookId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    try {
      const lb = await readLorebookById(lorebookId)
      if (!lb) return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
      return lb
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebooks_read_failed })
    }
  },
)

app.post<{
  Params: { pluginId: string; lorebookId: string }
  Body: Record<string, unknown>
}>(
  '/api/plugins/:pluginId/lorebooks/:lorebookId/entries',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const lorebookId = request.params.lorebookId
    if (!LOREBOOK_ID_RE.test(lorebookId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    try {
      const result = await createLorebookEntry(lorebookId, {
        groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
        title: typeof body.title === 'string' ? body.title : '',
        content: typeof body.content === 'string' ? body.content : '',
        keys: Array.isArray(body.keys) ? (body.keys as string[]) : undefined,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        constant: typeof body.constant === 'boolean' ? body.constant : undefined,
        triggerMode:
          body.triggerMode === 'keyword' ||
          body.triggerMode === 'constant' ||
          body.triggerMode === 'vector'
            ? body.triggerMode
            : undefined,
        priority:
          typeof body.priority === 'number' ? body.priority : undefined,
        order: typeof body.order === 'number' ? body.order : undefined,
      })
      if (!result) {
        return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
      }
      scheduleLorebookVectorReindex([result.lorebook])
      return { ok: true as const, entry: result.entry, savedAt: result.savedAt }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      app.log.error(e)
      if (msg.includes('title')) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.lorebook_entry_validation_failed })
      }
      return reply.status(500).send({ error: ApiErrorCodes.lorebook_entry_create_failed })
    }
  },
)

app.post<{
  Params: { pluginId: string; lorebookId: string }
  Body: { entries?: unknown }
}>(
  '/api/plugins/:pluginId/lorebooks/:lorebookId/entries/batch',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const lorebookId = request.params.lorebookId
    if (!LOREBOOK_ID_RE.test(lorebookId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const raw = request.body?.entries
    if (!Array.isArray(raw) || raw.length === 0) {
      return reply.status(400).send({ error: ApiErrorCodes.lorebook_entry_validation_failed })
    }
    if (raw.length > CONVERSATION_BATCH_MAX_TURNS) {
      return reply.status(400).send({ error: ApiErrorCodes.range_too_large })
    }
    const bodies: LorebookEntryCreateBody[] = raw.map((item) => {
      const body = (item ?? {}) as Record<string, unknown>
      return {
        groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
        title: typeof body.title === 'string' ? body.title : '',
        content: typeof body.content === 'string' ? body.content : '',
        keys: Array.isArray(body.keys) ? (body.keys as string[]) : undefined,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        constant: typeof body.constant === 'boolean' ? body.constant : undefined,
        triggerMode:
          body.triggerMode === 'keyword' ||
          body.triggerMode === 'constant' ||
          body.triggerMode === 'vector'
            ? body.triggerMode
            : undefined,
        priority:
          typeof body.priority === 'number' ? body.priority : undefined,
        order: typeof body.order === 'number' ? body.order : undefined,
      }
    })
    try {
      const result = await createLorebookEntriesBatch(lorebookId, bodies)
      if (!result) {
        return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
      }
      scheduleLorebookVectorReindex([result.lorebook])
      return {
        ok: true as const,
        entries: result.entries,
        savedAt: result.savedAt,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      app.log.error(e)
      if (msg.includes('title')) {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.lorebook_entry_validation_failed })
      }
      return reply.status(500).send({ error: ApiErrorCodes.lorebook_entry_create_failed })
    }
  },
)

app.patch<{
  Params: { pluginId: string; lorebookId: string; entryId: string }
  Body: Record<string, unknown>
}>(
  '/api/plugins/:pluginId/lorebooks/:lorebookId/entries/:entryId',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const lorebookId = request.params.lorebookId
    const entryId = request.params.entryId
    if (!LOREBOOK_ID_RE.test(lorebookId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    if (!LOREBOOK_ENTRY_ID_RE.test(entryId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    try {
      const result = await patchLorebookEntry(lorebookId, entryId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        content: typeof body.content === 'string' ? body.content : undefined,
        keys: Array.isArray(body.keys) ? (body.keys as string[]) : undefined,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        constant: typeof body.constant === 'boolean' ? body.constant : undefined,
        triggerMode:
          body.triggerMode === 'keyword' ||
          body.triggerMode === 'constant' ||
          body.triggerMode === 'vector'
            ? body.triggerMode
            : undefined,
        priority:
          typeof body.priority === 'number' ? body.priority : undefined,
        order: typeof body.order === 'number' ? body.order : undefined,
        groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
      })
      if (!result) {
        return reply.status(404).send({ error: ApiErrorCodes.lorebook_entry_not_found })
      }
      scheduleLorebookVectorReindex([result.lorebook])
      return { ok: true as const, entry: result.entry, savedAt: result.savedAt }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.lorebook_entry_patch_failed })
    }
  },
)

app.post<{
  Params: { pluginId: string }
  Body: {
    conversationId?: string
    apiConfigId?: string
    messages?: { role: string; content: string }[]
    modelOverride?: string
    stream?: boolean
    responseFormat?: string
  }
}>(
  '/api/plugins/:pluginId/complete',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const auth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    let apiConfigId =
      typeof body.apiConfigId === 'string' ? body.apiConfigId.trim() : ''
    let modelOverride =
      typeof body.modelOverride === 'string' ? body.modelOverride : undefined
    if (!apiConfigId) {
      const hit = await resolvePluginCompleteApi({
        pluginId,
        conversationId:
          typeof body.conversationId === 'string'
            ? body.conversationId.trim()
            : undefined,
        apiConfigId: undefined,
      })
      if (!hit.ok) {
        return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      apiConfigId = hit.resolved.apiConfigId
      if (!modelOverride && hit.resolved.modelOverride) {
        modelOverride = hit.resolved.modelOverride
      }
    }
    const result = await runPluginComplete({
      apiConfigId,
      messages: Array.isArray(body.messages)
        ? (body.messages as { role: 'system' | 'user' | 'assistant'; content: string }[])
        : [],
      modelOverride,
      stream: body.stream === true,
      responseFormat:
        body.responseFormat === 'json_object' || body.responseFormat === 'text'
          ? body.responseFormat
          : undefined,
    })
    if (!result.ok) {
      if (result.code === 'upstream_error') {
        return reply.status(502).send({
          error: ApiErrorCodes.upstream_api_error,
          status: result.status,
          detail: result.detail,
        })
      }
      if (result.code === 'messages_empty') {
        return reply.status(400).send({ error: ApiErrorCodes.messages_required_nonempty })
      }
      if (result.code === 'messages_invalid') {
        return reply.status(400).send({ error: ApiErrorCodes.messages_item_role_content })
      }
      if (result.code === 'stream_not_supported') {
        return reply
          .status(400)
          .send({ error: ApiErrorCodes.plugin_complete_stream_not_supported })
      }
      if (
        result.code === 'api_config_not_found' ||
        result.code === 'api_credential_not_configured' ||
        result.code === 'missing_model'
      ) {
        const code = result.code as keyof typeof ApiErrorCodes
        return reply.status(400).send({ error: ApiErrorCodes[code] })
      }
      if (result.code === 'upstream_non_json' || result.code === 'upstream_empty_content') {
        return reply.status(502).send({
          error: ApiErrorCodes.upstream_non_json,
          detail: result.detail,
        })
      }
      return reply.status(502).send({
        error: ApiErrorCodes.plugin_complete_failed,
        detail: result.detail,
      })
    }
    return {
      ok: true as const,
      content: result.content,
      usage: result.usage,
      latencyMs: result.latencyMs,
    }
  },
)

app.post<{
  Params: { pluginId: string }
  Body: {
    conversationId?: string
    apiConfigId?: string
    messages?: { role: string; content: string }[]
  }
}>(
  '/api/plugins/:pluginId/complete/preflight',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const auth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    let apiConfigId =
      typeof body.apiConfigId === 'string' ? body.apiConfigId.trim() : ''
    if (!apiConfigId) {
      const hit = await resolvePluginCompleteApi({
        pluginId,
        conversationId:
          typeof body.conversationId === 'string'
            ? body.conversationId.trim()
            : undefined,
      })
      if (!hit.ok) {
        return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      apiConfigId = hit.resolved.apiConfigId
    }
    const result = await runPluginCompletePreflight({
      apiConfigId,
      messages: Array.isArray(body.messages)
        ? (body.messages as { role: 'system' | 'user' | 'assistant'; content: string }[])
        : [],
    })
    if (result.code === 'messages_empty') {
      return reply.status(400).send({ error: ApiErrorCodes.messages_required_nonempty })
    }
    if (result.code === 'messages_invalid') {
      return reply.status(400).send({ error: ApiErrorCodes.messages_item_role_content })
    }
    if (result.code === 'api_config_not_found') {
      return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
    }
    if (result.code === 'context_length_unconfigured') {
      return reply.status(400).send({
        error: ApiErrorCodes.plugin_complete_context_length_unconfigured,
        promptTokens: result.promptTokens,
      })
    }
    return {
      ok: result.ok,
      promptTokens: result.promptTokens,
      budget: result.budget,
      contextLength: result.contextLength,
      outputReserve: result.outputReserve,
      model: result.model,
      encoding: result.encoding,
      code: result.code,
    }
  },
)

app.post<{
  Params: { pluginId: string }
  Body: {
    conversationId?: string
    blocks?: unknown[]
  }
}>(
  '/api/plugins/:pluginId/prepare-context',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!readAuth.ok) {
      return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
    }
    const body = request.body ?? {}
    const blockSpecs = parseContextBlockSpecs(body.blocks)
    if (blockSpecs.length === 0) {
      return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
    }
    if (contextBlockSpecsNeedLorebookRead(blockSpecs)) {
      const loreAuth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
      if (!loreAuth.ok) {
        return reply.status(loreAuth.status).send({ error: ApiErrorCodes[loreAuth.code] })
      }
    }

    const conversationId =
      typeof body.conversationId === 'string' ? body.conversationId : ''
    const blockResult = await runPluginContextBlocksResolve({
      conversationId,
      blocks: blockSpecs,
    })
    if (!blockResult.ok) {
      if (blockResult.code === 'conversation_not_found') {
        return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      }
      if (
        blockResult.code === 'invalid_conversation_id' ||
        blockResult.code === 'invalid_turn_range' ||
        blockResult.code === 'invalid_tail_count' ||
        blockResult.code === 'invalid_block_id' ||
        blockResult.code === 'blocks_required' ||
        blockResult.code === 'lorebook_id_required'
      ) {
        return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
      }
      if (blockResult.code === 'turn_range_too_large') {
        return reply.status(400).send({ error: ApiErrorCodes.turn_range_too_large })
      }
      if (blockResult.code === 'no_turns_in_range') {
        return reply.status(400).send({ error: ApiErrorCodes.no_turns_in_range })
      }
      return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
    }
    return blockResult
  },
)

app.post<{
  Params: { pluginId: string }
  Body: Record<string, unknown>
}>(
  '/api/plugins/:pluginId/assemble-plugin-prompt',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!readAuth.ok) {
      return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
    }
    const parsed = parseAssemblePluginPromptBody(request.body ?? {})
    if (!parsed) {
      return reply.status(400).send({ error: ApiErrorCodes.plugin_assemble_prompt_failed })
    }
    const result = await runAssemblePluginPrompt(parsed)
    if (!result.ok) {
      if (result.code === 'context_exceeded') {
        return reply.status(400).send({
          error: ApiErrorCodes.plugin_complete_context_exceeded,
          ...(typeof result.promptTokens === 'number'
            ? { promptTokens: result.promptTokens }
            : {}),
          ...(typeof result.budget === 'number' ? { budget: result.budget } : {}),
        })
      }
      return reply.status(400).send({ error: ApiErrorCodes.plugin_assemble_prompt_failed })
    }
    return result
  },
)

app.post<{
  Params: { pluginId: string }
  Body: Record<string, unknown>
}>(
  '/api/plugins/:pluginId/complete-with-context',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!readAuth.ok) {
      return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
    }
    const completeAuth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
    if (!completeAuth.ok) {
      return reply.status(completeAuth.status).send({ error: ApiErrorCodes[completeAuth.code] })
    }
    const parsed = parseCompleteWithContextBody(request.body ?? {})
    if (!parsed) {
      return reply.status(400).send({ error: ApiErrorCodes.plugin_complete_with_context_failed })
    }
    const needsLore =
      !parsed.preparedContext && contextBlockSpecsNeedLorebookRead(parsed.blocks)
    if (needsLore) {
      const loreAuth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
      if (!loreAuth.ok) {
        return reply.status(loreAuth.status).send({ error: ApiErrorCodes[loreAuth.code] })
      }
    }
    const result = await runCompleteWithContext(pluginId, parsed, getCurrentUserId())
    if (!result.ok) {
      if (result.code === 'conversation_not_found') {
        return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      }
      const code = result.code
      const errorKey =
        code === 'parse_failed' || code === 'plugin_complete_draft_failed'
          ? 'plugin_complete_draft_failed'
          : code === 'context_exceeded'
            ? 'plugin_complete_context_exceeded'
            : code === 'context_length_unconfigured'
              ? 'plugin_complete_context_length_unconfigured'
              : code === 'turn_range_too_large'
                ? 'turn_range_too_large'
                : code === 'draft_kind_invalid'
                  ? 'plugin_complete_with_context_failed'
                  : code in ApiErrorCodes
                    ? code
                    : 'plugin_complete_with_context_failed'
      return reply.status(400).send({
        error: ApiErrorCodes[errorKey as keyof typeof ApiErrorCodes],
        code,
        ...(result.detail ? { detail: result.detail } : {}),
        ...(typeof result.promptTokens === 'number'
          ? { promptTokens: result.promptTokens }
          : {}),
        ...(typeof result.budget === 'number' ? { budget: result.budget } : {}),
      })
    }
    return result
  },
)

app.post<{
  Params: { pluginId: string }
  Body: {
    lorebookId?: string
    entryIds?: Record<string, string>
    validKeys?: string[]
  }
}>(
  '/api/plugins/:pluginId/lorebooks/normalize-entry-refs',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    const result = await runNormalizeLorebookEntryRefs({
      lorebookId: typeof body.lorebookId === 'string' ? body.lorebookId : '',
      entryIds:
        body.entryIds && typeof body.entryIds === 'object' && !Array.isArray(body.entryIds)
          ? (body.entryIds as Record<string, string>)
          : {},
      validKeys: Array.isArray(body.validKeys)
        ? body.validKeys.filter((x): x is string => typeof x === 'string')
        : [],
    })
    if (!result.ok) {
      if (result.code === 'lorebook_not_found') {
        return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
      }
      if (result.code === 'lorebook_id_required') {
        return reply.status(400).send({ error: ApiErrorCodes.lorebook_id_required })
      }
      return reply.status(400).send({ error: ApiErrorCodes.lorebook_entry_patch_failed })
    }
    return result
  },
)

app.post<{
  Params: { pluginId: string; lorebookId: string }
  Body: {
    scope?: 'full' | 'partial'
    groupIds?: string[]
    entriesByGroup?: Record<string, string[]>
  }
}>(
  '/api/plugins/:pluginId/lorebooks/:lorebookId/apply-order',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const lorebookId = request.params.lorebookId
    if (!LOREBOOK_ID_RE.test(lorebookId)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const auth = await assertPluginRoutePermission(pluginId, 'lorebook.entry.write')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    const result = await runApplyLorebookOrder({
      lorebookId,
      scope: body.scope === 'full' ? 'full' : 'partial',
      groupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
      entriesByGroup:
        body.entriesByGroup && typeof body.entriesByGroup === 'object'
          ? body.entriesByGroup
          : undefined,
    })
    if (!result.ok) {
      if (result.code === 'lorebook_not_found') {
        return reply.status(404).send({ error: ApiErrorCodes.lorebook_not_found })
      }
      if (result.code === 'lorebook_id_required') {
        return reply.status(400).send({ error: ApiErrorCodes.lorebook_id_required })
      }
      if (result.code.startsWith('order_')) {
        return reply.status(400).send({ error: ApiErrorCodes.lorebook_order_invalid })
      }
      return reply.status(400).send({ error: ApiErrorCodes.lorebook_entry_patch_failed })
    }
    return {
      ok: true,
      lorebook: result.lorebook,
      changed: result.changed,
      savedAt: result.savedAt,
    }
  },
)

app.post<{
  Params: { pluginId: string; action: string }
  Body: Record<string, unknown>
}>(
  '/api/plugins/:pluginId/actions/:action',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const action = request.params.action.trim()
    const permissions = await listPluginActionPermissions(pluginId, action)
    if (!permissions?.length) {
      return reply.status(404).send({ error: ApiErrorCodes.plugin_hook_not_supported })
    }
    for (const perm of permissions) {
      const auth = await assertPluginRoutePermission(pluginId, perm)
      if (!auth.ok) {
        return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
      }
    }
    const body =
      request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {}
    const result = await runPluginActionRoute(pluginId, action, body)
    if (!result.ok) {
      const debugBody = result.debug ? { debug: result.debug } : {}
      if (
        result.code === 'plugin_action_not_supported' ||
        result.code === 'unknown_action'
      ) {
        return reply.status(404).send({ error: ApiErrorCodes.plugin_hook_not_supported })
      }
      if (result.code === 'invalid_conversation_id') {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      if (result.code === 'turn_not_found' || result.code === 'no_turns') {
        return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
      }
      if (result.code === 'parse_failed') {
        return reply.status(mapPluginActionErrorStatus(result.code, result.status)).send({
          error: ApiErrorCodes.upstream_non_json,
          detail: result.code,
          ...debugBody,
        })
      }
      if (result.code === 'api_config_not_found') {
        return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      if (result.code === 'invalid_state') {
        return reply.status(422).send({ error: ApiErrorCodes.upstream_non_json })
      }
      return reply.status(mapPluginActionErrorStatus(result.code, result.status)).send({
        error: ApiErrorCodes.plugin_complete_failed,
        detail: result.code,
        ...debugBody,
      })
    }
    return result
  },
)

app.post<{
  Params: { pluginId: string }
  Body: {
    text?: string
    conversationId?: string
    apiConfigId?: string
    locale?: string
    toTurn?: number
    persistVars?: boolean
  }
}>(
  '/api/plugins/:pluginId/macros/expand',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const auth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    const toTurnRaw = body.toTurn
    const toTurn =
      typeof toTurnRaw === 'number' &&
      Number.isInteger(toTurnRaw) &&
      toTurnRaw >= 0
        ? toTurnRaw
        : undefined
    const result = await runPluginMacroExpand({
      text: typeof body.text === 'string' ? body.text : '',
      conversationId:
        typeof body.conversationId === 'string' ? body.conversationId : undefined,
      apiConfigId:
        typeof body.apiConfigId === 'string' ? body.apiConfigId : undefined,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
      toTurn,
      persistVars: body.persistVars !== false,
    })
    if (!result.ok) {
      return reply.status(400).send({ error: ApiErrorCodes.messages_required_nonempty })
    }
    return { ok: true as const, text: result.text }
  },
)

app.get<{ Params: { pluginId: string; name: string } }>(
  '/api/plugins/:pluginId/assets/:name',
  async (request, reply) => {
    const manifest = await readPluginManifest(request.params.pluginId)
    const asset = await readPluginBundledAsset(
      request.params.pluginId,
      request.params.name,
    )
    if (!asset) {
      return reply.status(404).send({ error: 'not_found' })
    }
    void manifest
    reply.header('Content-Type', asset.contentType)
    reply.header('Cache-Control', 'no-cache')
    return reply.send(asset.body)
  },
)

app.get<{ Params: { pluginId: string; name: string } }>(
  '/api/plugins/:pluginId/user-assets/:name',
  async (request, reply) => {
    const uid = getCurrentUserId()
    const asset = await readPluginUserAsset(
      request.params.pluginId,
      request.params.name,
      uid,
    )
    if (!asset) {
      return reply.status(404).send({ error: 'not_found' })
    }
    reply.header('Content-Type', asset.contentType)
    reply.header('Cache-Control', 'no-cache')
    return reply.send(asset.body)
  },
)

app.post<{ Params: { pluginId: string } }>(
  '/api/plugins/:pluginId/user-assets',
  async (request, reply) => {
    const parts = request.parts()
    let fileBuffer: Buffer | null = null
    let filename = ''
    let fieldKey = ''
    for await (const part of parts) {
      if (part.fieldname === 'file' && 'toBuffer' in part) {
        fileBuffer = await part.toBuffer()
        filename = part.filename ?? 'upload.bin'
      } else if (part.fieldname === 'fieldKey') {
        const v = (part as { value?: unknown }).value
        fieldKey = typeof v === 'string' ? v : ''
      }
    }
    if (!fileBuffer) {
      return reply.status(400).send({ error: 'file_required' })
    }
    try {
      const saved = await savePluginUserAssetUpload({
        pluginId: request.params.pluginId,
        userId: getCurrentUserId(),
        filename,
        buffer: fileBuffer,
        fieldKey: fieldKey || undefined,
      })
      return saved
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upload_failed'
      if (msg === 'file_too_large') {
        return reply.status(413).send({ error: msg })
      }
      if (msg === 'invalid_extension' || msg === 'invalid_filename') {
        return reply.status(400).send({ error: msg })
      }
      return reply.status(404).send({ error: 'not_found' })
    }
  },
)

app.get<{ Params: { pluginId: string; file: string } }>(
  '/api/plugins/:pluginId/dist/:file',
  async (request, reply) => {
    const file = request.params.file?.trim()
    if (file !== 'web.mjs' && file !== 'server.mjs') {
      return reply.status(404).send({ error: 'not_found' })
    }
    const asset = await readPluginDistFile(
      request.params.pluginId,
      `dist/${file}`,
    )
    if (!asset) {
      return reply.status(404).send({ error: 'not_found' })
    }
    reply.header('Content-Type', asset.contentType)
    reply.header('Cache-Control', 'no-cache')
    return reply.send(asset.body)
  },
)

app.get<{ Params: { pluginId: string; locale: string } }>(
  '/api/plugins/:pluginId/locales/:locale',
  async (request, reply) => {
    const localeRaw = request.params.locale?.trim() ?? ''
    const locale = localeRaw.endsWith('.json')
      ? localeRaw.slice(0, -5)
      : localeRaw
    const asset = await readPluginLocaleFile(request.params.pluginId, locale)
    if (!asset) {
      return reply.status(404).send({ error: 'not_found' })
    }
    reply.header('Content-Type', 'application/json; charset=utf-8')
    reply.header('Cache-Control', 'no-cache')
    return reply.send(asset.body)
  },
)

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
        apiKey: undefined,
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
  let assemblyAudit: import('./chat-audit-types.js').AssemblyAudit | undefined
  let assemblyEmbeddingCalls:
    | import('./chat-audit-types.js').CallAuditEntry[]
    | undefined
  let performanceAuditBase: PerformanceAudit | undefined
  let buildFinishedAt = 0
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
            typeof body.speakerCharacterId === 'string'
              ? body.speakerCharacterId.trim()
              : undefined,
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
  const clientAbort = wantStream ? new AbortController() : null
  const unbindClientAbort = clientAbort
    ? bindChatClientAbort(request, clientAbort)
    : () => {}

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
        ...(clientAbort
          ? {
              signal: mergeChatUpstreamAbortSignals(
                clientAbort,
                streamTimeoutMs,
              ),
            }
          : {}),
      },
      streamTimeoutMs,
    )
  } catch (err) {
    unbindClientAbort()
    throw err
  }

  if (!upstream.ok) {
    unbindClientAbort()
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
  const trackStreamPerf = Boolean(performanceAuditBase)

  if (wantStream && upstream.body) {
    reply.header('Content-Type', 'text/event-stream; charset=utf-8')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')
    reply.header('X-Accel-Buffering', 'no')
    if (typeof estimatedTokens === 'number' && estimatedTokens > 0) {
      reply.header('X-Prompt-Estimated-Tokens', String(Math.round(estimatedTokens)))
    }

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
        if (!persistParams || !accContent.trim()) {
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
        void persistTurnAfterModelReply({
          ...persistParams,
          assistantContent: accContent,
          assistantReasoning: accReasoning.trim() || undefined,
          durationMs: Math.round(streamEndedAt - upstreamStartedAt),
          estimatedTokens: persistParams.estimatedTokens,
          completionTokens: accCompletionTokens,
          performanceAudit,
        })
          .then((persist) => {
            if (!persist.ok) {
              request.log.warn({ persist }, 'stream persist failed')
            }
            this.push(formatArousalPersistSseLine(persist))
            cb()
          })
          .catch((err) => {
            request.log.error(err, 'stream persist error')
            this.push(
              formatArousalPersistSseLine({
                ok: false,
                error: ApiErrorCodes.persist_error,
              }),
            )
            cb()
          })
      },
    })

    const nodeStream = pipeUpstreamSseBody(
      upstream.body as ReadableStream<Uint8Array>,
      tap,
      request.log,
    )
    nodeStream.once('close', unbindClientAbort)
    return reply.send(nodeStream)
  }

  unbindClientAbort()
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
    ...(typeof estimatedTokens === 'number' && estimatedTokens > 0
      ? { estimatedTokens }
      : {}),
    ...(typeof completionTokens === 'number' && completionTokens > 0
      ? { completionTokens }
      : {}),
    raw: data,
  })
})

await registerStaticWeb(app)

const port = resolveServerPort()
const host = resolveListenHost()

try {
  await app.listen({ port, host })
  app.log.info(`listening on http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)
  scheduleStartupBackupIfNeeded()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
