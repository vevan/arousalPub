/**
 * SillyTavern 聊天记录 JSONL → arousalPub TurnRecord 批次。
 */

import {
  buildReceiveRuntime,
  importTurnsToEmptyConversation,
  type TurnReceive,
} from './chat-storage.js'

export interface StChatMessage {
  name?: string
  is_user?: boolean
  is_system?: boolean
  send_date?: string
  mes?: string
  gen_started?: string
  gen_finished?: string
  extra?: {
    reasoning?: string
  }
  chat_metadata?: unknown
}

export interface ParsedStChatTurn {
  turnOrdinal: number
  userText: string
  assistantContent: string
  reasoning?: string
  durationMs?: number
  createdAt?: string
}

export interface StChatParseResult {
  turns: ParsedStChatTurn[]
  openingPreview: string
  warnings: string[]
  suggestedTitle: string
}

export interface StChatPreview {
  turnCount: number
  openingPreview: string
  warnings: string[]
  suggestedTitle: string
}

function isChatMetadataLine(obj: Record<string, unknown>): boolean {
  return obj.chat_metadata != null && typeof obj.mes !== 'string'
}

function parseDurationMs(
  genStarted?: string,
  genFinished?: string,
): number | undefined {
  if (typeof genStarted !== 'string' || typeof genFinished !== 'string')
    return undefined
  const a = Date.parse(genStarted)
  const b = Date.parse(genFinished)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return undefined
  return b - a
}

/**
 * 从 ST 完整消息 JSON 中仅提取导入所需字段。
 * 原始对象（含 swipes / continueHistory / qvink_memory 等）立刻可被 GC 回收。
 */
function extractImportFields(obj: Record<string, unknown>): StChatMessage {
  let reasoning: string | undefined
  const extra = obj.extra
  if (extra && typeof extra === 'object') {
    const r = (extra as { reasoning?: unknown }).reasoning
    if (typeof r === 'string' && r.trim()) reasoning = r.trim()
  }
  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    is_user: typeof obj.is_user === 'boolean' ? obj.is_user : undefined,
    is_system:
      typeof obj.is_system === 'boolean' ? obj.is_system : undefined,
    mes: typeof obj.mes === 'string' ? (obj.mes as string) : undefined,
    send_date: typeof obj.send_date === 'string'
      ? (obj.send_date as string)
      : undefined,
    gen_started: typeof obj.gen_started === 'string'
      ? (obj.gen_started as string)
      : undefined,
    gen_finished: typeof obj.gen_finished === 'string'
      ? (obj.gen_finished as string)
      : undefined,
    extra: reasoning ? { reasoning } : undefined,
  }
}

function messageText(msg: StChatMessage): string {
  return typeof msg.mes === 'string' ? msg.mes : ''
}

function assistantReasoning(msg: StChatMessage): string | undefined {
  const r = msg.extra?.reasoning
  return typeof r === 'string' && r.trim() ? r.trim() : undefined
}

function parseStChatMessages(messages: StChatMessage[]): StChatParseResult {
  const warnings: string[] = []
  const turns: ParsedStChatTurn[] = []
  let openingPreview = ''
  let suggestedTitle = 'ST 导入对话'

  if (messages.length === 0) {
    return {
      turns,
      openingPreview,
      warnings: ['未找到可导入的消息'],
      suggestedTitle,
    }
  }

  let startIdx = 0
  const first = messages[0]!
  if (first.is_user !== true && first.is_system === true) {
    const openingText = messageText(first)
    if (openingText.trim()) {
      openingPreview = openingText.slice(0, 200)
      turns.push({
        turnOrdinal: 0,
        userText: '',
        assistantContent: openingText,
        reasoning: assistantReasoning(first),
        durationMs: parseDurationMs(first.gen_started, first.gen_finished),
        createdAt:
          typeof first.send_date === 'string' && first.send_date.trim()
            ? first.send_date.trim()
            : undefined,
      })
    } else {
      warnings.push('首条助手消息为空，已跳过开场')
    }
    startIdx = 1
  }

  let pendingUser: { text: string; createdAt?: string } | null = null
  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i]!
    const text = messageText(msg)
    if (msg.is_user === true) {
      if (pendingUser !== null) {
        warnings.push(`第 ${i + 1} 条前存在未配对的用户消息，已覆盖`)
      }
      pendingUser = {
        text,
        createdAt:
          typeof msg.send_date === 'string' && msg.send_date.trim()
            ? msg.send_date.trim()
            : undefined,
      }
      continue
    }
    if (pendingUser === null) {
      warnings.push(`第 ${i + 1} 条助手消息无对应用户消息，已跳过`)
      continue
    }
    const turnOrdinal = turns.length
    turns.push({
      turnOrdinal,
      userText: pendingUser.text,
      assistantContent: text,
      reasoning: assistantReasoning(msg),
      durationMs: parseDurationMs(msg.gen_started, msg.gen_finished),
      createdAt:
        typeof msg.send_date === 'string' && msg.send_date.trim()
          ? msg.send_date.trim()
          : pendingUser.createdAt,
    })
    pendingUser = null
    if (suggestedTitle === 'ST 导入对话') {
      const name = typeof msg.name === 'string' ? msg.name.trim() : ''
      if (name) suggestedTitle = `与 ${name} 的对话`
    }
  }
  if (pendingUser !== null) {
    warnings.push('末尾存在未配对的用户消息，已忽略')
  }
  return { turns, openingPreview, warnings, suggestedTitle }
}

