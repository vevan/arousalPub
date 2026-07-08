import type { ChatTurnItem, ReceiveItem } from '@/types/chat-turn'
import { getTurnSegments } from '@/utils/group-chat-turn'

export function collectUsedReceiveIds(turns: ChatTurnItem[]): Set<string> {
  const used = new Set<string>()
  for (const t of turns) {
    for (const seg of getTurnSegments(t)) {
      for (const r of seg.receives) {
        if (r.id?.trim()) used.add(r.id.trim())
      }
    }
  }
  return used
}

export function nextTurnOrdinal0(turns: ChatTurnItem[]): number {
  if (turns.length === 0) return 0
  return Math.max(...turns.map((t) => t.turnOrdinal)) + 1
}

export function buildReceiveItem(
  model: string,
  id: string,
  content: string,
  opts: {
    reasoning?: string
    durationMs?: number
    estimatedTokens?: number
    completionTokens?: number
  } = {},
): ReceiveItem {
  const trimmedModel = model.trim()
  return {
    id,
    content,
    ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
    ...(opts.durationMs && opts.durationMs > 0 ? { durationMs: opts.durationMs } : {}),
    ...(opts.estimatedTokens && opts.estimatedTokens > 0
      ? { estimatedTokens: opts.estimatedTokens }
      : {}),
    ...(opts.completionTokens && opts.completionTokens > 0
      ? { completionTokens: opts.completionTokens }
      : {}),
    ...(trimmedModel ? { model: trimmedModel } : {}),
  }
}

export function isLastUserTurn(turns: ChatTurnItem[], turn: ChatTurnItem): boolean {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].user.trim()) {
      return turns[i].turnOrdinal === turn.turnOrdinal
    }
  }
  return false
}
