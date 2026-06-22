import {
  readConversationActiveBranchPath,
  readTurnsBefore,
  readTurnsInOrdinalRange,
  readTurnsTail,
  resolveActivePathTurns,
} from './chunk-chain.js'
import { normalizeBranchPath } from './chunk-path.js'
import { getTurnUserText, type TurnReceive, type TurnRecord } from './chat-storage.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  CONVERSATION_MESSAGES_DEFAULT_TAIL,
} from './turn-patch-body.js'

export interface MessagesTurnDto {
  turnId: string
  turnOrdinal: number
  user: string
  receives: {
    id: string
    content: string
    reasoning?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
    model?: string
  }[]
  activeReceiveIndex: number
  plugins?: unknown[]
}

export interface MessagesPageDto {
  hasMoreBefore: boolean
  from: number
  to: number
}

export interface MessagesListResponse {
  turns: MessagesTurnDto[]
  page?: MessagesPageDto
}

function mapReceive(r: TurnReceive) {
  const base: MessagesTurnDto['receives'][number] = {
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
    const m = (runtime as { model?: unknown }).model
    if (typeof m === 'string' && m.trim()) {
      base.model = m.trim()
    }
  }
  return base
}

export function mapTurnRecordsToMessagesDto(
  allTurnRecords: TurnRecord[],
): MessagesTurnDto[] {
  return allTurnRecords.map((t, i) => {
    const activeUserText = getTurnUserText(t)
    const recs = (t.receives ?? []).map(mapReceive)
    const ord =
      typeof t.turnOrdinal === 'number' && !Number.isNaN(t.turnOrdinal)
        ? t.turnOrdinal
        : i
    if (recs.length === 0) {
      return {
        turnId: t.turnId,
        turnOrdinal: ord,
        user: activeUserText,
        receives: [],
        activeReceiveIndex: 0,
      }
    }
    let ai =
      typeof t.activeReceiveIndex === 'number' && !Number.isNaN(t.activeReceiveIndex)
        ? t.activeReceiveIndex
        : 0
    ai = Math.min(Math.max(0, ai), recs.length - 1)
    return {
      turnId: t.turnId,
      turnOrdinal: ord,
      user: activeUserText,
      receives: recs,
      activeReceiveIndex: ai,
      ...(Array.isArray(t.plugins) && t.plugins.length > 0
        ? { plugins: t.plugins }
        : {}),
    }
  })
}

function clampPageLimit(raw: unknown, fallback: number): number {
  const n =
    typeof raw === 'string' && raw.trim()
      ? Number.parseInt(raw, 10)
      : typeof raw === 'number'
        ? raw
        : fallback
  if (!Number.isInteger(n) || n < 1) return fallback
  return Math.min(n, CONVERSATION_BATCH_MAX_TURNS)
}

export type MessagesQueryMode = 'all' | 'range' | 'tail' | 'before'

export function resolveMessagesQueryMode(query: {
  from?: string
  to?: string
  tail?: string
  before?: string
  limit?: string
}): MessagesQueryMode {
  const hasFrom = query.from !== undefined && query.from !== ''
  const hasTo = query.to !== undefined && query.to !== ''
  const hasTail = query.tail !== undefined && query.tail !== ''
  const hasBefore = query.before !== undefined && query.before !== ''
  const modes = [
    hasFrom || hasTo,
    hasTail,
    hasBefore,
  ].filter(Boolean).length
  if (modes > 1) return 'all' // caller treats as invalid via separate check
  if (hasTail) return 'tail'
  if (hasBefore) return 'before'
  if (hasFrom || hasTo) return 'range'
  return 'all'
}

export async function loadConversationMessages(
  conversationId: string,
  query: {
    from?: string
    to?: string
    tail?: string
    before?: string
    limit?: string
    /** 调试：覆盖 index.activeBranchPath */
    branchPath?: string
  },
): Promise<
  | { ok: true; response: MessagesListResponse }
  | { ok: false; error: string }
> {
  let activeBranchPath: string
  if (query.branchPath !== undefined && query.branchPath !== '') {
    try {
      activeBranchPath = normalizeBranchPath(query.branchPath)
    } catch {
      return { ok: false, error: 'messages_range_invalid' }
    }
  } else {
    activeBranchPath = await readConversationActiveBranchPath(conversationId)
  }

  const mode = resolveMessagesQueryMode(query)
  const hasFrom = query.from !== undefined && query.from !== ''
  const hasTo = query.to !== undefined && query.to !== ''
  const hasTail = query.tail !== undefined && query.tail !== ''
  const hasBefore = query.before !== undefined && query.before !== ''
  if (
    [hasFrom || hasTo, hasTail, hasBefore].filter(Boolean).length > 1
  ) {
    return { ok: false, error: 'messages_range_invalid' }
  }

  if (mode === 'tail') {
    const tail = clampPageLimit(
      query.tail,
      CONVERSATION_MESSAGES_DEFAULT_TAIL,
    )
    const result = await readTurnsTail(conversationId, tail, activeBranchPath)
    const turns = mapTurnRecordsToMessagesDto(result.turns)
    if (turns.length === 0) {
      return { ok: true, response: { turns } }
    }
    const from =
      result.minOrdinal ??
      Math.min(...turns.map((t) => t.turnOrdinal))
    const to =
      result.maxOrdinal ??
      Math.max(...turns.map((t) => t.turnOrdinal))
    return {
      ok: true,
      response: {
        turns,
        page: { hasMoreBefore: result.hasMoreBefore, from, to },
      },
    }
  }

  if (mode === 'before') {
    const before = Number.parseInt(String(query.before), 10)
    if (!Number.isInteger(before) || before < 0) {
      return { ok: false, error: 'messages_range_invalid' }
    }
    const limit = clampPageLimit(
      query.limit,
      CONVERSATION_MESSAGES_DEFAULT_TAIL,
    )
    const result = await readTurnsBefore(
      conversationId,
      before,
      limit,
      activeBranchPath,
    )
    const turns = mapTurnRecordsToMessagesDto(result.turns)
    if (turns.length === 0) {
      return {
        ok: true,
        response: {
          turns,
          page: { hasMoreBefore: false, from: 0, to: -1 },
        },
      }
    }
    const from =
      result.minOrdinal ??
      Math.min(...turns.map((t) => t.turnOrdinal))
    const to =
      result.maxOrdinal ??
      Math.max(...turns.map((t) => t.turnOrdinal))
    return {
      ok: true,
      response: {
        turns,
        page: { hasMoreBefore: result.hasMoreBefore, from, to },
      },
    }
  }

  if (mode === 'range') {
    if (!hasFrom || !hasTo) {
      return { ok: false, error: 'messages_range_incomplete' }
    }
    const from = Number.parseInt(String(query.from), 10)
    const to = Number.parseInt(String(query.to), 10)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      return { ok: false, error: 'messages_range_invalid' }
    }
    if (to - from + 1 > CONVERSATION_BATCH_MAX_TURNS) {
      return { ok: false, error: 'range_too_large' }
    }
    const records = await readTurnsInOrdinalRange(
      conversationId,
      from,
      to,
      activeBranchPath,
    )
    return {
      ok: true,
      response: {
        turns: mapTurnRecordsToMessagesDto(records),
        page: { hasMoreBefore: from > 0, from, to },
      },
    }
  }

  const records = await resolveActivePathTurns(
    conversationId,
    activeBranchPath,
  )
  return {
    ok: true,
    response: { turns: mapTurnRecordsToMessagesDto(records) },
  }
}
