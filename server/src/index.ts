import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { generateShortId } from './short-id.js'
import { isValidShortId } from './short-id.js'
import { Readable, Transform } from 'node:stream'
import {
  assertValidPresets,
  readApiSettingsFromFile,
  writeApiSettingsToFile,
  type ApiPreset,
  type ApiSettingsDocument,
} from './api-settings-file.js'
import {
  createConversationStub,
  deleteConversation,
  readChatList,
  readConversationIndex,
  readTailChunk,
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
import { ensureDataSkeleton } from './config.js'
import {
  readUserPreferencesDocument,
  updateGlobalHistorySettings,
  updateGlobalLorebookSettings,
  updateGlobalMemorySettings,
  updateGlobalEmbeddingApiSettings,
} from './user-preferences-file.js'
import { normalizeEmbeddingDimensions } from './embedding-api-settings.js'
import {
  isValidConversationId,
} from './conversation-id.js'
import { enterRequestUser, userIdFromRequest } from './user-context.js'
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
import { parseSseDataLine } from './sse-assistant.js'
import { isPngBuffer } from './character-png.js'
import {
  cardFromNewCharacterForm,
  deleteCharacterFile,
  importCharacterCard,
  importCharacterCardPng,
  importCharacterCardWithPortrait,
  listCharacterSummaries,
  normalizeImportCard,
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
  dry?: number | null
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
    dry,
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
  if (dry !== undefined && dry !== null) payload.dry = dry
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
    return { ok: false, error: 'messages 必须为非空数组' }
  }
  for (const m of messages) {
    if (
      !m ||
      typeof (m as ChatMessage).content !== 'string' ||
      !['system', 'user', 'assistant'].includes((m as ChatMessage).role)
    ) {
      return { ok: false, error: 'messages 项须为 { role, content }' }
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

app.get('/health', async () => ({ ok: true as const }))

app.get('/api/chat/index', async (_request, reply) => {
  try {
    const list = await readChatList()
    return list
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取会话列表失败' })
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
      return reply.status(400).send({ error: '缺少 conversationId' })
    }
    if (!isValidConversationId(b.conversationId)) {
      return reply.status(400).send({ error: 'conversationId 格式无效' })
    }
    const existing = await readConversationIndex(b.conversationId)
    if (existing) {
      return reply.status(409).send({ error: '会话已存在' })
    }
    try {
      const idx = await createConversationStub(
        b.conversationId,
        typeof b.title === 'string' ? b.title : '新对话',
      )
      return { ok: true as const, index: idx }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '创建会话失败' })
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
      return reply.status(400).send({ error: '无效 id' })
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
          error:
            '须提供 title、promptDebug.maxStored、characterIds、promptPresetId、lorebookIds、lorebookSettings、historySettings、memorySettings、userCharacterId 和/或 userName',
        })
    }
    let idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: '会话不存在' })
    if (hasTitle) {
      const next = await updateConversationTitle(id, b.title as string)
      if (!next) return reply.status(404).send({ error: '会话不存在' })
      idx = next
    }
    if (hasPromptDebug) {
      const m = (pd as { maxStored: number }).maxStored
      const next = await updateConversationPromptDebugMax(id, m)
      if (!next) return reply.status(404).send({ error: '会话不存在' })
      idx = next
    }
    if (hasCharIds) {
      const raw = b.characterIds as unknown[]
      if (!raw.every((x) => typeof x === 'string')) {
        return reply.status(400).send({ error: 'characterIds 须为字符串数组' })
      }
      const next = await updateConversationCharacterBindings(id, raw)
      if (!next) return reply.status(404).send({ error: '会话不存在' })
      idx = next
    }
    if (hasPromptPreset) {
      const raw = b.promptPresetId
      if (raw !== null && typeof raw !== 'string') {
        return reply.status(400).send({ error: 'promptPresetId 须为字符串或 null' })
      }
      const next = await updateConversationPromptPresetId(
        id,
        raw === null ? null : (raw as string),
      )
      if (!next) return reply.status(404).send({ error: '会话不存在' })
      idx = next
    }
    if (hasLorebookIds) {
      const raw = b.lorebookIds as unknown[]
      if (!raw.every((x) => typeof x === 'string')) {
        return reply.status(400).send({ error: 'lorebookIds 须为字符串数组' })
      }
      const next = await updateConversationLorebookIds(id, raw)
      if (!next) return reply.status(404).send({ error: '会话不存在' })
      idx = next
    }
    if (hasLorebookSettings) {
      const raw = b.lorebookSettings
      if (raw === null) {
        const next = await clearConversationLorebookSettings(id)
        if (!next) return reply.status(404).send({ error: '会话不存在' })
        idx = next
      } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return reply.status(400).send({ error: 'lorebookSettings 须为对象或 null' })
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
              .send({ error: 'lorebookSettings.recursiveEnabled 须为布尔' })
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
              .send({ error: 'lorebookSettings.maxRecursionDepth 须为数字' })
          }
          patch.maxRecursionDepth = d
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'vectorEnabled')) {
          if (typeof (raw as { vectorEnabled?: unknown }).vectorEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: 'lorebookSettings.vectorEnabled 须为布尔' })
          }
          patch.vectorEnabled = (raw as { vectorEnabled: boolean }).vectorEnabled
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'vectorTopK')) {
          const d = (raw as { vectorTopK?: unknown }).vectorTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: 'lorebookSettings.vectorTopK 须为数字' })
          }
          patch.vectorTopK = d
        }
        if (Object.keys(patch).length === 0) {
          return reply.status(400).send({
            error:
              'lorebookSettings 须含 recursiveEnabled、maxRecursionDepth、vectorEnabled 和/或 vectorTopK',
          })
        }
        const next = await updateConversationLorebookSettings(id, patch)
        if (!next) return reply.status(404).send({ error: '会话不存在' })
        idx = next
      }
    }
    if (hasHistorySettings) {
      const raw = b.historySettings
      if (raw === null) {
        const next = await clearConversationHistorySettings(id)
        if (!next) return reply.status(404).send({ error: '会话不存在' })
        idx = next
      } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return reply.status(400).send({ error: 'historySettings 须为对象或 null' })
      } else {
        const patch: {
          limitEnabled?: boolean
          maxTurns?: number
        } = {}
        if (Object.prototype.hasOwnProperty.call(raw, 'limitEnabled')) {
          if (typeof (raw as { limitEnabled?: unknown }).limitEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: 'historySettings.limitEnabled 须为布尔' })
          }
          patch.limitEnabled = (raw as { limitEnabled: boolean }).limitEnabled
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'maxTurns')) {
          const d = (raw as { maxTurns?: unknown }).maxTurns
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: 'historySettings.maxTurns 须为数字' })
          }
          patch.maxTurns = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'limitEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'maxTurns')
        ) {
          return reply.status(400).send({
            error: 'historySettings 须含 limitEnabled 和/或 maxTurns',
          })
        }
        const next = await updateConversationHistorySettings(id, patch)
        if (!next) return reply.status(404).send({ error: '会话不存在' })
        idx = next
      }
    }
    if (hasMemorySettings) {
      const raw = b.memorySettings
      if (raw === null) {
        const next = await clearConversationMemorySettings(id)
        if (!next) return reply.status(404).send({ error: '会话不存在' })
        idx = next
      } else if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return reply.status(400).send({ error: 'memorySettings 须为对象或 null' })
      } else {
        const patch: {
          memoryEnabled?: boolean
          memoryTopK?: number
        } = {}
        if (Object.prototype.hasOwnProperty.call(raw, 'memoryEnabled')) {
          if (typeof (raw as { memoryEnabled?: unknown }).memoryEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: 'memorySettings.memoryEnabled 须为布尔' })
          }
          patch.memoryEnabled = (raw as { memoryEnabled: boolean }).memoryEnabled
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'memoryTopK')) {
          const d = (raw as { memoryTopK?: unknown }).memoryTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: 'memorySettings.memoryTopK 须为数字' })
          }
          patch.memoryTopK = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'memoryEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'memoryTopK')
        ) {
          return reply.status(400).send({
            error: 'memorySettings 须含 memoryEnabled 和/或 memoryTopK',
          })
        }
        const next = await updateConversationMemorySettings(id, patch)
        if (!next) return reply.status(404).send({ error: '会话不存在' })
        idx = next
      }
    }
    if (hasUserCharacterId) {
      const raw = b.userCharacterId
      if (raw !== null && typeof raw !== 'string') {
        return reply.status(400).send({ error: 'userCharacterId 须为字符串或 null' })
      }
      const next = await updateConversationUserCharacterId(
        id,
        raw === null ? null : (raw as string),
      )
      if (!next) return reply.status(404).send({ error: '会话不存在' })
      idx = next
    }
    if (hasUserName) {
      const raw = b.userName
      if (raw !== null && typeof raw !== 'string') {
        return reply.status(400).send({ error: 'userName 须为字符串或 null' })
      }
      const next = await updateConversationUserName(
        id,
        raw === null ? null : (raw as string),
      )
      if (!next) return reply.status(404).send({ error: '会话不存在' })
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
      return reply.status(400).send({ error: '无效 id' })
    }
    try {
      const ok = await deleteConversation(id)
      if (!ok) {
        return reply.status(404).send({ error: '会话不存在或删除失败' })
      }
      return { ok: true as const }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '删除会话失败' })
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
      return reply.status(400).send({ error: '无效 id' })
    }
    const b = request.body ?? {}
    if (!Array.isArray(b.receives) || b.receives.length === 0) {
      return reply.status(400).send({ error: 'receives 须为非空数组' })
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
        return reply.status(400).send({ error: 'receives 项格式错误' })
      }
      const content = raw.content
      if (typeof content !== 'string' || !content.trim()) {
        return reply.status(400).send({ error: 'receives.content 须为非空字符串' })
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
        if (!idx) return reply.status(404).send({ error: '会话不存在' })
        if (idx.headChunkFile) {
          return reply.status(409).send({ error: '首条已落盘' })
        }
        return reply.status(500).send({ error: '开场落盘失败' })
      }
      return { ok: true as const, index: result.index }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '写入开场失败' })
    }
  },
)

