import type { ChatTurnItem } from '@/types/chat-turn'
import {
  assistantCompletionTokens,
  assistantDurationMs,
  turnSendEstimatedTokens,
} from '@/utils/chat-turn-display'
import { formatDurationMs } from '@/utils/format-duration'
import type { Ref } from 'vue'

export function useTurnBubbleUi(opts: {
  turns: Ref<ChatTurnItem[]>
  pendingSendTurnOrdinal: Ref<number | null>
  pendingSendSegmentIndex: Ref<number | null>
  pendingSendEstimatedTokens: Ref<number | null>
  pendingReceiveCompletionTokens: Ref<number | null>
  regeneratingTurnOrdinal: Ref<number | null>
  regeneratingSegmentIndex: Ref<number | null>
  streamingText: Ref<string>
  streamEnabled: () => boolean
  generationElapsedMs: () => number
  editingTurnOrdinal: Ref<number | null>
  editingSegmentIndex: Ref<number | null>
  editingSide: Ref<'user' | 'assistant' | null>
}) {
  function isTurnAwaitingAssistant(turn: ChatTurnItem, segmentIndex?: number): boolean {
    if (opts.pendingSendTurnOrdinal.value !== turn.turnOrdinal) return false
    const pendingSeg = opts.pendingSendSegmentIndex.value
    if (pendingSeg === null) return segmentIndex === undefined || segmentIndex === 0
    return pendingSeg === segmentIndex
  }

  function isAssistantBubbleLoading(turn: ChatTurnItem, segmentIndex?: number): boolean {
    if (isTurnAwaitingAssistant(turn, segmentIndex)) return true
    if (opts.regeneratingTurnOrdinal.value === turn.turnOrdinal) {
      const regSeg = opts.regeneratingSegmentIndex.value
      if (regSeg === null) return segmentIndex === undefined || segmentIndex === 0
      return regSeg === segmentIndex
    }
    return false
  }

  function showAssistantSkeleton(turn: ChatTurnItem, segmentIndex?: number): boolean {
    if (!isAssistantBubbleLoading(turn, segmentIndex)) return false
    if (opts.streamEnabled() && opts.streamingText.value.trim()) return false
    return true
  }

  function isAssistantStreamingBubble(turn: ChatTurnItem, segmentIndex?: number): boolean {
    return (
      isAssistantBubbleLoading(turn, segmentIndex) &&
      opts.streamEnabled() &&
      !!opts.streamingText.value.trim()
    )
  }

  function assistantTimerLabel(turn: ChatTurnItem, segmentIndex?: number): string | null {
    if (isAssistantBubbleLoading(turn, segmentIndex)) {
      const ms = opts.generationElapsedMs()
      return ms > 0 ? formatDurationMs(ms) : null
    }
    const d = assistantDurationMs(turn)
    return d != null ? formatDurationMs(d) : null
  }

  function userSendTokenLabel(turn: ChatTurnItem): string | null {
    const awaiting =
      opts.pendingSendTurnOrdinal.value === turn.turnOrdinal ||
      opts.regeneratingTurnOrdinal.value === turn.turnOrdinal
    if (awaiting) {
      const pending = opts.pendingSendEstimatedTokens.value
      if (pending != null && pending > 0) return String(pending)
    }
    const n = turnSendEstimatedTokens(turn)
    return n != null ? String(n) : null
  }

  function assistantReceiveTokenLabel(
    turn: ChatTurnItem,
    segmentIndex?: number,
  ): string | null {
    const awaiting = isAssistantBubbleLoading(turn, segmentIndex)
    if (awaiting) {
      const n = opts.pendingReceiveCompletionTokens.value
      if (n != null && n > 0) return String(n)
    }
    const n = assistantCompletionTokens(turn)
    return n != null ? String(n) : null
  }

  function showAssistantSwipeFooter(
    turn: ChatTurnItem,
    listIndex: number,
    segmentIndex?: number,
  ): boolean {
    if (isAssistantBubbleLoading(turn, segmentIndex)) return false
    if (opts.pendingSendTurnOrdinal.value !== null) return false
    if (opts.regeneratingTurnOrdinal.value !== null) return false
    if (listIndex !== opts.turns.value.length - 1) return false
    if (turn.receives.length === 0) return false
    const segIdx = segmentIndex ?? 0
    if (
      opts.editingTurnOrdinal.value === turn.turnOrdinal &&
      opts.editingSide.value === 'assistant' &&
      (opts.editingSegmentIndex.value ?? 0) === segIdx
    ) {
      return false
    }
    return true
  }

  return {
    isTurnAwaitingAssistant,
    isAssistantBubbleLoading,
    showAssistantSkeleton,
    isAssistantStreamingBubble,
    assistantTimerLabel,
    userSendTokenLabel,
    assistantReceiveTokenLabel,
    showAssistantSwipeFooter,
  }
}
