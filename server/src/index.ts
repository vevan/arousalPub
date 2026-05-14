import cors from '@fastify/cors'
import Fastify from 'fastify'
import { Readable } from 'node:stream'
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
  saveFirstTurn,
  updateConversationTitle,
  updateConversationCharacterBindings,
  updateConversationPromptDebugMax,
  getTurnUserText,
  updateTurnContentInTailChunk,
  type TurnReceive,
} from './chat-storage.js'
import { ensureDataSkeleton } from './config.js'
import {
  assertValidPromptsPayload,
  readPromptsDocument,
  writePromptsDocument,
  type PromptsDocument,
} from './prompts-file.js'
import {
  assertValidApiKeysPayload,
  readApiKeysDocument,
  writeApiKeysDocument,
  type ApiKeysDocument,
} from './api-keys-file.js'

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
  messages: ChatMessage[]
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

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })

app.get('/health', async () => ({ ok: true as const }))

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    if (!uuidRe.test(b.conversationId)) {
      return reply.status(400).send({ error: 'conversationId 须为 UUID' })
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
  /** 调试：chat-prompt.json 保留条数上限，1～200 */
  promptDebug?: { maxStored?: number }
  /** 会话绑定的多张角色卡 id，顺序即主槽、次槽…；传 [] 清空绑定 */
  characterIds?: string[]
}

app.patch<{ Params: { id: string }; Body: PatchConvBody }>(
  '/api/chat/conversations/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!uuidRe.test(id)) {
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
    if (!hasTitle && !hasPromptDebug && !hasCharIds) {
      return reply
        .status(400)
        .send({
          error:
            '须提供 title、promptDebug.maxStored 和/或 characterIds（可为空数组）',
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
    return { ok: true as const, index: idx }
  },
)

app.delete<{ Params: { id: string } }>(
  '/api/chat/conversations/:id',
  async (request, reply) => {
    const id = request.params.id
    if (!uuidRe.test(id)) {
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
    if (!uuidRe.test(id)) {
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
    if (!uuidRe.test(id)) {
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
      const o = r as { id?: unknown; content?: unknown; reasoning?: unknown }
      if (typeof o.id !== 'string' || typeof o.content !== 'string') {
        return reply.status(400).send({ error: 'receives 项须含 id、content 字符串' })
      }
      const rec: TurnReceive = { id: o.id, content: o.content }
      if (typeof o.reasoning === 'string' && o.reasoning.length > 0) {
        rec.reasoning = o.reasoning
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
    if (!uuidRe.test(id)) {
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
    if (!uuidRe.test(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const chunk = await readTailChunk(id)
    if (!chunk?.turns?.length) {
      return { turns: [] as MessagesTurnDto[] }
    }
    const turns: MessagesTurnDto[] = chunk.turns.map((t, i) => {
      const activeUserText = getTurnUserText(t)
      const recs = (t.receives ?? []).map((r) => {
        const base = {
          id: typeof r.id === 'string' ? r.id : '',
          content: typeof r.content === 'string' ? r.content : '',
        }
        const rs =
          typeof r.reasoning === 'string' && r.reasoning.length > 0
            ? r.reasoning
            : undefined
        return rs !== undefined ? { ...base, reasoning: rs } : base
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
    if (!uuidRe.test(id)) {
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
    if (!uuidRe.test(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: '会话不存在' })
    return idx
  },
)

/** 调试：读取会话目录下 chat-prompt.json（仅最近 N 条 prompt 快照） */
app.get<{ Params: { id: string } }>(
  '/api/chat/conversations/:id/chat-prompt',
  async (request, reply) => {
    const id = request.params.id
    if (!uuidRe.test(id)) {
      return reply.status(400).send({ error: '无效 id' })
    }
    const idx = await readConversationIndex(id)
    if (!idx) return reply.status(404).send({ error: '会话不存在' })
    const file = await readChatPromptFile(id)
    return file
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
    version: 2,
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
  const { apiKey, model, messages } = body
  const baseUrl = normalizeBaseUrl(body.baseUrl)

  if (!apiKey || typeof apiKey !== 'string') {
    return reply.status(400).send({ error: '缺少 apiKey' })
  }
  if (!model || typeof model !== 'string') {
    return reply.status(400).send({ error: '缺少 model' })
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return reply.status(400).send({ error: 'messages 必须为非空数组' })
  }

  for (const m of messages) {
    if (
      !m ||
      typeof m.content !== 'string' ||
      !['system', 'user', 'assistant'].includes(m.role)
    ) {
      return reply.status(400).send({ error: 'messages 项须为 { role, content }' })
    }
  }

  const wantStream = Boolean(body.stream)
  const payload = buildUpstreamPayload({ ...body, stream: wantStream })
  const url = `${baseUrl}/chat/completions`

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
    const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream)
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
  const content = msg?.content ?? ''
  const reasoning = extractReasoningFromMessage(msg)

  return reply.send({
    message: {
      role: (msg?.role as ChatRole) ?? 'assistant',
      content: typeof content === 'string' ? content : '',
      ...(reasoning ? { reasoning } : {}),
    },
    raw: data,
  })
})

ensureDataSkeleton()

const port = Number(process.env.PORT) || 3399
const host = process.env.HOST || '0.0.0.0'

try {
  await app.listen({ port, host })
  app.log.info(`listening on http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