interface FirstTurnBody {
  userContent: string
  assistantContent: string
  assistantReasoning?: string
  model?: string
  /** 与本次请求 /api/chat 的 messages 一致，写入 chat-prompt.json */
  debugPrompt?: unknown
}

app.post<{ Params: { id: string }; Body: FirstTurnBody }>(
  '/api/chat/conversations/:id/first-turn',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const b = request.body
    if (!b || typeof b.userContent !== 'string' || !b.userContent.trim()) {
      return reply.status(400).send({ error: '缺少 userContent' })
    }
    if (
      typeof b.assistantContent !== 'string' ||
      !b.assistantContent.trim()
    ) {
      return reply.status(400).send({ error: '缺少 assistantContent' })
    }
    try {
      const ar =
        typeof b.assistantReasoning === 'string'
          ? b.assistantReasoning.trim()
          : ''
      const result = await saveFirstTurn({
        conversationId: id,
        userText: b.userContent.trim(),
        assistantText: b.assistantContent.trim(),
        reasoning: ar || undefined,
        model: typeof b.model === 'string' ? b.model : undefined,
        debugPrompt: b.debugPrompt,
      })
      if (!result) {
        const idx = await readConversationIndex(id)
        if (!idx) return reply.status(404).send({ error: '会话不存在' })
        if (idx.headChunkFile) {
          return reply.status(409).send({ error: '首条已落盘' })
        }
        return reply.status(500).send({ error: '落盘失败' })
      }
      return { ok: true as const, index: result.index }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '写入对话失败' })
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
      return reply.status(400).send({ error: '无效 id' })
    }
    const ord = Number.parseInt(request.params.turnOrdinal, 10)
    if (!Number.isInteger(ord) || ord < 0) {
      return reply.status(400).send({ error: '无效 turnOrdinal' })
    }
    const b = request.body ?? {}
    if (typeof b.userText !== 'string') {
      return reply.status(400).send({ error: 'userText 须为字符串' })
    }
    if (!Array.isArray(b.receives) || b.receives.length === 0) {
      return reply.status(400).send({ error: 'receives 须为非空数组' })
    }
    const mapped: TurnReceive[] = []
    for (const r of b.receives) {
      if (!r || typeof r !== 'object') {
        return reply.status(400).send({ error: 'receives 项格式错误' })
      }
      const o = r as {
        id?: unknown
        content?: unknown
        reasoning?: unknown
        durationMs?: unknown
        estimatedTokens?: unknown
      }
      if (typeof o.id !== 'string' || typeof o.content !== 'string') {
        return reply.status(400).send({ error: 'receives 项须含 id、content 字符串' })
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
      mapped.push(rec)
    }
    if (typeof b.activeReceiveIndex !== 'number' || !Number.isInteger(b.activeReceiveIndex)) {
      return reply.status(400).send({ error: 'activeReceiveIndex 须为整数' })
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
        return reply.status(404).send({ error: '未找到该轮或尚无落盘 chunk' })
      }
      return { ok: true as const }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '更新失败' })
    }
  },
)

