import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHAT_ROOT } from './config.js'

export { CHAT_ROOT }

/** 与文档一致：数据根下 chat/ */
export const CHAT_LIST_FILE = path.join(CHAT_ROOT, 'chat.index.json')

export const CHUNK_NAME_FIRST = 'turn-000000-000099.json'
export const CHAT_PROMPT_FILE = 'chat-prompt.json'
export const DEFAULT_PROMPT_DEBUG_MAX = 10

export interface ChatListEntry {
  conversationId: string
  title: string
  updatedAt: string
  /** 兼容：首张卡 id，等同于 characterIds[0] */
  characterId?: string | null
  /** 会话绑定的多张角色卡 id，顺序即主槽 {{char}}、次槽 {{char2}}… */
  characterIds?: string[]
  activeBranchPath?: string | null
}

export interface ChatListFile {
  schemaVersion: 1
  conversations: ChatListEntry[]
}

export interface ConversationIndex {
  schemaVersion: 1
  conversationId: string
  title: string
  characterId?: string | null
  /** 多卡绑定；优先于单独的 characterId。写盘时会同步 characterId = characterIds[0] ?? null */
  characterIds?: string[]
  createdAt: string
  updatedAt: string
  headChunkFile: string | null
  tailChunkFile: string | null
  apiPreset?: Record<string, unknown>
  backupSettings?: { everyNRounds: number; maxKeptBackups: number }
  branches?: unknown[]
  /** 调试：chat-prompt.json 中每会话保留的 prompt 条数上限 */
  promptDebug?: { maxStored: number }
}

export interface TurnReceive {
  id: string
  content: string
  /** 思维链 / reasoning（与上游 reasoning_content 等对应） */
  reasoning?: string
  runtime?: Record<string, unknown>
}

/** 存盘仅 { userText }；读盘兼容历史 sends[] */
export type TurnSendBlock =
  | { userText: string }
  | { sends: { id: string; userText: string }[]; activeSendIndex: number }

export interface TurnRecord {
  turnId: string
  turnOrdinal: number
  send: TurnSendBlock
  receives: TurnReceive[]
  activeReceiveIndex: number
  plugins: unknown[]
}

export interface ChatPromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatPromptEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: ChatPromptMessage[]
}

export interface ChatPromptFile {
  schemaVersion: 1
  entries: ChatPromptEntry[]
}

/**
 * 解析会话绑定的角色卡 id：优先 characterIds（顺序即 {{char}}、{{char2}}…），否则回退 legacy characterId。
 */
export function resolvedCharacterIds(
  idx: Pick<ConversationIndex, 'characterId' | 'characterIds'>,
): string[] {
  /** 显式存了 characterIds（含空数组）时以之为准，不回退 legacy characterId */
  if (Array.isArray(idx.characterIds)) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of idx.characterIds) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  if (typeof idx.characterId === 'string' && idx.characterId.trim()) {
    return [idx.characterId.trim()]
  }
  return []
}

/** 写盘前同步 characterId ↔ characterIds[0]，避免只存其一造成歧义 */
export function syncConversationCharacterFields(
  idx: ConversationIndex,
): ConversationIndex {
  const ids = resolvedCharacterIds(idx)
  return {
    ...idx,
    characterIds: ids.length > 0 ? ids : undefined,
    characterId: ids[0] ?? null,
  }
}

export function chatListEntryFromIndex(idx: ConversationIndex): ChatListEntry {
  const ids = resolvedCharacterIds(idx)
  return {
    conversationId: idx.conversationId,
    title: idx.title,
    updatedAt: idx.updatedAt,
    characterId: ids[0] ?? null,
    characterIds: ids.length > 0 ? ids : undefined,
  }
}

export async function updateConversationCharacterBindings(
  conversationId: string,
  characterIds: string[],
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of characterIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    cleaned.push(id)
  }
  const t = nowIso()
  const next: ConversationIndex = {
    ...idx,
    characterIds: cleaned,
    characterId: cleaned[0] ?? null,
    updatedAt: t,
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next))
  return next
}

