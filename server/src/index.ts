import cors from '@fastify/cors'
import { ApiErrorCodes } from './api-error-codes.js'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { closeAllLanceConnections } from './lance-connection-pool.js'
import { generateShortId, isValidShortId } from './short-id.js'
import { Readable, Transform } from 'node:stream'
import {
  assertValidPresets,
  readApiSettingsFromFile,
  writeApiSettingsToFile,
  type ApiPreset,
  type ApiSettingsDocument,
} from './api-settings-file.js'
import { appendDrySamplerToPayload } from './dry-sampler.js'
import { readAllTurns } from './chunk-chain.js'
import {
  createConversationStub,
  deleteConversation,
  readChatList,
  readConversationIndex,
  removeTurnAtOrdinalInTailChunk,
  appendConversationTurn,
  readChatPromptFile,
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
  updateConversationUserCharacterId,
  updateConversationUserName,
  getTurnUserText,
  resolvedCharacterIds,
  updateTurnContentInTailChunk,
  type TurnReceive,
} from './chat-storage.js'
import { reindexConversationMemory } from './memory-index.js'
import { startConversationMemoryReindexSse } from './memory-reindex-sse.js'
import { ensureDataSkeleton, resolveListenHost, resolveServerPort } from './config.js'
import { registerStaticWeb } from './static-web.js'
import {
  readUserPreferencesDocument,
  updateGlobalHistorySettings,
  updateGlobalLorebookSettings,
  updateGlobalMemorySettings,
  updateGlobalEmbeddingApiSettings,
  updateGlobalChunkSettings,
} from './user-preferences-file.js'
import { normalizeEmbeddingDimensions } from './embedding-api-settings.js'
import {
  isValidConversationId,
} from './conversation-id.js'
import { registerAuth } from './auth.js'
import { ensureUsersRegistry } from './users-index.js'
import {
  assertValidPromptsPayload,
  readPromptsDocument,
  writePromptsDocument,
  type PromptsDocument,
} from './prompts-file.js'
import {
  assertValidLorebooksPayload,
  buildDefaultLorebook,
  readLorebookById,
  readLorebooksDocument,
  writeLorebooksDocument,
  LOREBOOK_ID_RE,
  type LorebooksDocument,
} from './lorebook-file.js'
import {
  assertValidApiKeysPayload,
  readApiKeysDocument,
  writeApiKeysDocument,
  type ApiKeysDocument,
} from './api-keys-file.js'
import { buildConversationOutboundMessages } from './chat-assemble.js'
import { scheduleLorebookVectorReindex } from './lorebook-vector-index.js'
import {
  applyPromptMacroPipeline,
  buildPromptMacroContext,
} from './prompt-macros/index.js'
import {
  runPromptsAssemblePreview,
  type PromptsAssemblePreviewBody,
} from './prompts-assemble-preview.js'
import { persistTurnAfterModelReply } from './chat-persist-after-chat.js'
import { extractCompletionTokens } from './chat-usage.js'
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

const DEFAULT_BASE = 'https://api.openai.com/v1'

type ChatRole = 'system' | 'user' | 'assistant'

interface ChatMessage {
  role: ChatRole
  content: string
}

interface ChatBody {
  alias?: string
  baseUrl?: string
  apiKey: string
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
  contextLength?: number | null
  maxTokens?: number | null
  stream?: boolean
  /** 为 true 时合并思维链相关参数（可被 customParams 覆盖），具体字段因网关而异 */
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
  apiKey: string
}

function extractModelIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const o = json as Record<string, unknown>
  if (Array.isArray(o.data)) {
    const ids = o.data
      .map((x) => {
        if (x && typeof x === 'object' && x !== null && 'id' in x) {
          const id = (x as { id: unknown }).id
          return typeof id === 'string' ? id : ''
        }
        return ''
      })
      .filter((s): s is string => s.length > 0)
    return [...new Set(ids)]
  }
  if (Array.isArray(o.models)) {
    const ids = o.models
      .map((x) => {
        if (typeof x === 'string') return x
        if (x && typeof x === 'object' && x !== null) {
          if ('id' in x) {
            const id = (x as { id: unknown }).id
            if (typeof id === 'string') return id
          }
          if ('name' in x) {
            const n = (x as { name: unknown }).name
            if (typeof n === 'string') return n
          }
        }
        return ''
      })
      .filter((s): s is string => s.length > 0)
    return [...new Set(ids)]
  }
  return []
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

  if (requestReasoning === true) {
    Object.assign(payload, { thinking: { type: 'enabled' } })
  }

  if (
    customParams &&
    typeof customParams === 'object' &&
    !Array.isArray(customParams)
  ) {
    Object.assign(payload, customParams)
  }

  if (stream) payload.stream = true

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

await app.register(cors, { origin: true })
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
await registerAuth(app)
await ensureUsersRegistry()

