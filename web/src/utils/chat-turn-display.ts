import type { ChatTurnItem } from '@/types/chat-turn'

export function turnLabelN(turn: ChatTurnItem, listIndex: number): number {
  if (typeof turn.turnOrdinal === 'number' && !Number.isNaN(turn.turnOrdinal)) {
    return turn.turnOrdinal + 1
  }
  return listIndex + 1
}

export function isOpeningTurn(turn: ChatTurnItem): boolean {
  return !turn.user.trim() && turn.receives.length > 0
}

export function assistantText(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  return r?.content ?? ''
}

export function assistantReasoning(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  const s = r?.reasoning
  return typeof s === 'string' ? s : ''
}

export function assistantDurationMs(turn: ChatTurnItem): number | null {
  const r = turn.receives[turn.activeReceiveIndex]
  const ms = r?.durationMs
  return typeof ms === 'number' && ms > 0 ? ms : null
}

export function assistantEstimatedTokens(turn: ChatTurnItem): number | null {
  const r = turn.receives[turn.activeReceiveIndex]
  const n = r?.estimatedTokens
  return typeof n === 'number' && n > 0 ? Math.round(n) : null
}

export function reasoningCharsCount(text: string): number {
  if (!text) return 0
  return text.replace(/\s+/g, '').length
}

export function characterImageUrl(id: string | null | undefined): string | null {
  const clean = typeof id === 'string' ? id.trim() : ''
  return clean ? `/api/characters/${clean}/image` : null
}
