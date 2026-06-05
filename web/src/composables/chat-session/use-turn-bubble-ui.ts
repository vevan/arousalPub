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
  pendingSendEstimatedTokens: Ref<number | null>
  pendingReceiveCompletionTokens: Ref<number | null>
  regeneratingTurnOrdinal: Ref<number | null>
  streamingText: Ref<string>
  streamEnabled: () => boolean
  generationElapsedMs: () => number
  editingTurnOrdinal: Ref<number | null>
  editingSide: Ref<'user' | 'assistant' | null>
}) {
  function isTurnAwaitingAssistant(turn: ChatTurnItem): boolean {
    return opts.pendingSendTurnOrdinal.value === turn.turnOrdinal
  }

  function isAssistantBubbleLoading(turn: ChatTurnItem): boolean {
    return (
      isTurnAwaitingAssistant(turn) ||
      opts.regeneratingTurnOrdinal.value === turn.turnOrdinal
    )
  }

  function showAssistantSkeleton(turn: ChatTurnItem): boolean {
    if (!isAssistantBubbleLoading(turn)) return false
    if (opts.streamEnabled() && opts.streamingText.value.trim()) return false
    return true
  }

  function isAssistantStreamingBubble(turn: ChatTurnItem): boolean {
    return (
      isAssistantBubbleLoading(turn) &&
      opts.streamEnabled() &&
      !!opts.streamingText.value.trim()
    )
  }

  function assistantTimerLabel(turn: ChatTurnItem): string | null {
    if (isAssistantBubbleLoading(turn)) {
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

  function assistantReceiveTokenLabel(turn: ChatTurnItem): string | null {
    const awaiting =
      opts.pendingSendTurnOrdinal.value === turn.turnOrdinal ||
      opts.regeneratingTurnOrdinal.value === turn.turnOrdinal
    if (awaiting) {
      const n = opts.pendingReceiveCompletionTokens.value
      if (n != null && n > 0) return String(n)
    }
    const n = assistantCompletionTokens(turn)
    return n != null ? String(n) : null
  }

  function showAssistantSwipeFooter(turn: ChatTurnItem, listIndex: number): boolean {
    if (isAssistantBubbleLoading(turn)) return false
    if (opts.pendingSendTurnOrdinal.value !== null) return false
    if (opts.regeneratingTurnOrdinal.value !== null) return false
    if (listIndex !== opts.turns.value.length - 1) return false
    if (turn.receives.length === 0) return false
    if (
      opts.editingTurnOrdinal.value === turn.turnOrdinal &&
      opts.editingSide.value === 'assistant'
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