// ─── 行读取器（供流式 preview / parse 共用） ───

async function* readLinesFromStream(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<{ lineNo: number; line: string }> {
  let buffer = ''
  let lineNo = 0
  for await (const rawChunk of stream) {
    buffer +=
      typeof rawChunk === 'string'
        ? rawChunk
        : Buffer.from(rawChunk as Buffer).toString('utf8')
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      lineNo++
      const line = buffer.slice(0, nl).replace(/\r$/, '').trim()
      buffer = buffer.slice(nl + 1)
      if (line) yield { lineNo, line }
      nl = buffer.indexOf('\n')
    }
  }
  const tail = buffer.trim()
  if (tail) {
    lineNo++
    yield { lineNo, line: tail }
  }
}

// ─── 小文件文本接口（测试 / JSON body） ───

/** 按行解析 JSONL 文本（preview / 小文件 import） */
export function parseStChatJsonl(text: string): StChatParseResult {
  const warnings: string[] = []
  const messages: StChatMessage[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      warnings.push(`第 ${i + 1} 行 JSON 无效，已跳过`)
      continue
    }
    if (isChatMetadataLine(obj)) continue
    if (typeof obj.mes !== 'string') {
      warnings.push(`第 ${i + 1} 行缺少 mes 字段，已跳过`)
      continue
    }
    messages.push(extractImportFields(obj))
  }
  const parsed = parseStChatMessages(messages)
  return {
    ...parsed,
    warnings: [...warnings, ...parsed.warnings],
  }
}

export function previewStChatImport(text: string): StChatPreview {
  const parsed = parseStChatJsonl(text)
  return {
    turnCount: parsed.turns.length,
    openingPreview: parsed.openingPreview,
    warnings: parsed.warnings,
    suggestedTitle: parsed.suggestedTitle,
  }
}

// ─── 流式接口（大文件 multipart） ───

/**
 * 流式 preview：逐行读取统计轮数，**不保留消息体 / turn 数组**。
 * 峰值内存仅取决于单行 JSON 大小，适合任意大小的 JSONL。
 */
export async function streamPreviewStChat(
  stream: NodeJS.ReadableStream,
): Promise<StChatPreview> {
  let turnCount = 0
  let openingPreview = ''
  let suggestedTitle = 'ST 导入对话'
  const warnings: string[] = []
  let isFirst = true
  let pendingUser = false

  for await (const { lineNo, line } of readLinesFromStream(stream)) {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      warnings.push(`第 ${lineNo} 行 JSON 无效，已跳过`)
      continue
    }
    if (isChatMetadataLine(obj)) continue
    if (typeof obj.mes !== 'string') {
      warnings.push(`第 ${lineNo} 行缺少 mes 字段，已跳过`)
      continue
    }

    const isUser = obj.is_user === true
    const isSystem = obj.is_system === true
    const mes = obj.mes as string

    if (isFirst && !isUser && isSystem) {
      isFirst = false
      if (mes.trim()) {
        openingPreview = mes.slice(0, 200)
        turnCount++
      } else {
        warnings.push('首条助手消息为空，已跳过开场')
      }
      continue
    }
    isFirst = false

    if (isUser) {
      if (pendingUser) {
        warnings.push(`第 ${lineNo} 条前存在未配对的用户消息，已覆盖`)
      }
      pendingUser = true
    } else {
      if (!pendingUser) {
        warnings.push(`第 ${lineNo} 条助手消息无对应用户消息，已跳过`)
      } else {
        turnCount++
        pendingUser = false
        if (suggestedTitle === 'ST 导入对话') {
          const name =
            typeof obj.name === 'string' ? (obj.name as string).trim() : ''
          if (name) suggestedTitle = `与 ${name} 的对话`
        }
      }
    }
  }
  if (pendingUser) warnings.push('末尾存在未配对的用户消息，已忽略')

  return { turnCount, openingPreview, warnings, suggestedTitle }
}