app.delete<{ Params: { id: string; turnOrdinal: string } }>(
  '/api/chat/conversations/:id/turns/:turnOrdinal',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const ord = Number.parseInt(request.params.turnOrdinal, 10)
    if (!Number.isInteger(ord) || ord < 0) {
      return reply.status(400).send({ error: '无效 turnOrdinal' })
    }
    try {
      const ok = await removeTurnAtOrdinalInTailChunk(id, ord)
      if (!ok) {
        return reply.status(404).send({ error: '无法删除该轮' })
      }
      return { ok: true as const }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '删除失败' })
    }
  },
)

app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id/messages',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const chunk = await readTailChunk(id)
    if (!chunk?.turns?.length) {
      return { turns: [] as MessagesTurnDto[] }
    }
    const turns: MessagesTurnDto[] = chunk.turns.map((t, i) => {
      const activeUserText = getTurnUserText(t)
      const recs = (t.receives ?? []).map((r) => {
        const base: {
          id: string
          content: string
          reasoning?: string
          durationMs?: number
          estimatedTokens?: number
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
      return reply.status(400).send({ error: '无效 id' })
    }
    const b = request.body ?? {}
    const promptsDoc = await readPromptsDocument()
    if (!promptsDoc) {
      return reply.status(500).send({ error: '提示词数据不可用' })
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
      return reply.status(400).send({ error: '无效 id' })
    }
    const b = request.body
    if (!b || typeof b.userText !== 'string' || !b.userText.trim()) {
      return reply.status(400).send({ error: '缺少 userText' })
    }
    if (!Array.isArray(b.receives) || b.receives.length === 0) {
      return reply.status(400).send({ error: 'receives 须为非空数组' })
    }
    const mapped: TurnReceive[] = []
    for (let i = 0; i < b.receives.length; i++) {
      const r = b.receives[i]
      if (!r || typeof r.id !== 'string' || typeof r.content !== 'string') {
        return reply.status(400).send({ error: 'receives 项格式错误' })
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
      return reply.status(400).send({ error: 'activeReceiveIndex 须为整数' })
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
        return reply.status(404).send({ error: '会话不存在或尚无尾块' })
      }
      return { ok: true as const }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '追加轮次失败' })
    }
  },
)