app.get('/health', async () => ({ ok: true as const }))

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
  /** 调试：chat-prompt.json 保留条数上限，0～200；0 表示不写入新快照 */
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
  /** 用户 persona 卡 id；组装注入 persona，宏仍依赖 userName 快照 */
  userCharacterId?: string | null
  /** 宏 `{{user}}` 展示名；传 `null` 清除以使用默认「用户」 */
  userName?: string | null
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
    const hasUserCharacterId = Object.prototype.hasOwnProperty.call(b, 'userCharacterId')
    const hasUserName = Object.prototype.hasOwnProperty.call(b, 'userName')
    if (!hasTitle && !hasPromptDebug && !hasCharIds && !hasPromptPreset && !hasLorebookIds && !hasLorebookSettings && !hasHistorySettings && !hasMemorySettings && !hasUserCharacterId && !hasUserName) {
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
    if (hasPromptDebug) {
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
      const next = await updateConversationCharacterBindings(id, raw)
      if (!next) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
      idx = next
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
    const macroChars: { name?: string }[] = []
    if (idxForMacro) {
      for (const cid of resolvedCharacterIds(idxForMacro)) {
        const doc = await readCharacterDocument(cid)
        if (doc?.card && typeof doc.card === 'object') {
          const name = (doc.card as Record<string, unknown>).name
          macroChars.push({
            name: typeof name === 'string' ? name : undefined,
          })
        }
      }
    }
    const openingMacroCtx = buildPromptMacroContext({
      conversationUserName: idxForMacro?.userName,
      characters: macroChars,
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
  /** 与本次请求 /api/chat 的 messages 一致，写入 chat-prompt.json */
  debugPrompt?: unknown
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
        debugPrompt: b.debugPrompt,
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

interface MessagesTurnDto {
  turnOrdinal: number
  user: string
  receives: { id: string; content: string; reasoning?: string }[]
  activeReceiveIndex: number
}

app.patch<{
  Params: { id: string; turnOrdinal: string }
  Body: {
    userText?: unknown
    receives?: unknown
    activeReceiveIndex?: unknown
    debugPrompt?: unknown
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
    if (typeof b.userText !== 'string') {
      return reply.status(400).send({ error: ApiErrorCodes.user_text_must_be_string })
    }
    if (!Array.isArray(b.receives) || b.receives.length === 0) {
      return reply.status(400).send({ error: ApiErrorCodes.receives_required_nonempty })
    }
    const mapped: TurnReceive[] = []
    for (const r of b.receives) {
      if (!r || typeof r !== 'object') {
        return reply.status(400).send({ error: ApiErrorCodes.receives_item_invalid })
      }
      const o = r as {
        id?: unknown
        content?: unknown
        reasoning?: unknown
        durationMs?: unknown
        estimatedTokens?: unknown
        completionTokens?: unknown
      }
      if (typeof o.id !== 'string' || typeof o.content !== 'string') {
        return reply.status(400).send({ error: ApiErrorCodes.receives_item_id_content_required })
      }
      const rec: TurnReceive = { id: o.id, content: o.content }
      if (typeof o.reasoning === 'string' && o.reasoning.length > 0) {
        rec.reasoning = o.reasoning
      }
      if (typeof o.durationMs === 'number' && Number.isFinite(o.durationMs) && o.durationMs > 0) {
        rec.runtime = { ...(rec.runtime ?? {}), durationMs: Math.round(o.durationMs) }
      }
      if (
        typeof o.estimatedTokens === 'number' &&
        Number.isFinite(o.estimatedTokens) &&
        o.estimatedTokens > 0
      ) {
        rec.runtime = {
          ...(rec.runtime ?? {}),
          estimatedTokens: Math.round(o.estimatedTokens),
        }
      }
      if (
        typeof o.completionTokens === 'number' &&
        Number.isFinite(o.completionTokens) &&
        o.completionTokens > 0
      ) {
        rec.runtime = {
          ...(rec.runtime ?? {}),
          completionTokens: Math.round(o.completionTokens),
        }
      }
      mapped.push(rec)
    }
    if (typeof b.activeReceiveIndex !== 'number' || !Number.isInteger(b.activeReceiveIndex)) {
      return reply.status(400).send({ error: ApiErrorCodes.active_receive_index_must_be_integer })
    }
    try {
      const ok = await updateTurnContentInTailChunk(
        id,
        ord,
        b.userText,
        mapped,
        b.activeReceiveIndex,
        b.debugPrompt,
      )
      if (!ok) {
        return reply.status(404).send({ error: ApiErrorCodes.turn_chunk_not_found })
      }
      return { ok: true as const }
    } catch (e) {
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

app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id/messages',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const allTurnRecords = await readAllTurns(id)
    if (!allTurnRecords.length) {
      return { turns: [] as MessagesTurnDto[] }
    }
    const turns: MessagesTurnDto[] = allTurnRecords.map((t, i) => {
      const activeUserText = getTurnUserText(t)
      const recs = (t.receives ?? []).map((r) => {
        const base: {
          id: string
          content: string
          reasoning?: string
          durationMs?: number
          estimatedTokens?: number
          completionTokens?: number
        } = {
          id: typeof r.id === 'string' ? r.id : '',
          content: typeof r.content === 'string' ? r.content : '',
        }
        const rs =
          typeof r.reasoning === 'string' && r.reasoning.length > 0
            ? r.reasoning
            : undefined
        if (rs !== undefined) base.reasoning = rs
        const runtime = r.runtime
        if (runtime && typeof runtime === 'object') {
          const dm = (runtime as { durationMs?: unknown }).durationMs
          if (typeof dm === 'number' && Number.isFinite(dm) && dm > 0) {
            base.durationMs = Math.round(dm)
          }
          const et = (runtime as { estimatedTokens?: unknown }).estimatedTokens
          if (typeof et === 'number' && Number.isFinite(et) && et > 0) {
            base.estimatedTokens = Math.round(et)
          }
          const ct = (runtime as { completionTokens?: unknown }).completionTokens
          if (typeof ct === 'number' && Number.isFinite(ct) && ct > 0) {
            base.completionTokens = Math.round(ct)
          }
        }
        return base
      })
      const ord =
        typeof t.turnOrdinal === 'number' && !Number.isNaN(t.turnOrdinal)
          ? t.turnOrdinal
          : i
      let ai =
        typeof t.activeReceiveIndex === 'number' && !Number.isNaN(t.activeReceiveIndex)
          ? t.activeReceiveIndex
          : 0
      if (recs.length === 0) {
        return {
          turnOrdinal: ord,
          user: activeUserText,
          receives: [],
          activeReceiveIndex: 0,
        }
      }
      ai = Math.min(Math.max(0, ai), recs.length - 1)
      return {
        turnOrdinal: ord,
        user: activeUserText,
        receives: recs,
        activeReceiveIndex: ai,
      }
    })
    return { turns }
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
  debugPrompt?: unknown
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
        debugPrompt: b.debugPrompt,
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

/** 调试：读取会话目录下 chat-prompt.json（仅最近 N 条 prompt 快照） */
app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id/chat-prompt',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: ApiErrorCodes.conversation_not_found })
    const file = await readChatPromptFile(id)
    return file
  },
)

app.get('/api/user-preferences', async (_request, reply) => {
  try {
    return await readUserPreferencesDocument()
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.user_preferences_read_failed })
  }
})

interface PatchUserPreferencesBody {
  lorebook?: {
    recursiveEnabled?: boolean
    maxRecursionDepth?: number
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
  embeddingApi?: {
    baseUrl?: string
    apiKey?: string
    apiKeyId?: string | null
    embeddingModel?: string
  }
  chunk?: {
    turnsPerFile?: number
  }
}

app.patch<{ Body: PatchUserPreferencesBody }>(
  '/api/user-preferences',
  async (request, reply) => {
    const b = request.body ?? {}
    const hasLore = b.lorebook && typeof b.lorebook === 'object'
    const hasHist = b.history && typeof b.history === 'object'
    const hasMem = b.memory && typeof b.memory === 'object'
    const hasEmbed = b.embeddingApi && typeof b.embeddingApi === 'object'
    const hasChunk = b.chunk && typeof b.chunk === 'object'
    if (!hasLore && !hasHist && !hasMem && !hasEmbed && !hasChunk) {
      return reply.status(400).send({
        error: ApiErrorCodes.user_preferences_requires_section,
      })
    }
    try {
      let lorebook
      let history
      let memory
      let embeddingApi
      let chunk
      if (hasLore) {
        const patch: {
          recursiveEnabled?: boolean
          maxRecursionDepth?: number
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
      const doc = await readUserPreferencesDocument()
      return {
        ok: true as const,
        lorebook: lorebook ?? doc.lorebook,
        history: history ?? doc.history,
        memory: memory ?? doc.memory,
        embeddingApi: embeddingApi ?? doc.embeddingApi,
        chunk: chunk ?? doc.chunk,
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

app.get('/api/settings', async (_request, reply) => {
  try {
    const data = await readApiSettingsFromFile()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.settings_read_failed })
  }
})

type SettingsPutBody = Pick<ApiSettingsDocument, 'activePresetId' | 'presets'>

app.put<{ Body: SettingsPutBody }>('/api/settings', async (request, reply) => {
  const b = request.body
  if (!b || typeof b !== 'object') {
    return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
  }
  if (!Array.isArray(b.presets)) {
    return reply.status(400).send({ error: ApiErrorCodes.missing_presets_array })
  }
  try {
    assertValidPresets(b.presets as ApiPreset[])
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.preset_validation_failed,
    })
  }
  const activePresetId =
    typeof b.activePresetId === 'string' ? b.activePresetId : ''
  if (!(b.presets as ApiPreset[]).some((p) => p.id === activePresetId)) {
    return reply.status(400).send({ error: ApiErrorCodes.active_preset_id_mismatch })
  }

  const savedAt = new Date().toISOString()
  const doc: ApiSettingsDocument = {
    version: 1,
    savedAt,
    activePresetId,
    presets: b.presets as ApiPreset[],
  }

  try {
    await writeApiSettingsToFile(doc)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.settings_write_failed })
  }

  return { ok: true as const, savedAt }
})

app.get('/api/prompts', async (_request, reply) => {
  try {
    const data = await readPromptsDocument()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.prompts_read_failed })
  }
})

app.put('/api/prompts', async (request, reply) => {
  let validated: { activePresetId: string; presets: unknown[] }
  try {
    validated = assertValidPromptsPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.prompts_validation_failed,
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

app.put('/api/lorebooks', async (request, reply) => {
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

app.get<{ Params: { id: string } }>(
  '/api/characters/:id/image',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
    }
    const buf = await readCharacterPngBuffer(id)
    if (!buf) return reply.status(404).send({ error: ApiErrorCodes.character_not_found_or_no_png })
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, max-age=60')
      .send(buf)
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
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.api_keys_read_failed })
  }
})

app.put('/api/api-keys', async (request, reply) => {
  let validated: { keys: ApiKeysDocument['keys'] }
  try {
    validated = assertValidApiKeysPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: ApiErrorCodes.api_keys_validation_failed,
    })
  }
  const savedAt = new Date().toISOString()
  const doc: ApiKeysDocument = {
    version: 1,
    savedAt,
    keys: validated.keys,
  }
  try {
    await writeApiKeysDocument(doc)
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: ApiErrorCodes.api_keys_write_failed })
  }
  return { ok: true as const, savedAt }
})

