import cors from '@fastify/cors'
import { ApiErrorCodes } from './api-error-codes.js'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { closeAllLanceConnections } from './lance-connection-pool.js'
import { generateShortId, isValidShortId } from './short-id.js'
import { Readable, Transform } from 'node:stream'
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
} from './chunk-chain.js'
import { loadConversationMessages } from './conversation-messages-api.js'
import {
  createConversationStub,
  deleteConversation,
  readChatList,
  readConversationIndex,
  removeTurnAtOrdinalInTailChunk,
  appendConversationTurn,
  readChatPromptFile,
  updateConversationAuditDebug,
  saveOpeningTurn,
  saveFirstTurn,
  updateConversationTitle,
  updateConversationCharacterBindings,
  updateConversationPromptDebugMax,
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
  clearConversationChatApiSettings,
  updateConversationChatApiSettings,
  clearConversationEmbeddingApiSettings,
  updateConversationEmbeddingApiSettings,
  updateConversationPluginSettings,
  readConversationPluginSettings,
  parseConversationChatBinding,
  parseConversationEmbeddingApiOverride,
  getTurnUserText,
  resolvedCharacterIds,
  batchUpdateConversationTurns,
  updateTurnContentInTailChunk,
  type TurnReceive,
} from './chat-storage.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  parseTurnPatchBody,
} from './turn-patch-body.js'
import { reindexConversationMemory } from './memory-index.js'
import { startConversationMemoryReindexSse } from './memory-reindex-sse.js'
import {
  ensureDataSkeleton,
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
} from './user-preferences-file.js'
import {
  normalizeHybridFtsProfile,
  normalizeHybridFtsSettings,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'
import { registerHybridFtsRoutes } from './hybrid-fts-routes.js'
import { parseBudgetTrimSettingsPatch } from './budget-trim-settings.js'
import { normalizeEmbeddingDimensions, normalizeEmbeddingApiSettings } from './embedding-api-settings.js'
import {
  isValidConversationId,
} from './conversation-id.js'
import { registerAdminConsole } from './admin/routes.js'
import { registerAuth } from './auth.js'
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
import { runPluginCompleteDraftRoute } from './plugin-complete-draft-route.js'
import { runTraceKeeperRegenerateRoute } from './trace-keeper-regenerate-route.js'
import { runPluginComplete } from './plugin-complete.js'
import { runPluginCompletePreflight } from './plugin-complete-preflight.js'
import { runNormalizeLorebookEntryRefs } from './plugin-lorebook-entry-refs.js'
import { runApplyLorebookOrder } from './plugin-lorebook-apply-order.js'
import { ensurePluginLorebook } from './plugin-lorebook-ensure.js'
import { runPluginMacroExpand } from './plugin-macro-expand.js'
import { runPluginPrepareContext } from './plugin-prepare-context.js'
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
import { StPresetValidationError } from './st-preset-limits.js'
import { persistTurnAfterModelReply } from './chat-persist-after-chat.js'
import {
  loadAndApplyRegexPersistToTurnPatch,
  resolveTurnPatchPersistRegex,
  resolveConversationTailOrdinal,
  toTurnPatchPersistPayload,
} from './regex-persist-patch.js'
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
  importCharacterCard,
  importCharacterCardPng,
  importCharacterCardWithPortrait,
  listCharacterSummaries,
  normalizeImportCard,
  parseCharacterListSort,
  parseCharacterListSortOrder,
  readCharacterDocument,
  readCharacterPngBuffer,
  updateCharacterDocument,
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
  /** @deprecated 服务端读盘解析；客户端不应再传 */
  apiKey?: string
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
  /** 插件请求体（如 guidance-generate） */
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
  /** @deprecated 服务端读盘解析 */
  apiKey?: string
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
const app = Fastify({
  logger: true,
  bodyLimit: 20 * 1024 * 1024,
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
  limits: { fileSize: 15 * 1024 * 1024 },
})

app.addHook('onClose', async () => {
  closeAllLanceConnections()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    closeAllLanceConnections()
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
  /** @deprecated 使用 auditDebug */
  promptDebug?: { maxStored?: number }
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
    const pd = b.promptDebug
    const hasPromptDebug =
      pd &&
      typeof pd === 'object' &&
      typeof (pd as { maxStored?: unknown }).maxStored === 'number'
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
    if (
      !hasTitle &&
      !hasAuditDebug &&
      !hasPromptDebug &&
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
      !hasPluginSettings
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
    } else if (hasPromptDebug) {
      const m = (pd as { maxStored: number }).maxStored
      const next = await updateConversationPromptDebugMax(id, m)
      if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      idx = next
    }
    if (hasCharIds) {
      const raw = b.characterIds as unknown[]
      if (!raw.every((x) => typeof x === 'string')) {
        return reply.status(400).send({ error: ApiErrorCodes.character_ids_must_be_string_array })
      }
      const prevPrimary =
        idx.characterIds?.[0] ?? idx.characterId ?? ''
      const next = await updateConversationCharacterBindings(id, raw)
      if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      const nextPrimary =
        next.characterIds?.[0] ?? next.characterId ?? ''
      if (prevPrimary !== nextPrimary) {
        const tk = readConversationPluginSettings(next, 'trace-keeper')
        const epoch =
          typeof tk.trackerEpoch === 'number' && Number.isFinite(tk.trackerEpoch)
            ? Math.round(tk.trackerEpoch)
            : 0
        const bumped = await updateConversationPluginSettings(id, {
          'trace-keeper': { trackerEpoch: epoch + 1 },
        })
        idx = bumped ?? next
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
        const patch: {
          memoryEnabled?: boolean
          memoryTopK?: number
        } = {}
        if (Object.prototype.hasOwnProperty.call(raw, 'memoryEnabled')) {
          if (typeof (raw as { memoryEnabled?: unknown }).memoryEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.memory_settings_memory_enabled_boolean })
          }
          patch.memoryEnabled = (raw as { memoryEnabled: boolean }).memoryEnabled
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'memoryTopK')) {
          const d = (raw as { memoryTopK?: unknown }).memoryTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.memory_settings_memory_top_k_number })
          }
          patch.memoryTopK = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'memoryEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'memoryTopK')
        ) {
          return reply.status(400).send({
            error: ApiErrorCodes.memory_settings_requires_field,
          })
        }
        const next = await updateConversationMemorySettings(id, patch)
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
    return { ok: true as const, index: idx }
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
  Querystring: { from?: string; to?: string; tail?: string; before?: string; limit?: string }
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
      return reply.status(400).send({ error: code })
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
      const ok = await updateTurnContentInTailChunk(
        id,
        ord,
        normalized.userText,
        normalized.receives,
        normalized.activeReceiveIndex,
      )
      if (!ok) {
        return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
      }
      return toTurnPatchPersistPayload(normalized)
    } catch (e) {
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
      const ok = await removeTurnAtOrdinalInTailChunk(id, ord)
      if (!ok) {
        return reply.status(404).send({ error: ApiErrorCodes.turn_delete_not_found })
      }
      return { ok: true as const }
    } catch (e) {
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
    return idx
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
      }
    } catch (e) {
      request.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.chunk_index_repair_failed })
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