app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: '会话不存在' })
    return idx
  },
)

app.post<{ Params: { id: string }; Querystring: { stream?: string } }>(
  '/api/chat/conversations/:id/memory/rebuild',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: '会话不存在' })
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
      return reply.status(500).send({ ok: false, error: '重建远期记忆索引失败' })
    }
  },
)

/** 调试：读取会话目录下 chat-prompt.json（仅最近 N 条 prompt 快照） */
app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id/chat-prompt',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidConversationId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: '会话不存在' })
    const file = await readChatPromptFile(id)
    return file
  },
)

app.get('/api/user-preferences', async (_request, reply) => {
  try {
    return await readUserPreferencesDocument()
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取用户偏好失败' })
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
}

app.patch<{ Body: PatchUserPreferencesBody }>(
  '/api/user-preferences',
  async (request, reply) => {
    const b = request.body ?? {}
    const hasLore = b.lorebook && typeof b.lorebook === 'object'
    const hasHist = b.history && typeof b.history === 'object'
    const hasMem = b.memory && typeof b.memory === 'object'
    const hasEmbed = b.embeddingApi && typeof b.embeddingApi === 'object'
    if (!hasLore && !hasHist && !hasMem && !hasEmbed) {
      return reply.status(400).send({
        error: '须提供 lorebook、history、memory 和/或 embeddingApi 对象',
      })
    }
    try {
      let lorebook
      let history
      let memory
      let embeddingApi
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
              .send({ error: 'lorebook.recursiveEnabled 须为布尔' })
          }
          patch.recursiveEnabled = b.lorebook!.recursiveEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'maxRecursionDepth')) {
          const d = b.lorebook!.maxRecursionDepth
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply
              .status(400)
              .send({ error: 'lorebook.maxRecursionDepth 须为数字' })
          }
          patch.maxRecursionDepth = d
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'vectorEnabled')) {
          if (typeof b.lorebook!.vectorEnabled !== 'boolean') {
            return reply
              .status(400)
              .send({ error: 'lorebook.vectorEnabled 须为布尔' })
          }
          patch.vectorEnabled = b.lorebook!.vectorEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.lorebook, 'vectorTopK')) {
          const d = b.lorebook!.vectorTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: 'lorebook.vectorTopK 须为数字' })
          }
          patch.vectorTopK = d
        }
        if (Object.keys(patch).length === 0) {
          return reply.status(400).send({
            error:
              'lorebook 须含 recursiveEnabled、maxRecursionDepth、vectorEnabled 和/或 vectorTopK',
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
              .send({ error: 'history.limitEnabled 须为布尔' })
          }
          patch.limitEnabled = b.history!.limitEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.history, 'maxTurns')) {
          const d = b.history!.maxTurns
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: 'history.maxTurns 须为数字' })
          }
          patch.maxTurns = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'limitEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'maxTurns')
        ) {
          return reply.status(400).send({
            error: 'history 须含 limitEnabled 和/或 maxTurns',
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
              .send({ error: 'memory.memoryEnabled 须为布尔' })
          }
          patch.memoryEnabled = b.memory!.memoryEnabled
        }
        if (Object.prototype.hasOwnProperty.call(b.memory, 'memoryTopK')) {
          const d = b.memory!.memoryTopK
          if (typeof d !== 'number' || !Number.isFinite(d)) {
            return reply.status(400).send({ error: 'memory.memoryTopK 须为数字' })
          }
          patch.memoryTopK = d
        }
        if (
          !Object.prototype.hasOwnProperty.call(patch, 'memoryEnabled') &&
          !Object.prototype.hasOwnProperty.call(patch, 'memoryTopK')
        ) {
          return reply.status(400).send({
            error: 'memory 须含 memoryEnabled 和/或 memoryTopK',
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
            return reply.status(400).send({ error: 'embeddingApi.baseUrl 须为字符串' })
          }
          patch.baseUrl = raw.baseUrl
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'apiKey')) {
          if (typeof raw.apiKey !== 'string') {
            return reply.status(400).send({ error: 'embeddingApi.apiKey 须为字符串' })
          }
          patch.apiKey = raw.apiKey
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'apiKeyId')) {
          const kid = raw.apiKeyId
          if (kid !== null && typeof kid !== 'string') {
            return reply.status(400).send({ error: 'embeddingApi.apiKeyId 须为字符串或 null' })
          }
          patch.apiKeyId = kid
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'embeddingModel')) {
          if (typeof raw.embeddingModel !== 'string') {
            return reply
              .status(400)
              .send({ error: 'embeddingApi.embeddingModel 须为字符串' })
          }
          patch.embeddingModel = raw.embeddingModel
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'embeddingDimensions')) {
          const dim = raw.embeddingDimensions
          if (dim !== null && typeof dim !== 'number') {
            return reply
              .status(400)
              .send({ error: 'embeddingApi.embeddingDimensions 须为数字或 null' })
          }
          patch.embeddingDimensions =
            dim === null ? null : normalizeEmbeddingDimensions(dim)
        }
        if (Object.keys(patch).length === 0) {
          return reply.status(400).send({
            error:
              'embeddingApi 须含 baseUrl、apiKey、apiKeyId、embeddingModel 和/或 embeddingDimensions',
          })
        }
        embeddingApi = await updateGlobalEmbeddingApiSettings(patch)
      }
      const doc = await readUserPreferencesDocument()
      return {
        ok: true as const,
        lorebook: lorebook ?? doc.lorebook,
        history: history ?? doc.history,
        memory: memory ?? doc.memory,
        embeddingApi: embeddingApi ?? doc.embeddingApi,
        savedAt: doc.savedAt,
      }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '保存用户偏好失败' })
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
      return reply.status(500).send({ ok: false, error: 'Embedding 测试失败' })
    }
  },
)

