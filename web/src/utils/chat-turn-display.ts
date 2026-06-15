import type { ChatTurnItem } from '@/types/chat-turn'

/** 界面章回编号：与磁盘 turnOrdinal / chunk 文件名区间一致（0 起算，开场为第 0 回） */
export function turnLabelN(turn: ChatTurnItem, listIndex: number): number {
  if (typeof turn.turnOrdinal === 'number' && !Number.isNaN(turn.turnOrdinal)) {
    return turn.turnOrdinal
  }
  return listIndex
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

/** 该轮发送时组装的 prompt token（对应当前选中的助手变体） */
export function turnSendEstimatedTokens(turn: ChatTurnItem): number | null {
  const active = turn.receives[turn.activeReceiveIndex]
  const fromActive = active?.estimatedTokens
  if (typeof fromActive === 'number' && fromActive > 0) {
    return Math.round(fromActive)
  }
  for (const r of turn.receives) {
    const n = r?.estimatedTokens
    if (typeof n === 'number' && n > 0) return Math.round(n)
  }
  return null
}

/** @deprecated 使用 turnSendEstimatedTokens；保留别名避免误用 active receive */
export function assistantEstimatedTokens(turn: ChatTurnItem): number | null {
  return turnSendEstimatedTokens(turn)
}

export function assistantCompletionTokens(turn: ChatTurnItem): number | null {
  const r = turn.receives[turn.activeReceiveIndex]
  const n = r?.completionTokens
  return typeof n === 'number' && n > 0 ? Math.round(n) : null
}

/** 当前选中助手变体落盘时的模型名（runtime.model） */
export function assistantModelName(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  const m = r?.model
  return typeof m === 'string' && m.trim() ? m.trim() : ''
}

export function reasoningCharsCount(text: string): number {
  if (!text) return 0
  return text.replace(/\s+/g, '').length
}

export { characterImageUrl } from '@/utils/authenticated-media-url'
export type { PortraitImageSize } from '@/utils/authenticated-media-url'
