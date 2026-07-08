import type { ChatTurnItem } from '@/types/chat-turn'
import {
  getActiveReceive,
  getActiveReceiveIndex,
  getSegmentReceives,
  getTurnSegments,
} from '@/utils/group-chat-turn'

/** 界面章回编号：与磁盘 turnOrdinal / chunk 文件名区间一致（0 起算，开场为第 0 回） */
export function turnLabelN(turn: ChatTurnItem, listIndex: number): number {
  if (typeof turn.turnOrdinal === 'number' && !Number.isNaN(turn.turnOrdinal)) {
    return turn.turnOrdinal
  }
  return listIndex
}

export function isOpeningTurn(turn: ChatTurnItem): boolean {
  if (turn.user.trim()) return false
  return getTurnSegments(turn).some((seg) => seg.receives.length > 0)
}

export function assistantText(turn: ChatTurnItem, segmentIndex?: number): string {
  return getActiveReceive(turn, segmentIndex)?.content ?? ''
}

export function assistantReasoning(turn: ChatTurnItem, segmentIndex?: number): string {
  const s = getActiveReceive(turn, segmentIndex)?.reasoning
  return typeof s === 'string' ? s : ''
}

export function assistantDurationMs(
  turn: ChatTurnItem,
  segmentIndex?: number,
): number | null {
  const ms = getActiveReceive(turn, segmentIndex)?.durationMs
  return typeof ms === 'number' && ms > 0 ? ms : null
}

/** 该轮发送时组装的 prompt token（对应当前选中的助手变体） */
export function turnSendEstimatedTokens(turn: ChatTurnItem): number | null {
  for (const seg of getTurnSegments(turn)) {
    const active = seg.receives[seg.activeReceiveIndex]
    const fromActive = active?.estimatedTokens
    if (typeof fromActive === 'number' && fromActive > 0) {
      return Math.round(fromActive)
    }
    for (const r of seg.receives) {
      const n = r?.estimatedTokens
      if (typeof n === 'number' && n > 0) return Math.round(n)
    }
  }
  return null
}

export function assistantCompletionTokens(
  turn: ChatTurnItem,
  segmentIndex?: number,
): number | null {
  const n = getActiveReceive(turn, segmentIndex)?.completionTokens
  return typeof n === 'number' && n > 0 ? Math.round(n) : null
}

/** 当前选中助手变体落盘时的模型名（runtime.model） */
export function assistantModelName(turn: ChatTurnItem, segmentIndex?: number): string {
  const m = getActiveReceive(turn, segmentIndex)?.model
  return typeof m === 'string' && m.trim() ? m.trim() : ''
}

export function segmentReceiveCount(
  turn: ChatTurnItem,
  segmentIndex?: number,
): number {
  return getSegmentReceives(turn, segmentIndex).length
}

export function segmentActiveReceiveIndex(
  turn: ChatTurnItem,
  segmentIndex?: number,
): number {
  return getActiveReceiveIndex(turn, segmentIndex)
}

export function reasoningCharsCount(text: string): number {
  if (!text) return 0
  return text.replace(/\s+/g, '').length
}

export { characterImageUrl } from '@/utils/authenticated-media-url'
export type { PortraitImageSize } from '@/utils/authenticated-media-url'