/** 调试：读取会话目录下 chat-audit.json（含 messages + assembly + calls） */
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

/** @deprecated 使用 chat-audit；仅返回 messages 条目以兼容旧客户端 */
app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id/chat-prompt',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
    const audit = await readChatAuditFile(id)
    return {
      schemaVersion: 1 as const,
      entries: audit.entries.map((e) => ({
        savedAt: e.savedAt,
        chunkName: e.chunkName,
        turnId: e.turnId,
        turnOrdinal: e.turnOrdinal,
        messages: e.messages,
      })),
    }
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
    if (
      !hasLore &&
      !hasHist &&
      !hasMem &&
      !hasBudgetTrim &&
      !hasEmbed &&
      !hasChunk &&
      !hasDefaultAuthorsNote &&
      !hasHybridFts
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
        const patch: {
          memoryEnabled?: boolean
          memoryTopK?: number
        } = {}
        if (Object.prototype.hasOwnProperty.call(b.memory, 'memoryEnabled')) {
          if (typeof b.memory!.memoryEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: ApiErrorCodes.memory_enabled_boolean })
          }
          patch.memoryEnabled = b.memory!.memoryEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.memory, 'memoryTopK')) {
          const d = b.memory!.memoryTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: ApiErrorCodes.memory_top_k_number })
          }
          patch.memoryTopK = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'memoryEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'memoryTopK')
        ) {
          return reply.status(400).send({
            error: ApiErrorCodes.global_memory_requires_field,
          })
        }
        memory = await updateGlobalMemorySettings(patch)
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
  try {
    const { items, total, filterCounts } = await listCharacterSummaries({
      offset,
      limit,
      search,
      filter,
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
      const doc = await importCharacterCardWithPortrait(card, portraitBuf)
      return { ok: true as const, id: doc.id }
    } catch (e) {
      return reply.status(400).send({
        error: ApiErrorCodes.character_create_failed,
      })
    }
  }
  try {
    const card = cardFromNewCharacterForm(request.body)
    const doc = await importCharacterCard(card)
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
      const doc = await updateCharacterPortrait(id, buf)
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

app.patch<{ Params: { id: string }; Body: { card?: unknown } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const body = request.body as { card?: unknown }
    if (
      !body ||
      typeof body !== 'object' ||
      !body.card ||
      typeof body.card !== 'object' ||
      Array.isArray(body.card)
    ) {
      return reply
        .status(400)
        .send({ error: ApiErrorCodes.card_body_invalid })
    }
    try {
      const doc = await updateCharacterDocument(
        id,
        body.card as Record<string, unknown>,
      )
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
    const doc = await readCharacterDocument(id)
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
    fromTurn?: number
    toTurn?: number
    targetLorebookId?: string
    includePreviousMemories?: boolean
    previousMemoriesLimit?: number
    previousSummariesLimit?: number
    sidecarEntryIds?: Record<string, string>
    sidecarIds?: string[]
    regexRuleIds?: string[]
    tailOrdinal?: number
    regexApplyAllTurns?: boolean
  }
}>(
  '/api/plugins/:pluginId/prepare-context',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!readAuth.ok) {
      return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
    }
    const loreAuth = await assertPluginRoutePermission(pluginId, 'lorebook.read')
    if (!loreAuth.ok) {
      return reply.status(loreAuth.status).send({ error: ApiErrorCodes[loreAuth.code] })
    }
    const body = request.body ?? {}
    const result = await runPluginPrepareContext({
      conversationId:
        typeof body.conversationId === 'string' ? body.conversationId : '',
      fromTurn: typeof body.fromTurn === 'number' ? body.fromTurn : NaN,
      toTurn: typeof body.toTurn === 'number' ? body.toTurn : NaN,
      targetLorebookId:
        typeof body.targetLorebookId === 'string' ? body.targetLorebookId : '',
      includePreviousMemories:
        typeof body.includePreviousMemories === 'boolean'
          ? body.includePreviousMemories
          : undefined,
      previousMemoriesLimit:
        typeof body.previousMemoriesLimit === 'number'
          ? body.previousMemoriesLimit
          : undefined,
      previousSummariesLimit:
        typeof body.previousSummariesLimit === 'number'
          ? body.previousSummariesLimit
          : undefined,
      sidecarEntryIds:
        body.sidecarEntryIds && typeof body.sidecarEntryIds === 'object'
          ? body.sidecarEntryIds
          : undefined,
      sidecarIds: Array.isArray(body.sidecarIds) ? body.sidecarIds : undefined,
      regexRuleIds: Array.isArray(body.regexRuleIds)
        ? body.regexRuleIds
        : undefined,
      tailOrdinal:
        typeof body.tailOrdinal === 'number' ? body.tailOrdinal : undefined,
      regexApplyAllTurns: body.regexApplyAllTurns === true,
    })
    if (!result.ok) {
      if (result.code === 'conversation_not_found') {
        return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      }
      if (result.code === 'invalid_conversation_id') {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      if (result.code === 'invalid_turn_range') {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_turn_range })
      }
      if (result.code === 'target_lorebook_required') {
        return reply.status(400).send({ error: ApiErrorCodes.target_lorebook_required })
      }
      if (result.code === 'no_turns_in_range') {
        return reply.status(400).send({ error: ApiErrorCodes.no_turns_in_range })
      }
      return reply.status(400).send({ error: ApiErrorCodes.plugin_prepare_context_failed })
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
  Params: { pluginId: string }
  Body: {
    conversationId?: string
    apiConfigId?: string
    kind?: string
    userContent?: string
    systemPromptTemplate?: string
    fromTurn?: number
    toTurn?: number
    sidecarName?: string
  }
}>(
  '/api/plugins/:pluginId/complete-draft',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const auth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
    if (!auth.ok) {
      return reply.status(auth.status).send({ error: ApiErrorCodes[auth.code] })
    }
    const body = request.body ?? {}
    const result = await runPluginCompleteDraftRoute(pluginId, body)
    if (!result.ok) {
      if (result.code === 'plugin_hook_not_supported') {
        return reply.status(404).send({ error: ApiErrorCodes.plugin_hook_not_supported })
      }
      if (result.code === 'invalid_conversation_id') {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      if (result.code === 'api_config_not_found') {
        return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      if (result.code === 'draft_kind_invalid') {
        return reply.status(400).send({ error: ApiErrorCodes.draft_kind_invalid })
      }
      if (result.code === 'user_content_required') {
        return reply.status(400).send({ error: ApiErrorCodes.user_content_required })
      }
      if (result.code === 'system_prompt_required') {
        return reply.status(400).send({ error: ApiErrorCodes.system_prompt_required })
      }
      if (result.code === 'context_exceeded') {
        return reply.status(400).send({
          error: ApiErrorCodes.plugin_complete_context_exceeded,
        })
      }
      if (result.code === 'context_length_unconfigured') {
        return reply.status(400).send({
          error: ApiErrorCodes.plugin_complete_context_length_unconfigured,
        })
      }
      if (result.code === 'parse_failed') {
        return reply.status(502).send({ error: ApiErrorCodes.upstream_non_json })
      }
      return reply.status(502).send({
        error: ApiErrorCodes.plugin_complete_draft_failed,
        detail: result.detail,
      })
    }
    return { ok: true as const, draft: result.draft, usage: result.usage, latencyMs: result.latencyMs }
  },
)

app.post<{
  Params: { pluginId: string }
  Body: { conversationId?: string; turnOrdinal?: number }
}>(
  '/api/plugins/:pluginId/regenerate-separate',
  async (request, reply) => {
    const pluginId = request.params.pluginId.trim()
    const completeAuth = await assertPluginRoutePermission(pluginId, 'plugin.complete')
    if (!completeAuth.ok) {
      return reply.status(completeAuth.status).send({ error: ApiErrorCodes[completeAuth.code] })
    }
    const readAuth = await assertPluginRoutePermission(pluginId, 'conversation.read')
    if (!readAuth.ok) {
      return reply.status(readAuth.status).send({ error: ApiErrorCodes[readAuth.code] })
    }
    const body = request.body ?? {}
    const result = await runTraceKeeperRegenerateRoute(pluginId, body)
    if (!result.ok) {
      if (result.code === 'plugin_hook_not_supported') {
        return reply.status(404).send({ error: ApiErrorCodes.plugin_hook_not_supported })
      }
      if (result.code === 'invalid_conversation_id') {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      if (result.code === 'turn_not_found' || result.code === 'no_turns') {
        return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
      }
      if (result.code === 'parse_failed') {
        return reply.status(502).send({ error: ApiErrorCodes.upstream_non_json })
      }
      if (result.code === 'api_config_not_found') {
        return reply.status(400).send({ error: ApiErrorCodes.api_preset_not_found })
      }
      return reply.status(result.status ?? 502).send({
        error: ApiErrorCodes.plugin_complete_failed,
        detail: result.code,
      })
    }
    return {
      ok: true as const,
      state: result.state,
      turnOrdinal: result.turnOrdinal,
      receiveId: result.receiveId,
    }
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
    const built = await buildConversationOutboundMessages({
      conversationId: convId,
      userText,
      promptTrigger: body.promptTrigger,
      historyBeforeTurnOrdinalExclusive: body.historyBeforeTurnOrdinalExclusive,
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

  const persistParams =
    convId && userText.trim()
      ? {
          conversationId: convId,
          userText: userText.trim(),
          model: model.trim() || undefined,
          assembledMessages: messages,
          regenerateTurnOrdinal,
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
    wantStream
      ? UPSTREAM_STREAM_FETCH_TIMEOUT_MS
      : UPSTREAM_FETCH_TIMEOUT_MS,
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

    const nodeStream = Readable.fromWeb(
      upstream.body as import('stream/web').ReadableStream,
    ).pipe(tap)
    return reply.send(nodeStream)
  }

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
