import type { ChatPersistPayload, ChatTurnItem, ReceiveItem } from '@/types/chat-turn'
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
  }[]
  activeReceiveIndex?: number
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
  const j = (await res.json()) as { turns?: MessagesApiTurn[] }
  return parseConversationTurnsFromApi(j.turns ?? [])
}

export async function persistTurnToServer(
  conversationId: string,
  turn: ChatTurnItem,
): Promise<boolean> {
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
          })),
          activeReceiveIndex: turn.activeReceiveIndex,
        }),
      },
    )
    return res.ok
  } catch {
    return false
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
