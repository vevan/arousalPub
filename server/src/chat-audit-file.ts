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
import {
  auditEntryIdentityKey,
  auditEntryIsAfterSegment,
  auditEntryMatchesIdentity,
  requireAuditSegmentIndex,
} from './chat-audit-identity.js'

export const CHAT_AUDIT_FILE = 'chat-audit.json'
export const DEFAULT_AUDIT_DEBUG_MAX = 10

type AuditIndexLike = {
  auditDebug?: { enabled?: boolean; maxStored?: number }
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
  return { enabled: false, maxStored: DEFAULT_AUDIT_DEBUG_MAX }
}

export function isAuditDebugWriteEnabled(idx: AuditIndexLike): boolean {
  const s = resolveAuditDebugSettings(idx)
  return s.enabled && s.maxStored >= 1
}

function conversationAuditPath(id: string): string {
  return path.join(conversationDir(id), CHAT_AUDIT_FILE)
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

export async function readChatAuditFile(
  conversationId: string,
): Promise<ChatAuditFile> {
  const auditPath = conversationAuditPath(conversationId)
  if (existsSync(auditPath)) {
    try {
      const raw = await readFile(auditPath, 'utf8')
      const j = JSON.parse(raw) as ChatAuditFile
      if (
        j &&
        (j.schemaVersion === 2 || j.schemaVersion === 3) &&
        Array.isArray(j.entries)
      ) {
        return j
      }
    } catch {
      /* fall through */
    }
  }
  return { schemaVersion: 2, entries: [] }
}

function nowIso(): string {
  return new Date().toISOString()
}

export function buildChatAuditEntry(
  meta: {
    savedAt: string
    chunkName: string
    turnId: string
    turnOrdinal: number
    segmentIndex: number
    receiveId?: string
  },
  messages: ChatAuditMessage[],
  snapshot: ChatAuditSnapshotInput,
): ChatAuditEntry {
  const segmentIndex = requireAuditSegmentIndex(meta.segmentIndex)
  return {
    savedAt: meta.savedAt,
    chunkName: meta.chunkName,
    turnId: meta.turnId,
    turnOrdinal: meta.turnOrdinal,
    segmentIndex,
    ...(meta.receiveId?.trim() ? { receiveId: meta.receiveId.trim() } : {}),
    messages,
    ...(snapshot.assembly ? { assembly: snapshot.assembly } : {}),
    ...(snapshot.groupChat ? { groupChat: snapshot.groupChat } : {}),
    ...(snapshot.calls?.length ? { calls: snapshot.calls } : {}),
    ...(snapshot.plugins?.length ? { plugins: snapshot.plugins } : {}),
    ...(snapshot.performance ? { performance: snapshot.performance } : {}),
  }
}

export async function appendChatAuditEntry(
  conversationId: string,
  idx: AuditIndexLike,
  params: {
    chunkName: string
    turnId: string
    turnOrdinal: number
    segmentIndex: number
    receiveId?: string
    snapshot: ChatAuditSnapshotInput
  },
): Promise<void> {
  if (!isAuditDebugWriteEnabled(idx)) return
  const { maxStored } = resolveAuditDebugSettings(idx)
  const msgs = validateAuditMessages(params.snapshot.messages)
  if (!msgs) return

  const segmentIndex = requireAuditSegmentIndex(params.segmentIndex)
  const file = await readChatAuditFile(conversationId)
  const replaceKey = auditEntryIdentityKey({ turnId: params.turnId, segmentIndex })
  const filtered = file.entries.filter(
    (e) => auditEntryIdentityKey(e) !== replaceKey,
  )
  const entry = buildChatAuditEntry(
    {
      savedAt: nowIso(),
      chunkName: params.chunkName,
      turnId: params.turnId,
      turnOrdinal: params.turnOrdinal,
      segmentIndex,
      receiveId: params.receiveId,
    },
    msgs,
    params.snapshot,
  )
  filtered.push(entry)
  const entries = filtered.slice(-maxStored)
  await mkdir(conversationDir(conversationId), { recursive: true })
  await writeFile(
    conversationAuditPath(conversationId),
    `${JSON.stringify({ schemaVersion: 3, entries }, null, 2)}\n`,
    'utf8',
  )
}

/** regen 截断后续 segment 时移除对应审计条目 */
export async function removeChatAuditEntriesAfterSegment(
  conversationId: string,
  turnId: string,
  afterSegmentIndex: number,
): Promise<void> {
  const auditPath = conversationAuditPath(conversationId)
  if (!existsSync(auditPath)) return
  try {
    const file = await readChatAuditFile(conversationId)
    const entries = file.entries.filter(
      (e) => !auditEntryIsAfterSegment(e, { turnId, segmentIndex: afterSegmentIndex }),
    )
    if (entries.length === file.entries.length) return
    await writeFile(
      auditPath,
      `${JSON.stringify({ schemaVersion: 3, entries }, null, 2)}\n`,
      'utf8',
    )
  } catch {
    /* ignore */
  }
}

export async function removeChatAuditEntriesByTurnId(
  conversationId: string,
  turnId: string,
): Promise<void> {
  const auditPath = conversationAuditPath(conversationId)
  if (!existsSync(auditPath)) return
  try {
    const file = await readChatAuditFile(conversationId)
    const entries = file.entries.filter((e) => e.turnId !== turnId)
    if (entries.length === file.entries.length) return
    await writeFile(
      auditPath,
      `${JSON.stringify({ schemaVersion: 3, entries }, null, 2)}\n`,
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
