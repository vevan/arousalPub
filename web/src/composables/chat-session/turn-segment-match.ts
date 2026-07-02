import type { ChatTurnItem } from '../../types/chat-turn.js'

export function isTurnAwaitingAssistantSegment(
  turnOrdinal: number,
  pendingSendTurnOrdinal: number | null,
  pendingSendSegmentIndex: number | null,
  segmentIndex?: number,
): boolean {
  if (pendingSendTurnOrdinal !== turnOrdinal) return false
  if (segmentIndex === undefined) return true
  if (pendingSendSegmentIndex === null) return segmentIndex === 0
  return pendingSendSegmentIndex === segmentIndex
}

export function isTurnRegeneratingAssistantSegment(
  turnOrdinal: number,
  regeneratingTurnOrdinal: number | null,
  regeneratingSegmentIndex: number | null,
  segmentIndex?: number,
): boolean {
  if (regeneratingTurnOrdinal !== turnOrdinal) return false
  if (segmentIndex === undefined) return true
  if (regeneratingSegmentIndex === null) return segmentIndex === 0
  return regeneratingSegmentIndex === segmentIndex
}

export function isAssistantSegmentLoading(
  turn: ChatTurnItem,
  pendingSendTurnOrdinal: number | null,
  pendingSendSegmentIndex: number | null,
  regeneratingTurnOrdinal: number | null,
  regeneratingSegmentIndex: number | null,
  segmentIndex?: number,
): boolean {
  return (
    isTurnAwaitingAssistantSegment(
      turn.turnOrdinal,
      pendingSendTurnOrdinal,
      pendingSendSegmentIndex,
      segmentIndex,
    ) ||
    isTurnRegeneratingAssistantSegment(
      turn.turnOrdinal,
      regeneratingTurnOrdinal,
      regeneratingSegmentIndex,
      segmentIndex,
    )
  )
}

export function isAssistantSwipeFooterVisible(opts: {
  segmentLoading: boolean
  listIndex: number
  lastListIndex: number
  receivesLength: number
  isEditingThisSegment: boolean
}): boolean {
  if (opts.segmentLoading) return false
  if (opts.listIndex !== opts.lastListIndex) return false
  if (opts.receivesLength === 0) return false
  if (opts.isEditingThisSegment) return false
  return true
}
