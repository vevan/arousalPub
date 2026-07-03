import type {
  ChatPersistPayload,
  ChatTurnItem,
  ReceiveItem,
  AssistantSegmentItem,
  TurnPatchPersistPayload,
  PersistTurnToServerResult,
} from '@/types/chat-turn'
import { translateApiError } from '@/utils/api-error-message'
import { buildTurnPatchRequestBody } from '@/utils/group-chat-turn'
import { allocateShortId } from '@/utils/short-id'

type MessagesApiTurn = {
  turnId?: string
  user?: string
  turnOrdinal?: number
  receives?: {
    id: string
    content: string
    reasoning?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
    model?: string
  }[]
  activeReceiveIndex?: number
  segments?: {
    id: string
    speakerCharacterId: string
    receives?: MessagesApiTurn['receives']
    activeReceiveIndex?: number
    meta?: { nextSpeakerHint?: string; skipSpeakQuotaDeduction?: boolean }
  }[]
  activeSegmentIndex?: number
  speakerQueue?: string[]
  speakerCharacterId?: string
  groupChatTurnState?: {
    quotaRemaining: Record<string, number>
    speakCount: Record<string, number>
  }
  plugins?: unknown[]
}

export type MessagesPageInfo = {
  hasMoreBefore: boolean
  from: number
  to: number
}

type MessagesApiResponse = {
  turns?: MessagesApiTurn[]
  page?: MessagesPageInfo
}

/** 与 server `CONVERSATION_MESSAGES_DEFAULT_TAIL` 一致 */
export const CONVERSATION_UI_TAIL_LIMIT = 30

function mapReceiveRow(
  r: NonNullable<MessagesApiTurn['receives']>[number],
  used: Set<string>,
): ReceiveItem {
  const item: ReceiveItem = {
    id:
      typeof r.id === 'string' && r.id.trim()
        ? r.id.trim()
        : allocateShortId(used),
    content: typeof r.content === 'string' ? r.content : '',
  }
  if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
    item.reasoning = r.reasoning
  }
  if (typeof r.durationMs === 'number' && r.durationMs > 0) {
    item.durationMs = r.durationMs
  }
  if (typeof r.estimatedTokens === 'number' && r.estimatedTokens > 0) {
    item.estimatedTokens = r.estimatedTokens
  }
  if (typeof r.completionTokens === 'number' && r.completionTokens > 0) {
    item.completionTokens = r.completionTokens
  }
  if (typeof r.model === 'string' && r.model.trim()) {
    item.model = r.model.trim()
  }
  return item
}

function mapSegmentRow(
  seg: NonNullable<MessagesApiTurn['segments']>[number],
): AssistantSegmentItem {
  const segUsed = new Set<string>()
  const segReceives = Array.isArray(seg.receives)
    ? seg.receives.map((r) => mapReceiveRow(r, segUsed))
    : []
  let segAi =
    typeof seg.activeReceiveIndex === 'number' &&
    !Number.isNaN(seg.activeReceiveIndex)
      ? seg.activeReceiveIndex
      : 0
  if (segReceives.length > 0) {
    segAi = Math.min(Math.max(0, segAi), segReceives.length - 1)
  }
  const hint = seg.meta?.nextSpeakerHint
  const skipSpeakQuotaDeduction = seg.meta?.skipSpeakQuotaDeduction === true
  const segMeta =
    hint || skipSpeakQuotaDeduction
      ? {
          ...(hint ? { nextSpeakerHint: hint } : {}),
          ...(skipSpeakQuotaDeduction ? { skipSpeakQuotaDeduction: true as const } : {}),
        }
      : undefined
  return {
    id: typeof seg.id === 'string' ? seg.id : '',
    speakerCharacterId:
      typeof seg.speakerCharacterId === 'string' ? seg.speakerCharacterId : '',
    receives: segReceives,
    activeReceiveIndex: segAi,
    ...(segMeta ? { meta: segMeta } : {}),
  }
}