app.get('/api/settings', async (_request, reply) => {
  try {
    const data = await readApiSettingsFromFile()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取设置失败' })
  }
})

type SettingsPutBody = Pick<ApiSettingsDocument, 'activePresetId' | 'presets'>

app.put<{ Body: SettingsPutBody }>('/api/settings', async (request, reply) => {
  const b = request.body
  if (!b || typeof b !== 'object') {
    return reply.status(400).send({ error: '无效请求体' })
  }
  if (!Array.isArray(b.presets)) {
    return reply.status(400).send({ error: '缺少 presets 数组' })
  }
  try {
    assertValidPresets(b.presets as ApiPreset[])
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : '预设校验失败',
    })
  }
  const activePresetId =
    typeof b.activePresetId === 'string' ? b.activePresetId : ''
  if (!(b.presets as ApiPreset[]).some((p) => p.id === activePresetId)) {
    return reply.status(400).send({ error: 'activePresetId 与 presets 不匹配' })
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
    return reply.status(500).send({ error: '写入设置失败' })
  }

  return { ok: true as const, savedAt }
})

app.get('/api/prompts', async (_request, reply) => {
  try {
    const data = await readPromptsDocument()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取提示词失败' })
  }
})

app.put('/api/prompts', async (request, reply) => {
  let validated: { activePresetId: string; presets: unknown[] }
  try {
    validated = assertValidPromptsPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : '提示词校验失败',
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
    return reply.status(500).send({ error: '写入提示词失败' })
  }
  return { ok: true as const, savedAt }
})