/** 从 send 块读取当前用户正文（兼容旧 sends 多版本） */
export function getTurnUserText(turn: Pick<TurnRecord, 'send' | 'turnId'>): string {
  const raw = turn.send
  if (
    raw &&
    typeof raw === 'object' &&
    'sends' in raw &&
    Array.isArray((raw as { sends: unknown }).sends) &&
    (raw as { sends: { userText?: string }[] }).sends.length > 0
  ) {
    const b = raw as {
      sends: { userText?: string }[]
      activeSendIndex?: number
    }
    const ai =
      typeof b.activeSendIndex === 'number' && Number.isInteger(b.activeSendIndex)
        ? b.activeSendIndex
        : 0
    const idx = Math.min(Math.max(0, ai), b.sends.length - 1)
    const ut = b.sends[idx]?.userText
    return typeof ut === 'string' ? ut : ''
  }
  if (
    raw &&
    typeof raw === 'object' &&
    'userText' in raw &&
    typeof (raw as { userText: unknown }).userText === 'string'
  ) {
    return (raw as { userText: string }).userText
  }
  return ''
}

export interface ChunkFile {
  schemaVersion: 1
  meta: {
    chunkId: string
    ordinalRange: { start: number; end: number }
    links: {
      previous: string | null
      next: string | null
      branches: unknown[]
    }
  }
  turns: TurnRecord[]
}

function nowIso(): string {
  return new Date().toISOString()
}

export function conversationPromptPath(id: string): string {
  return path.join(conversationDir(id), CHAT_PROMPT_FILE)
}

export function getPromptDebugMaxStored(idx: ConversationIndex | null): number {
  const n = idx?.promptDebug?.maxStored
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 200) {
    return n
  }
  return DEFAULT_PROMPT_DEBUG_MAX
}

/** 写盘时去掉历史字段 messages，并规范 plugins */
function stripTurnForDisk(t: TurnRecord): TurnRecord {
  return {
    turnId: t.turnId,
    turnOrdinal: t.turnOrdinal,
    send: t.send,
    receives: t.receives,
    activeReceiveIndex: t.activeReceiveIndex,
    plugins: Array.isArray(t.plugins) ? t.plugins : [],
  }
}

async function writeChunkFile(
  conversationId: string,
  chunkFileName: string,
  chunk: ChunkFile,
): Promise<void> {
  const clean: ChunkFile = {
    ...chunk,
    turns: chunk.turns.map(stripTurnForDisk),
  }
  await writeFile(
    path.join(conversationDir(conversationId), chunkFileName),
    JSON.stringify(clean, null, 2),
    'utf8',
  )
}

export async function readChatPromptFile(
  conversationId: string,
): Promise<ChatPromptFile> {
  try {
    const raw = await readFile(conversationPromptPath(conversationId), 'utf8')
    const j = JSON.parse(raw) as ChatPromptFile
    if (!j || j.schemaVersion !== 1 || !Array.isArray(j.entries)) {
      return { schemaVersion: 1, entries: [] }
    }
    return j
  } catch {
    return { schemaVersion: 1, entries: [] }
  }
}

function validatePromptMessages(raw: unknown): ChatPromptMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ChatPromptMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string') return null
    out.push({ role, content })
  }
  return out
}

export async function appendChatPromptDebugEntry(
  conversationId: string,
  params: {
    chunkName: string
    turnId: string
    turnOrdinal: number
    messages: unknown
  },
): Promise<void> {
  const msgs = validatePromptMessages(params.messages)
  if (!msgs) return
  const idx = await readConversationIndex(conversationId)
  const max = getPromptDebugMaxStored(idx)
  const file = await readChatPromptFile(conversationId)
  const filtered = file.entries.filter((e) => e.turnId !== params.turnId)
  filtered.push({
    savedAt: nowIso(),
    chunkName: params.chunkName,
    turnId: params.turnId,
    turnOrdinal: params.turnOrdinal,
    messages: msgs,
  })
  const entries = filtered.slice(-max)
  await mkdir(conversationDir(conversationId), { recursive: true })
  await writeFile(
    conversationPromptPath(conversationId),
    JSON.stringify({ schemaVersion: 1, entries }, null, 2),
    'utf8',
  )
}