export function parseConversationTurnsFromApi(
  raw: MessagesApiTurn[],
): ChatTurnItem[] {
  return raw.map((row, i) => {
    const ord =
      typeof row.turnOrdinal === 'number' && !Number.isNaN(row.turnOrdinal)
        ? row.turnOrdinal
        : i
    const user = typeof row.user === 'string' ? row.user : ''
    const segments = Array.isArray(row.segments)
      ? row.segments.map((seg) => mapSegmentRow(seg))
      : []
    const activeSegmentIndex =
      typeof row.activeSegmentIndex === 'number' &&
      !Number.isNaN(row.activeSegmentIndex)
        ? Math.min(
            Math.max(0, row.activeSegmentIndex),
            Math.max(0, segments.length - 1),
          )
        : 0
    const activeSeg = segments[activeSegmentIndex]
    const receives = activeSeg?.receives ?? []
    const activeReceiveIndex = activeSeg?.activeReceiveIndex ?? 0
    return {
      ...(typeof row.turnId === 'string' && row.turnId.trim()
        ? { turnId: row.turnId.trim() }
        : {}),
      user,
      receives,
      activeReceiveIndex,
      turnOrdinal: ord,
      segments,
      activeSegmentIndex,
      ...(Array.isArray(row.speakerQueue) && row.speakerQueue.length > 0
        ? { speakerQueue: row.speakerQueue }
        : {}),
      ...(typeof row.speakerCharacterId === 'string' &&
      row.speakerCharacterId.trim()
        ? { speakerCharacterId: row.speakerCharacterId.trim() }
        : {}),
      ...(row.groupChatTurnState
        ? {
            groupChatTurnState: {
              quotaRemaining: { ...row.groupChatTurnState.quotaRemaining },
              speakCount: { ...row.groupChatTurnState.speakCount },
            },
          }
        : {}),
      ...(Array.isArray(row.plugins) && row.plugins.length > 0
        ? { plugins: row.plugins }
        : {}),
    }
  })
}

export async function fetchConversationTurns(
  conversationId: string,
): Promise<ChatTurnItem[]> {
  const res = await fetch(`/api/chat/conversations/${conversationId}/messages`)
  if (!res.ok) return []
  const j = (await res.json()) as MessagesApiResponse
  return parseConversationTurnsFromApi(j.turns ?? [])
}

export async function fetchConversationTurnsTail(
  conversationId: string,
  tail = CONVERSATION_UI_TAIL_LIMIT,
): Promise<{ turns: ChatTurnItem[]; page: MessagesPageInfo | null }> {
  const qs = new URLSearchParams({ tail: String(tail) })
  const res = await fetch(
    `/api/chat/conversations/${conversationId}/messages?${qs.toString()}`,
  )
  if (!res.ok) return { turns: [], page: null }
  const j = (await res.json()) as MessagesApiResponse
  return {
    turns: parseConversationTurnsFromApi(j.turns ?? []),
    page: j.page ?? null,
  }
}

export async function fetchConversationTurnsBefore(
  conversationId: string,
  beforeOrdinal: number,
  limit = CONVERSATION_UI_TAIL_LIMIT,
): Promise<{ turns: ChatTurnItem[]; page: MessagesPageInfo | null }> {
  const qs = new URLSearchParams({
    before: String(beforeOrdinal),
    limit: String(limit),
  })
  const res = await fetch(
    `/api/chat/conversations/${conversationId}/messages?${qs.toString()}`,
  )
  if (!res.ok) return { turns: [], page: null }
  const j = (await res.json()) as MessagesApiResponse
  return {
    turns: parseConversationTurnsFromApi(j.turns ?? []),
    page: j.page ?? null,
  }
}

/** 仅拉取 ordinal 闭区间 [from, to]（最多 50 轮，与插件 runBatch 一致） */
export async function fetchConversationTurnsRange(
  conversationId: string,
  from: number,
  to: number,
): Promise<ChatTurnItem[]> {
  const qs = new URLSearchParams({
    from: String(from),
    to: String(to),
  })
  const res = await fetch(
    `/api/chat/conversations/${conversationId}/messages?${qs.toString()}`,
  )
  if (!res.ok) return []
  const j = (await res.json()) as MessagesApiResponse
  return parseConversationTurnsFromApi(j.turns ?? [])
}