app.post<{ Body: PromptsAssemblePreviewBody }>(
  '/api/prompts/assemble-preview',
  async (request, reply) => {
    try {
      const doc = await readPromptsDocument()
      if (!doc) {
        return reply.status(500).send({ error: '提示词数据不可用' })
      }
      const result = runPromptsAssemblePreview(doc, request.body ?? {})
      if ('error' in result) {
        return reply.status(400).send({ error: result.error })
      }
      return result
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '预览组装失败' })
    }
  },
)

app.get('/api/lorebooks', async (_request, reply) => {
  try {
    const data = await readLorebooksDocument()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取世界书失败' })
  }
})

app.put('/api/lorebooks', async (request, reply) => {
  let validated: { lorebooks: LorebooksDocument['lorebooks'] }
  try {
    validated = assertValidLorebooksPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : '世界书校验失败',
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
    return reply.status(500).send({ error: '写入世界书失败' })
  }
  return { ok: true as const, savedAt }
})

app.get<{ Params: { id: string } }>(
  '/api/lorebooks/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!LOREBOOK_ID_RE.test(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    try {
      const lb = await readLorebookById(id)
      if (!lb) return reply.status(404).send({ error: '世界书不存在' })
      return lb
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '读取世界书失败' })
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
  try {
    const { items, total } = await listCharacterSummaries({
      offset,
      limit,
      search,
      filter,
    })
    const hasMore = offset + items.length < total
    return { items, total, offset, limit, hasMore }
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取角色库失败' })
  }
})