async function removeChatPromptEntriesByTurnId(
  conversationId: string,
  turnId: string,
): Promise<void> {
  try {
    const file = await readChatPromptFile(conversationId)
    const entries = file.entries.filter((e) => e.turnId !== turnId)
    if (entries.length === file.entries.length) return
    await writeFile(
      conversationPromptPath(conversationId),
      JSON.stringify({ schemaVersion: 1, entries }, null, 2),
      'utf8',
    )
  } catch {
    /* 文件可能不存在 */
  }
}

export async function updateConversationPromptDebugMax(
  conversationId: string,
  maxStored: number,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const clamped = Math.min(200, Math.max(1, Math.floor(maxStored)))
  idx.promptDebug = { maxStored: clamped }
  idx.updatedAt = nowIso()
  await writeConversationIndex(conversationId, idx)
  const file = await readChatPromptFile(conversationId)
  if (file.entries.length > clamped) {
    file.entries = file.entries.slice(-clamped)
    await writeFile(
      conversationPromptPath(conversationId),
      JSON.stringify({ schemaVersion: 1, entries: file.entries }, null, 2),
      'utf8',
    )
  }
  await upsertChatListEntry(chatListEntryFromIndex(idx))
  return idx
}

async function ensureChatRoot(): Promise<void> {
  await mkdir(CHAT_ROOT, { recursive: true })
}

export async function readChatList(): Promise<ChatListFile> {
  try {
    const raw = await readFile(CHAT_LIST_FILE, 'utf8')
    const j = JSON.parse(raw) as ChatListFile
    if (!j || j.schemaVersion !== 1 || !Array.isArray(j.conversations)) {
      return { schemaVersion: 1, conversations: [] }
    }
    return j
  } catch {
    return { schemaVersion: 1, conversations: [] }
  }
}

async function writeChatList(data: ChatListFile): Promise<void> {
  await ensureChatRoot()
  await writeFile(CHAT_LIST_FILE, JSON.stringify(data, null, 2), 'utf8')
}

export async function upsertChatListEntry(entry: ChatListEntry): Promise<void> {
  const list = await readChatList()
  const i = list.conversations.findIndex(
    (c) => c.conversationId === entry.conversationId,
  )
  if (i >= 0) list.conversations[i] = entry
  else list.conversations.unshift(entry)
  list.conversations.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt, 'en'),
  )
  await writeChatList(list)
}

export function conversationDir(id: string): string {
  return path.join(CHAT_ROOT, id)
}

export function conversationIndexPath(id: string): string {
  return path.join(conversationDir(id), 'index.json')
}

export async function readConversationIndex(
  id: string,
): Promise<ConversationIndex | null> {
  try {
    const raw = await readFile(conversationIndexPath(id), 'utf8')
    return JSON.parse(raw) as ConversationIndex
  } catch {
    return null
  }
}

export async function writeConversationIndex(
  id: string,
  data: ConversationIndex,
): Promise<void> {
  const dir = conversationDir(id)
  await mkdir(dir, { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeFile(
    conversationIndexPath(id),
    JSON.stringify(normalized, null, 2),
    'utf8',
  )
}

/** 创建空会话（仅索引，无 chunk），供首页列表展示 */
export async function createConversationStub(
  conversationId: string,
  title: string,
): Promise<ConversationIndex> {
  const t = nowIso()
  const idx: ConversationIndex = {
    schemaVersion: 1,
    conversationId,
    title: title.trim() || '新对话',
    characterId: null,
    createdAt: t,
    updatedAt: t,
    headChunkFile: null,
    tailChunkFile: null,
    backupSettings: { everyNRounds: 0, maxKeptBackups: 0 },
    branches: [],
    promptDebug: { maxStored: DEFAULT_PROMPT_DEBUG_MAX },
  }
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx))
  return idx
}

export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  idx.title = title.trim() || idx.title
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx))
  return idx
}