app.post<{ Body: ModelsListBody }>('/api/models', async (request, reply) => {
  const b = request.body ?? ({} as ModelsListBody)
  const apiKey = b.apiKey
  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(400).send({ error: ApiErrorCodes.missing_api_key })
  }
  const baseUrl = normalizeBaseUrl(b.baseUrl)
  const url = `${baseUrl}/models`

  const upstream = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  const text = await upstream.text()
  if (!upstream.ok) {
    request.log.warn(
      { status: upstream.status, body: text.slice(0, 400) },
      'models list upstream error',
    )
    return reply.status(502).send({
      error: ApiErrorCodes.models_list_failed,
      status: upstream.status,
      detail: text.slice(0, 1500),
    })
  }

  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    return reply.status(502).send({ error: ApiErrorCodes.upstream_non_json })
  }

  const models = extractModelIds(json).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
  return { models }
})

app.post<{ Body: ChatBody }>('/api/chat', async (request, reply) => {
  const body = request.body ?? ({} as ChatBody)
  const { apiKey, model } = body
  const baseUrl = normalizeBaseUrl(body.baseUrl)

  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(400).send({ error: ApiErrorCodes.missing_api_key })
  }
  if (!model || typeof model !== 'string') {
    return reply.status(400).send({ error: ApiErrorCodes.missing_model })
  }

  const convId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (convId && !isValidConversationId(convId)) {
    return reply.status(400).send({ error: ApiErrorCodes.invalid_conversation_id })
  }
  const userText = typeof body.userText === 'string' ? body.userText : ''
  let messages: ChatMessage[]
  let estimatedTokens: number | undefined
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
      contextLength: body.contextLength,
      tokenModel: model,
      promptsDoc,
    })
    if ('error' in built) {
      return reply.status(built.status).send({ error: built.error })
    }
    messages = built.messages
    estimatedTokens = built.estimatedTokens
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

  const persistParams =
    convId && userText.trim()
      ? {
          conversationId: convId,
          userText: userText.trim(),
          model: model.trim() || undefined,
          assembledMessages: messages,
          regenerateTurnOrdinal,
          estimatedTokens,
        }
      : null

  const wantStream = Boolean(body.stream)
  const payload = buildUpstreamPayload({ ...body, messages, stream: wantStream })
  const url = `${baseUrl}/chat/completions`
  const upstreamStartedAt = performance.now()

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

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

    const tap = new Transform({
      transform(chunk, _enc, cb) {
        sseBuffer += chunk.toString('utf8')
        const parts = sseBuffer.split('\n')
        sseBuffer = parts.pop() ?? ''
        for (const line of parts) {
          const d = parseSseDataLine(line)
          if (!d) continue
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
        void persistTurnAfterModelReply({
          ...persistParams,
          assistantContent: accContent,
          assistantReasoning: accReasoning.trim() || undefined,
          durationMs: Math.round(performance.now() - upstreamStartedAt),
          estimatedTokens: persistParams.estimatedTokens,
          completionTokens: accCompletionTokens,
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

  let persist: Awaited<ReturnType<typeof persistTurnAfterModelReply>> | undefined
  if (persistParams && content.trim()) {
    persist = await persistTurnAfterModelReply({
      ...persistParams,
      assistantContent: content,
      assistantReasoning: reasoning,
      durationMs: Math.round(performance.now() - upstreamStartedAt),
      estimatedTokens: persistParams.estimatedTokens,
      completionTokens,
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
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
