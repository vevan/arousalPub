import type { ChatTurnItem } from '@/types/chat-turn'
import {
  assistantCompletionTokens,
  assistantDurationMs,
  segmentReceiveCount,
  turnSendEstimatedTokens,
} from '@/utils/chat-turn-display'
import { formatDurationMs } from '@/utils/format-duration'
import type { Ref } from 'vue'
import {
  isAssistantSegmentLoading,
  isAssistantSwipeFooterVisible,
  isTurnAwaitingAssistantSegment,
} from './turn-segment-match.js'

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
    return isTurnAwaitingAssistantSegment(
      turn.turnOrdinal,
      opts.pendingSendTurnOrdinal.value,
      opts.pendingSendSegmentIndex.value,
      segmentIndex,
    )
  }

  function isAssistantBubbleLoading(turn: ChatTurnItem, segmentIndex?: number): boolean {
    return isAssistantSegmentLoading(
      turn,
      opts.pendingSendTurnOrdinal.value,
      opts.pendingSendSegmentIndex.value,
      opts.regeneratingTurnOrdinal.value,
      opts.regeneratingSegmentIndex.value,
      segmentIndex,
    )
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
      return formatDurationMs(opts.generationElapsedMs())
    }
    const d = assistantDurationMs(turn, segmentIndex)
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
    const n = assistantCompletionTokens(turn, segmentIndex)
    return n != null ? String(n) : null
  }

  function showAssistantSwipeFooter(
    turn: ChatTurnItem,
    listIndex: number,
    segmentIndex?: number,
  ): boolean {
    const segIdx = segmentIndex ?? 0
    return isAssistantSwipeFooterVisible({
      segmentLoading: isAssistantBubbleLoading(turn, segmentIndex),
      listIndex,
      lastListIndex: opts.turns.value.length - 1,
      receivesLength: segmentReceiveCount(turn, segIdx),
      isEditingThisSegment:
        opts.editingTurnOrdinal.value === turn.turnOrdinal &&
        opts.editingSide.value === 'assistant' &&
        (opts.editingSegmentIndex.value ?? 0) === segIdx,
    })
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