app.post('/api/characters/import', async (request, reply) => {
  try {
    const card = normalizeImportCard(request.body)
    const doc = await importCharacterCard(card)
    return { ok: true as const, id: doc.id }
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : '导入失败',
    })
  }
})

app.post('/api/characters/import-png', async (request, reply) => {
  try {
    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ error: '缺少文件字段（multipart 字段名 file）' })
    }
    const buf = await file.toBuffer()
    const doc = await importCharacterCardPng(buf)
    return { ok: true as const, id: doc.id }
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : '导入 PNG 失败',
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
        return reply.status(400).send({ error: 'multipart 须包含 payload 字段（JSON 字符串）' })
      }
      let body: unknown
      try {
        body = JSON.parse(payload) as unknown
      } catch {
        return reply.status(400).send({ error: 'payload 须为合法 JSON' })
      }
      const card = cardFromNewCharacterForm(body)
      const doc = await importCharacterCardWithPortrait(card, portraitBuf)
      return { ok: true as const, id: doc.id }
    } catch (e) {
      return reply.status(400).send({
        error: e instanceof Error ? e.message : '创建失败',
      })
    }
  }
  try {
    const card = cardFromNewCharacterForm(request.body)
    const doc = await importCharacterCard(card)
    return { ok: true as const, id: doc.id }
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : '创建失败',
    })
  }
})

app.get<{ Params: { id: string } }>(
  '/api/characters/:id/image',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const buf = await readCharacterPngBuffer(id)
    if (!buf) return reply.status(404).send({ error: '角色不存在或无 PNG' })
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, max-age=60')
      .send(buf)
  },
)

app.post<{ Params: { id: string } }>(
  '/api/characters/:id/portrait',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    try {
      const file = await request.file()
      if (!file) {
        return reply
          .status(400)
          .send({ error: '缺少文件字段（multipart 字段名 portrait）' })
      }
      const buf = await file.toBuffer()
      if (!isPngBuffer(buf)) {
        return reply.status(400).send({ error: '须上传 PNG 图像' })
      }
      const doc = await updateCharacterPortrait(id, buf)
      if (!doc) return reply.status(404).send({ error: '角色不存在' })
      return doc
    } catch (e) {
      app.log.error(e)
      return reply.status(400).send({
        error: e instanceof Error ? e.message : '上传立绘失败',
      })
    }
  },
)

app.patch<{ Params: { id: string }; Body: { card?: unknown } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: '无效 id' })
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
        .send({ error: '请求体须为 JSON 对象，且包含对象字段 card' })
    }
    try {
      const doc = await updateCharacterDocument(
        id,
        body.card as Record<string, unknown>,
      )
      if (!doc) return reply.status(404).send({ error: '角色不存在' })
      return doc
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: '更新角色失败' })
    }
  },
)

app.get<{ Params: { id: string } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const doc = await readCharacterDocument(id)
    if (!doc) return reply.status(404).send({ error: '角色不存在' })
    return doc
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/characters/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!isValidShortId(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const ok = await deleteCharacterFile(id)
    if (!ok) return reply.status(404).send({ error: '角色不存在' })
    return { ok: true as const }
  },
)