function turnToPatchPayload(turn: ChatTurnItem) {
  return {
    turnOrdinal: turn.turnOrdinal,
    userText: turn.user,
    receives: turn.receives.map((r) => ({
      id: r.id,
      content: r.content,
      ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.durationMs ? { durationMs: r.durationMs } : {}),
      ...(r.estimatedTokens ? { estimatedTokens: r.estimatedTokens } : {}),
      ...(r.completionTokens ? { completionTokens: r.completionTokens } : {}),
      ...(r.model ? { model: r.model } : {}),
    })),
    activeReceiveIndex: turn.activeReceiveIndex,
  }
}

export interface BatchTurnPatchResult {
  ok: number
  failed: { turnOrdinal: number; error: string }[]
}

/** 批量 PATCH 多轮（服务端按 chunk 合并读写） */
export async function persistTurnsBatchToServer(
  conversationId: string,
  turns: ChatTurnItem[],
): Promise<BatchTurnPatchResult> {
  if (turns.length === 0) return { ok: 0, failed: [] }
  try {
    const res = await fetch(
      `/api/chat/conversations/${conversationId}/turns/batch`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns: turns.map(turnToPatchPayload),
        }),
      },
    )
    if (!res.ok) {
      return {
        ok: 0,
        failed: turns.map((t) => ({
          turnOrdinal: t.turnOrdinal,
          error: `http_${res.status}`,
        })),
      }
    }
    const data = (await res.json()) as BatchTurnPatchResult
    return {
      ok: typeof data.ok === 'number' ? data.ok : 0,
      failed: Array.isArray(data.failed) ? data.failed : [],
    }
  } catch {
    return {
      ok: 0,
      failed: turns.map((t) => ({
        turnOrdinal: t.turnOrdinal,
        error: 'patch_failed',
      })),
    }
  }
}

export function mergeTurnFromPatchPersist(
  turn: ChatTurnItem,
  payload: TurnPatchPersistPayload,
): ChatTurnItem {
  const byId = new Map(payload.receives.map((r) => [r.id, r]))
  const receives = turn.receives.map((r) => {
    const fromServer = byId.get(r.id)
    if (!fromServer) return r
    const item: ReceiveItem = {
      ...r,
      content: fromServer.content,
    }
    if (typeof fromServer.reasoning === 'string' && fromServer.reasoning.length > 0) {
      item.reasoning = fromServer.reasoning
    } else {
      delete item.reasoning
    }
    return item
  })
  let ai = payload.activeReceiveIndex
  if (receives.length > 0) {
    ai = Math.min(Math.max(0, ai), receives.length - 1)
  }
  return {
    ...turn,
    user: payload.finalUserText,
    receives,
    activeReceiveIndex: ai,
    ...(payload.plugins !== undefined ? { plugins: payload.plugins } : {}),
  }
}

export async function persistTurnToServer(
  conversationId: string,
  turn: ChatTurnItem,
  opts?: { segmentIndex?: number },
): Promise<PersistTurnToServerResult> {
  try {
    const res = await fetch(
      `/api/chat/conversations/${conversationId}/turns/${turn.turnOrdinal}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTurnPatchRequestBody(turn, opts?.segmentIndex)),
      },
    )
    if (!res.ok) return { ok: false }
    const body = (await res.json()) as TurnPatchPersistPayload
    if (body?.ok !== true || typeof body.finalUserText !== 'string') {
      return { ok: true, turn }
    }
    return { ok: true, turn: mergeTurnFromPatchPersist(turn, body) }
  } catch {
    return { ok: false }
  }
}

export async function deleteTurnOnServer(
  conversationId: string,
  turnOrdinal: number,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(
    `/api/chat/conversations/${conversationId}/turns/${turnOrdinal}`,
    { method: 'DELETE' },
  )
  return { ok: res.ok, status: res.status }
}

export function applyPersistWarning(
  persist: ChatPersistPayload | undefined,
  onError: (message: string) => void,
  fallbackMessage: string,
): void {
  if (persist && !persist.ok) {
    const code =
      typeof persist.error === 'string' && persist.error.trim()
        ? persist.error.trim()
        : ''
    onError(
      (code ? translateApiError(code) : fallbackMessage).slice(0, 500),
    )
  }
}