/** 首条用户消息 + 首条助手回复落盘后调用：写 chunk、更新会话索引与列表 */
export async function saveFirstTurn(params: {
  conversationId: string
  userText: string
  assistantText: string
  reasoning?: string
  model?: string
  /** 与发往 /api/chat 的 messages 一致，写入 chat-prompt.json（调试用） */
  debugPrompt?: unknown
}): Promise<{ index: ConversationIndex; chunk: ChunkFile } | null> {
  const { conversationId, userText, assistantText, reasoning, model, debugPrompt } =
    params
  let idx = await readConversationIndex(conversationId)
  if (!idx) return null
  if (idx.headChunkFile) {
    return null
  }

  const turnId = randomUUID()
  const receiveId = randomUUID()
  const turn: TurnRecord = {
    turnId,
    turnOrdinal: 0,
    send: { userText },
    receives: [
      {
        id: receiveId,
        content: assistantText,
        ...(reasoning != null && reasoning !== ''
          ? { reasoning: reasoning.trim() }
          : {}),
        runtime: model ? { model } : undefined,
      },
    ],
    activeReceiveIndex: 0,
    plugins: [],
  }

  const chunk: ChunkFile = {
    schemaVersion: 1,
    meta: {
      chunkId: 'turn-000000-000099',
      ordinalRange: { start: 0, end: 0 },
      links: { previous: null, next: null, branches: [] },
    },
    turns: [turn],
  }

  await mkdir(conversationDir(conversationId), { recursive: true })
  await writeChunkFile(conversationId, CHUNK_NAME_FIRST, chunk)

  const t = nowIso()
  idx.headChunkFile = CHUNK_NAME_FIRST
  idx.tailChunkFile = CHUNK_NAME_FIRST
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx))

  void appendChatPromptDebugEntry(conversationId, {
    chunkName: CHUNK_NAME_FIRST,
    turnId,
    turnOrdinal: 0,
    messages: debugPrompt ?? [],
  })

  return { index: idx, chunk }
}

/** 在已有尾块末尾追加一轮对话 */
export async function appendConversationTurn(params: {
  conversationId: string
  userText: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  debugPrompt?: unknown
}): Promise<boolean> {
  const { conversationId, userText, receives, activeReceiveIndex, debugPrompt } =
    params
  if (!receives.length) return false
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return false
  const chunkPath = tailChunkPath(conversationId, idx)
  if (!chunkPath) return false
  let chunk: ChunkFile
  try {
    const raw = await readFile(chunkPath, 'utf8')
    chunk = JSON.parse(raw) as ChunkFile
  } catch {
    return false
  }
  const nextOrd =
    chunk.turns.length === 0
      ? 0
      : Math.max(...chunk.turns.map((t) => t.turnOrdinal)) + 1
  const turn: TurnRecord = {
    turnId: randomUUID(),
    turnOrdinal: nextOrd,
    send: { userText },
    receives: receives.map((r) => {
      const rec: TurnReceive = { id: r.id, content: r.content }
      if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
        rec.reasoning = r.reasoning
      }
      if (r.runtime && typeof r.runtime === 'object') {
        rec.runtime = r.runtime
      }
      return rec
    }),
    activeReceiveIndex: Math.min(
      Math.max(0, activeReceiveIndex),
      receives.length - 1,
    ),
    plugins: [],
  }
  chunk.turns.push(turn)
  chunk.meta.ordinalRange = { start: 0, end: turn.turnOrdinal }
  const chunkName = idx.tailChunkFile
  await writeChunkFile(conversationId, chunkName, chunk)
  const t = nowIso()
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx))
  void appendChatPromptDebugEntry(conversationId, {
    chunkName,
    turnId: turn.turnId,
    turnOrdinal: turn.turnOrdinal,
    messages: debugPrompt ?? [],
  })
  return true
}

export async function deleteConversation(
  conversationId: string,
): Promise<boolean> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  try {
    await rm(conversationDir(conversationId), { recursive: true, force: true })
  } catch {
    return false
  }
  const list = await readChatList()
  list.conversations = list.conversations.filter(
    (c) => c.conversationId !== conversationId,
  )
  await writeChatList(list)
  return true
}

