import type {
  ChatPersistPayload,
  ChatTurnItem,
  ReceiveItem,
  TurnPatchPersistPayload,
  PersistTurnToServerResult,
} from '@/types/chat-turn'
import { translateApiError } from '@/utils/api-error-message'
import { allocateShortId } from '@/utils/short-id'

type MessagesApiTurn = {
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

export function parseConversationTurnsFromApi(
  raw: MessagesApiTurn[],
): ChatTurnItem[] {
  return raw.map((row, i) => {
    const ord =
      typeof row.turnOrdinal === 'number' && !Number.isNaN(row.turnOrdinal)
        ? row.turnOrdinal
        : i
    const user = typeof row.user === 'string' ? row.user : ''
    const used = new Set<string>()
    const receives = Array.isArray(row.receives)
      ? row.receives.map((r) => {
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
        })
      : []
    let ai =
      typeof row.activeReceiveIndex === 'number' &&
      !Number.isNaN(row.activeReceiveIndex)
        ? row.activeReceiveIndex
        : 0
    if (receives.length === 0) {
      return {
        user,
        receives: [],
        activeReceiveIndex: 0,
        turnOrdinal: ord,
      }
    }
    ai = Math.min(Math.max(0, ai), receives.length - 1)
    return {
      user,
      receives,
      activeReceiveIndex: ai,
      turnOrdinal: ord,
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
  }
}

export async function persistTurnToServer(
  conversationId: string,
  turn: ChatTurnItem,
): Promise<PersistTurnToServerResult> {
  try {
    const res = await fetch(
      `/api/chat/conversations/${conversationId}/turns/${turn.turnOrdinal}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
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