/**
 * 流式解析 JSONL → ParsedStChatTurn[]。
 * 每行仅提取 6 个字段（extractImportFields），原始对象随即释放。
 */
export async function streamParseStChat(
  stream: NodeJS.ReadableStream,
): Promise<StChatParseResult> {
  const warnings: string[] = []
  const turns: ParsedStChatTurn[] = []
  let openingPreview = ''
  let suggestedTitle = 'ST 导入对话'
  let isFirst = true
  let pendingUser: { text: string; createdAt?: string } | null = null

  for await (const { lineNo, line } of readLinesFromStream(stream)) {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      warnings.push(`第 ${lineNo} 行 JSON 无效，已跳过`)
      continue
    }
    if (isChatMetadataLine(obj)) continue
    if (typeof obj.mes !== 'string') {
      warnings.push(`第 ${lineNo} 行缺少 mes 字段，已跳过`)
      continue
    }
    const msg = extractImportFields(obj)
    const text = messageText(msg)

    if (isFirst) {
      isFirst = false
      if (msg.is_user !== true && msg.is_system === true) {
        if (text.trim()) {
          openingPreview = text.slice(0, 200)
          turns.push({
            turnOrdinal: 0,
            userText: '',
            assistantContent: text,
            reasoning: assistantReasoning(msg),
            durationMs: parseDurationMs(msg.gen_started, msg.gen_finished),
            createdAt:
              typeof msg.send_date === 'string' && msg.send_date.trim()
                ? msg.send_date.trim()
                : undefined,
          })
        } else {
          warnings.push('首条助手消息为空，已跳过开场')
        }
        continue
      }
    }

    if (msg.is_user === true) {
      if (pendingUser !== null) {
        warnings.push(`第 ${lineNo} 条前存在未配对的用户消息，已覆盖`)
      }
      pendingUser = {
        text,
        createdAt:
          typeof msg.send_date === 'string' && msg.send_date.trim()
            ? msg.send_date.trim()
            : undefined,
      }
      continue
    }

    if (pendingUser === null) {
      warnings.push(`第 ${lineNo} 条助手消息无对应用户消息，已跳过`)
      continue
    }

    turns.push({
      turnOrdinal: turns.length,
      userText: pendingUser.text,
      assistantContent: text,
      reasoning: assistantReasoning(msg),
      durationMs: parseDurationMs(msg.gen_started, msg.gen_finished),
      createdAt:
        typeof msg.send_date === 'string' && msg.send_date.trim()
          ? msg.send_date.trim()
          : pendingUser.createdAt,
    })
    pendingUser = null
    if (suggestedTitle === 'ST 导入对话') {
      const name = typeof msg.name === 'string' ? msg.name.trim() : ''
      if (name) suggestedTitle = `与 ${name} 的对话`
    }
  }
  if (pendingUser !== null) {
    warnings.push('末尾存在未配对的用户消息，已忽略')
  }

  return { turns, openingPreview, warnings, suggestedTitle }
}

/** 流式导入：stream → parse → importTurnsToEmptyConversation */
export async function importStChatFromStream(params: {
  conversationId: string
  speakerCharacterId: string
  stream: NodeJS.ReadableStream
}): Promise<{ turnCount: number; warnings: string[] } | null> {
  const parsed = await streamParseStChat(params.stream)
  if (parsed.turns.length === 0) return null
  const speaker = params.speakerCharacterId.trim()
  if (!speaker) return null

  const used = new Set<string>()
  const imported = parsed.turns.map((t) => {
    const receives: TurnReceive[] = [
      {
        id: '',
        content: t.assistantContent,
        ...(t.reasoning ? { reasoning: t.reasoning } : {}),
        runtime: buildReceiveRuntime({ durationMs: t.durationMs }),
      },
    ]
    return {
      turnOrdinal: t.turnOrdinal,
      userText: t.userText,
      receives,
      activeReceiveIndex: 0,
      createdAt: t.createdAt,
    }
  })

  const result = await importTurnsToEmptyConversation({
    conversationId: params.conversationId,
    speakerCharacterId: speaker,
    turns: imported,
    usedEntityIds: used,
  })
  if (!result) return null
  return { turnCount: result.turnCount, warnings: parsed.warnings }
}
