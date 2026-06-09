import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMessage } from './assemble-prompts.js'
import { getChatsRoot } from './config.js'
import { isValidConversationId } from './conversation-id.js'
import type {
  AuditDebugSettings,
  ChatAuditEntry,
  ChatAuditFile,
  ChatAuditMessage,
  ChatAuditSnapshotInput,
} from './chat-audit-types.js'

export const CHAT_AUDIT_FILE = 'chat-audit.json'
export const CHAT_PROMPT_LEGACY_FILE = 'chat-prompt.json'
export const DEFAULT_AUDIT_DEBUG_MAX = 10

type AuditIndexLike = {
  auditDebug?: { enabled?: boolean; maxStored?: number }
  promptDebug?: { maxStored?: number }
} | null

function conversationDir(id: string): string {
  if (!isValidConversationId(id)) {
    throw new Error('invalid_conversation_id')
  }
  return path.join(getChatsRoot(), id)
}

export function resolveAuditDebugSettings(idx: AuditIndexLike): AuditDebugSettings {
  const ad = idx?.auditDebug
  if (ad && typeof ad === 'object') {
    const enabled = ad.enabled === true
    const maxRaw = ad.maxStored
    const maxStored =
      typeof maxRaw === 'number' && Number.isInteger(maxRaw) && maxRaw >= 0 && maxRaw <= 200
        ? maxRaw
        : DEFAULT_AUDIT_DEBUG_MAX
    return { enabled, maxStored }
  }
  const legacyMax = idx?.promptDebug?.maxStored
  if (
    typeof legacyMax === 'number' &&
    Number.isInteger(legacyMax) &&
    legacyMax >= 0 &&
    legacyMax <= 200
  ) {
    return { enabled: legacyMax >= 1, maxStored: legacyMax }
  }
  return { enabled: false, maxStored: DEFAULT_AUDIT_DEBUG_MAX }
}

export function isAuditDebugWriteEnabled(idx: AuditIndexLike): boolean {
  const s = resolveAuditDebugSettings(idx)
  return s.enabled && s.maxStored >= 1
}

function conversationAuditPath(id: string): string {
  return path.join(conversationDir(id), CHAT_AUDIT_FILE)
}

function conversationLegacyPromptPath(id: string): string {
  return path.join(conversationDir(id), CHAT_PROMPT_LEGACY_FILE)
}

function validateAuditMessages(raw: ChatMessage[]): ChatAuditMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ChatAuditMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const role = m.role
    const content = m.content
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string') return null
    out.push({ role, content })
  }
  return out
}

async function readLegacyPromptAsAudit(
  conversationId: string,
): Promise<ChatAuditFile | null> {
  const legacyPath = conversationLegacyPromptPath(conversationId)
  if (!existsSync(legacyPath)) return null
  try {
    const raw = await readFile(legacyPath, 'utf8')
    const j = JSON.parse(raw) as {
      schemaVersion?: number
      entries?: Array<{
        savedAt?: string
        chunkName?: string
        turnId?: string
        turnOrdinal?: number
        messages?: ChatAuditMessage[]
      }>
    }
    if (!j || !Array.isArray(j.entries)) return null
    const entries: ChatAuditEntry[] = []
    for (const e of j.entries) {
      if (
        !e ||
        typeof e.turnId !== 'string' ||
        typeof e.turnOrdinal !== 'number' ||
        !Array.isArray(e.messages)
      ) {
        continue
      }
      entries.push({
        savedAt: typeof e.savedAt === 'string' ? e.savedAt : new Date().toISOString(),
        chunkName: typeof e.chunkName === 'string' ? e.chunkName : '',
        turnId: e.turnId,
        turnOrdinal: e.turnOrdinal,
        messages: e.messages,
      })
    }
    return { schemaVersion: 2, entries }
  } catch {
    return null
  }
}

export async function readChatAuditFile(
  conversationId: string,
): Promise<ChatAuditFile> {
  const auditPath = conversationAuditPath(conversationId)
  if (existsSync(auditPath)) {
    try {
      const raw = await readFile(auditPath, 'utf8')
      const j = JSON.parse(raw) as ChatAuditFile
      if (j && j.schemaVersion === 2 && Array.isArray(j.entries)) {
        return j
      }
    } catch {
      /* fall through */
    }
  }
  const legacy = await readLegacyPromptAsAudit(conversationId)
  if (legacy) return legacy
  return { schemaVersion: 2, entries: [] }
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function appendChatAuditEntry(
  conversationId: string,
  idx: AuditIndexLike,
  params: {
    chunkName: string
    turnId: string
    turnOrdinal: number
    snapshot: ChatAuditSnapshotInput
  },
): Promise<void> {
  if (!isAuditDebugWriteEnabled(idx)) return
  const { maxStored } = resolveAuditDebugSettings(idx)
  const msgs = validateAuditMessages(params.snapshot.messages)
  if (!msgs) return

  const file = await readChatAuditFile(conversationId)
  const filtered = file.entries.filter((e) => e.turnId !== params.turnId)
  const entry: ChatAuditEntry = {
    savedAt: nowIso(),
    chunkName: params.chunkName,
    turnId: params.turnId,
    turnOrdinal: params.turnOrdinal,
    messages: msgs,
    ...(params.snapshot.assembly ? { assembly: params.snapshot.assembly } : {}),
    ...(params.snapshot.calls?.length ? { calls: params.snapshot.calls } : {}),
    ...(params.snapshot.plugins?.length ? { plugins: params.snapshot.plugins } : {}),
  }
  filtered.push(entry)
  const entries = filtered.slice(-maxStored)
  await mkdir(conversationDir(conversationId), { recursive: true })
  await writeFile(
    conversationAuditPath(conversationId),
    `${JSON.stringify({ schemaVersion: 2, entries }, null, 2)}\n`,
    'utf8',
  )
}

export async function removeChatAuditEntriesByTurnId(
  conversationId: string,
  turnId: string,
): Promise<void> {
  const auditPath = conversationAuditPath(conversationId)
  try {
    if (existsSync(auditPath)) {
      const file = await readChatAuditFile(conversationId)
      const entries = file.entries.filter((e) => e.turnId !== turnId)
      if (entries.length === file.entries.length) return
      await writeFile(
        auditPath,
        `${JSON.stringify({ schemaVersion: 2, entries }, null, 2)}\n`,
        'utf8',
      )
      return
    }
  } catch {
    /* try legacy */
  }
  const legacyPath = conversationLegacyPromptPath(conversationId)
  if (!existsSync(legacyPath)) return
  try {
    const raw = await readFile(legacyPath, 'utf8')
    const j = JSON.parse(raw) as { schemaVersion?: number; entries?: { turnId: string }[] }
    if (!j || !Array.isArray(j.entries)) return
    const entries = j.entries.filter((e) => e.turnId !== turnId)
    if (entries.length === j.entries.length) return
    await writeFile(
      legacyPath,
      `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
      'utf8',
    )
  } catch {
    /* ignore */
  }
}

export async function trimChatAuditEntries(
  conversationId: string,
  maxStored: number,
): Promise<void> {
  if (maxStored < 1) return
  const auditPath = conversationAuditPath(conversationId)
  if (!existsSync(auditPath)) return
  const file = await readChatAuditFile(conversationId)
  if (file.entries.length <= maxStored) return
  file.entries = file.entries.slice(-maxStored)
  await writeFile(
    auditPath,
    `${JSON.stringify(file, null, 2)}\n`,
    'utf8',
  )
}