app.get('/api/api-keys', async (_request, reply) => {
  try {
    const data = await readApiKeysDocument()
    return data ?? null
  } catch (e) {
    app.log.error(e)
    return reply.status(500).send({ error: '读取 API Keys 失败' })
  }
})

app.put('/api/api-keys', async (request, reply) => {
  let validated: { keys: ApiKeysDocument['keys'] }
  try {
    validated = assertValidApiKeysPayload(request.body)
  } catch (e) {
    return reply.status(400).send({
      error: e instanceof Error ? e.message : 'API Keys 校验失败',
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
    return reply.status(500).send({ error: '写入 API Keys 失败' })
  }
  return { ok: true as const, savedAt }
})

app.post<{ Body: ModelsListBody }>('/api/models', async (request, reply) => {
  const b = request.body ?? ({} as ModelsListBody)
  const apiKey = b.apiKey
  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(400).send({ error: '缺少 apiKey' })
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
      error: '获取模型列表失败',
      status: upstream.status,
      detail: text.slice(0, 1500),
    })
  }

  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    return reply.status(502).send({ error: '上游返回非 JSON' })
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
    return reply.status(400).send({ error: '缺少 apiKey' })
  }
  if (!model || typeof model !== 'string') {
    return reply.status(400).send({ error: '缺少 model' })
  }

  const convId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (convId && !isValidConversationId(convId)) {
    return reply.status(400).send({ error: 'conversationId 格式无效' })
  }
  const userText = typeof body.userText === 'string' ? body.userText : ''
  let messages: ChatMessage[]
  let estimatedTokens: number | undefined
  if (convId) {
    const promptsDoc = await readPromptsDocument()
    if (!promptsDoc) {
      return reply.status(500).send({ error: '提示词数据不可用' })
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
      error: '上游 API 错误',
      status: upstream.status,
      detail: text.slice(0, 2000),
    })
  }

  if (wantStream && upstream.body) {
    reply.header('Content-Type', 'text/event-stream; charset=utf-8')
    reply.header('Cache-Control', 'no-cache')
    reply.header('Connection', 'keep-alive')
    reply.header('X-Accel-Buffering', 'no')

    let sseBuffer = ''
    let accContent = ''
    let accReasoning = ''

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
        }
        cb(null, chunk)
      },
      flush(cb) {
        if (!persistParams || !accContent.trim()) {
          cb()
          return
        }
        void persistTurnAfterModelReply({
          ...persistParams,
          assistantContent: accContent,
          assistantReasoning: accReasoning.trim() || undefined,
          durationMs: Math.round(performance.now() - upstreamStartedAt),
        })
          .then((persist) => {
            if (!persist.ok) {
              request.log.warn({ persist }, 'stream persist failed')
            }
            cb()
          })
          .catch((err) => {
            request.log.error(err, 'stream persist error')
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
    return reply.status(502).send({ error: '上游返回非 JSON' })
  }

  const choices = (data as { choices?: unknown }).choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const msg =
    first && typeof first === 'object' && first !== null && 'message' in first
      ? (first as { message?: { role?: string; content?: string } }).message
      : undefined
  const content = typeof msg?.content === 'string' ? msg.content : ''
  const reasoning = extractReasoningFromMessage(msg)

  let persist: Awaited<ReturnType<typeof persistTurnAfterModelReply>> | undefined
  if (persistParams && content.trim()) {
    persist = await persistTurnAfterModelReply({
      ...persistParams,
      assistantContent: content,
      assistantReasoning: reasoning,
      durationMs: Math.round(performance.now() - upstreamStartedAt),
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
    raw: data,
  })
})

ensureDataSkeleton()

app.addHook('onRequest', (request, _reply, done) => {
  enterRequestUser(userIdFromRequest(request))
  done()
})

const port = Number(process.env.PORT) || 3399
const host = process.env.HOST || '0.0.0.0'

try {
  await app.listen({ port, host })
  app.log.info(`listening on http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
