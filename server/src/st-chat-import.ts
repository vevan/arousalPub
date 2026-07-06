/**
 * SillyTavern 聊天记录 JSONL → arousalPub TurnRecord 批次。
 * preview 与 import 共用同一逐行状态机；import 经 session 按 chunk 落盘，峰值内存 ≈ 单 chunk。
 */

import {
  buildReceiveRuntime,
  openConversationImportSession,
  type ImportedTurnBatchItem,
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

function buildParsedTurn(
  partial: Omit<ParsedStChatTurn, 'turnOrdinal'>,
  turnOrdinal: number,
): ParsedStChatTurn {
  return { ...partial, turnOrdinal }
}

function parsedTurnToImportItem(turn: ParsedStChatTurn): ImportedTurnBatchItem {
  const receives: TurnReceive[] = [
    {
      id: '',
      content: turn.assistantContent,
      ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
      runtime: buildReceiveRuntime({ durationMs: turn.durationMs }),
    },
  ]
  return {
    turnOrdinal: turn.turnOrdinal,
    userText: turn.userText,
    receives,
    activeReceiveIndex: 0,
    createdAt: turn.createdAt,
  }
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
      turns.push(
        buildParsedTurn(
          {
            userText: '',
            assistantContent: openingText,
            reasoning: assistantReasoning(first),
            durationMs: parseDurationMs(first.gen_started, first.gen_finished),
            createdAt:
              typeof first.send_date === 'string' && first.send_date.trim()
                ? first.send_date.trim()
                : undefined,
          },
          0,
        ),
      )
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
    turns.push(
      buildParsedTurn(
        {
          userText: pendingUser.text,
          assistantContent: text,
          reasoning: assistantReasoning(msg),
          durationMs: parseDurationMs(msg.gen_started, msg.gen_finished),
          createdAt:
            typeof msg.send_date === 'string' && msg.send_date.trim()
              ? msg.send_date.trim()
              : pendingUser.createdAt,
        },
        turns.length,
      ),
    )
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

// ─── 行读取器（供流式 preview / import 共用） ───

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

interface StChatStreamSink {
  onTurn(turn: ParsedStChatTurn): Promise<void> | void
  onWarning(message: string): void
}

interface StChatStreamMeta {
  openingPreview: string
  suggestedTitle: string
  turnCount: number
}

/** preview 与 import 共用：逐行解析，每完成一轮调用 onTurn（不保留全量 turns） */
async function consumeStChatStream(
  stream: NodeJS.ReadableStream,
  sink: StChatStreamSink,
): Promise<StChatStreamMeta> {
  let openingPreview = ''
  let suggestedTitle = 'ST 导入对话'
  let turnCount = 0
  let isFirst = true
  let pendingUser: { text: string; createdAt?: string } | null = null

  for await (const { lineNo, line } of readLinesFromStream(stream)) {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      sink.onWarning(`第 ${lineNo} 行 JSON 无效，已跳过`)
      continue
    }
    if (isChatMetadataLine(obj)) continue
    if (typeof obj.mes !== 'string') {
      sink.onWarning(`第 ${lineNo} 行缺少 mes 字段，已跳过`)
      continue
    }

    const msg = extractImportFields(obj)
    const text = messageText(msg)

    if (isFirst) {
      isFirst = false
      if (msg.is_user !== true && msg.is_system === true) {
        if (text.trim()) {
          openingPreview = text.slice(0, 200)
          const turn = buildParsedTurn(
            {
              userText: '',
              assistantContent: text,
              reasoning: assistantReasoning(msg),
              durationMs: parseDurationMs(msg.gen_started, msg.gen_finished),
              createdAt:
                typeof msg.send_date === 'string' && msg.send_date.trim()
                  ? msg.send_date.trim()
                  : undefined,
            },
            turnCount,
          )
          await sink.onTurn(turn)
          turnCount++
        } else {
          sink.onWarning('首条助手消息为空，已跳过开场')
        }
        continue
      }
    }

    if (msg.is_user === true) {
      if (pendingUser !== null) {
        sink.onWarning(`第 ${lineNo} 条前存在未配对的用户消息，已覆盖`)
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
      sink.onWarning(`第 ${lineNo} 条助手消息无对应用户消息，已跳过`)
      continue
    }

    const turn = buildParsedTurn(
      {
        userText: pendingUser.text,
        assistantContent: text,
        reasoning: assistantReasoning(msg),
        durationMs: parseDurationMs(msg.gen_started, msg.gen_finished),
        createdAt:
          typeof msg.send_date === 'string' && msg.send_date.trim()
            ? msg.send_date.trim()
            : pendingUser.createdAt,
      },
      turnCount,
    )
    await sink.onTurn(turn)
    turnCount++
    pendingUser = null
    if (suggestedTitle === 'ST 导入对话') {
      const name = typeof msg.name === 'string' ? msg.name.trim() : ''
      if (name) suggestedTitle = `与 ${name} 的对话`
    }
  }

  if (pendingUser !== null) {
    sink.onWarning('末尾存在未配对的用户消息，已忽略')
  }

  if (turnCount === 0) {
    sink.onWarning('未找到可导入的消息')
  }

  return { openingPreview, suggestedTitle, turnCount }
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
 * 流式 preview：与 import 同一 consumeStChatStream 状态机，不保留 turn 数组。
 */
export async function streamPreviewStChat(
  stream: NodeJS.ReadableStream,
): Promise<StChatPreview> {
  const warnings: string[] = []
  const meta = await consumeStChatStream(stream, {
    onTurn() {},
    onWarning: (message) => warnings.push(message),
  })
  return {
    turnCount: meta.turnCount,
    openingPreview: meta.openingPreview,
    warnings,
    suggestedTitle: meta.suggestedTitle,
  }
}

/**
 * 流式解析 JSONL → ParsedStChatTurn[]（测试 / 小文件对比用；大文件请走 importStChatFromStream）。
 */
export async function streamParseStChat(
  stream: NodeJS.ReadableStream,
): Promise<StChatParseResult> {
  const warnings: string[] = []
  const turns: ParsedStChatTurn[] = []
  const meta = await consumeStChatStream(stream, {
    onTurn(turn) {
      turns.push(turn)
    },
    onWarning: (message) => warnings.push(message),
  })
  return {
    turns,
    openingPreview: meta.openingPreview,
    warnings,
    suggestedTitle: meta.suggestedTitle,
  }
}

/** 流式导入：逐行解析 + session 按 chunk 落盘（与 preview 同状态机，无 turn 上限） */
export async function importStChatFromStream(params: {
  conversationId: string
  speakerCharacterId: string
  stream: NodeJS.ReadableStream
}): Promise<{ turnCount: number; warnings: string[] } | null> {
  const speaker = params.speakerCharacterId.trim()
  if (!speaker) return null

  const session = await openConversationImportSession({
    conversationId: params.conversationId,
    speakerCharacterId: speaker,
  })
  if (!session) return null

  const warnings: string[] = []
  try {
    const meta = await consumeStChatStream(params.stream, {
      async onTurn(turn) {
        await session.appendTurn(parsedTurnToImportItem(turn))
      },
      onWarning: (message) => warnings.push(message),
    })
    if (meta.turnCount === 0) {
      await session.rollback()
      return null
    }
    const result = await session.finalize()
    return { turnCount: result.turnCount, warnings }
  } catch (e) {
    await session.rollback()
    throw e
  }
}