export async function readTailChunk(
  conversationId: string,
): Promise<ChunkFile | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  try {
    const p = path.join(conversationDir(conversationId), idx.tailChunkFile)
    const raw = await readFile(p, 'utf8')
    return JSON.parse(raw) as ChunkFile
  } catch {
    return null
  }
}

function tailChunkPath(
  conversationId: string,
  idx: ConversationIndex,
): string | null {
  if (!idx.tailChunkFile) return null
  return path.join(conversationDir(conversationId), idx.tailChunkFile)
}

/** 更新尾块中某轮：用户正文 + 助手 receives（全量替换） */
export async function updateTurnContentInTailChunk(
  conversationId: string,
  turnOrdinal: number,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  /** 与当次 /api/chat 的 messages 一致时写入 chat-prompt（如再生） */
  debugPrompt?: unknown,
): Promise<boolean> {
  if (!receives.length) return false
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return false
  const chunkPath = tailChunkPath(conversationId, idx)
  if (!chunkPath) return false
  let chunk: ChunkFile
  try {
    const raw = await readFile(chunkPath, 'utf8')
    chunk = JSON.parse(raw) as ChunkFile
  } catch {
    return false
  }
  const ti = chunk.turns.findIndex((t) => t.turnOrdinal === turnOrdinal)
  if (ti < 0) return false
  const turn = chunk.turns[ti]
  const turnId = turn.turnId
  const chunkName = idx.tailChunkFile
  turn.send = { userText }
  turn.receives = receives.map((r) => {
    const rec: TurnReceive = { id: r.id, content: r.content }
    if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
      rec.reasoning = r.reasoning
    }
    if (r.runtime && typeof r.runtime === 'object') {
      rec.runtime = r.runtime
    }
    return rec
  })
  turn.activeReceiveIndex = Math.min(
    Math.max(0, activeReceiveIndex),
    turn.receives.length - 1,
  )
  await writeChunkFile(conversationId, idx.tailChunkFile, chunk)
  const t = nowIso()
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx))
  if (debugPrompt !== undefined) {
    void appendChatPromptDebugEntry(conversationId, {
      chunkName,
      turnId,
      turnOrdinal,
      messages: debugPrompt,
    })
  }
  return true
}

/** 删除尾块中的整轮（用户+助手），并重排 turnOrdinal；若无剩余轮次则删除 chunk 文件并清空 head/tail */
export async function removeTurnAtOrdinalInTailChunk(
  conversationId: string,
  turnOrdinal: number,
): Promise<boolean> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return false
  const chunkPath = tailChunkPath(conversationId, idx)
  if (!chunkPath) return false
  let chunk: ChunkFile
  try {
    const raw = await readFile(chunkPath, 'utf8')
    chunk = JSON.parse(raw) as ChunkFile
  } catch {
    return false
  }
  const victim = chunk.turns.find((x) => x.turnOrdinal === turnOrdinal)
  const victimTurnId = victim?.turnId

  const filtered = chunk.turns.filter((t) => t.turnOrdinal !== turnOrdinal)
  if (filtered.length === chunk.turns.length) return false

  const t = nowIso()

  if (filtered.length === 0) {
    try {
      await rm(chunkPath, { force: true })
    } catch {
      return false
    }
    idx.headChunkFile = null
    idx.tailChunkFile = null
    idx.updatedAt = t
    await writeConversationIndex(conversationId, idx)
    await upsertChatListEntry(chatListEntryFromIndex(idx))
    if (victimTurnId) void removeChatPromptEntriesByTurnId(conversationId, victimTurnId)
    return true
  }

  filtered.forEach((turn, i) => {
    turn.turnOrdinal = i
  })
  chunk.turns = filtered
  const end = filtered.length - 1
  chunk.meta.ordinalRange = { start: 0, end }

  await writeChunkFile(conversationId, idx.tailChunkFile, chunk)
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx))
  if (victimTurnId) void removeChatPromptEntriesByTurnId(conversationId, victimTurnId)
  return true
}
