import type { ChatTurnItem } from '@/types/chat-turn'
import type { RegexField } from '@/types/regex-rules'
import { useRegexRulesDisplayStore } from '@/stores/regex-rules-display'
import { assistantReasoning, assistantText } from '@/utils/chat-turn-display'
import {
  applyDisplayRegexToText,
  hasDisplayRulesForField,
} from '@/utils/regex-display-apply'
import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'

function computeTailOrdinal(turns: ChatTurnItem[]): number {
  if (turns.length === 0) return 0
  return Math.max(...turns.map((t) => t.turnOrdinal))
}

export function createRegexDisplayText(opts: {
  turns: Ref<ChatTurnItem[]>
  getUserId: () => string | null | undefined
}) {
  const store = useRegexRulesDisplayStore()
  const { rules } = storeToRefs(store)

  async function ensureRulesLoaded(): Promise<void> {
    const uid = opts.getUserId()?.trim()
    if (!uid) return
    await store.ensureLoaded(uid)
  }

  function applyFieldDisplay(
    text: string,
    field: RegexField,
    turnOrdinal: number,
  ): string {
    if (!text || !hasDisplayRulesForField(rules.value, field)) return text
    return applyDisplayRegexToText(text, rules.value, {
      field,
      turnOrdinal,
      tailOrdinal: computeTailOrdinal(opts.turns.value),
    })
  }

  function displayUserText(turn: ChatTurnItem): string {
    return applyFieldDisplay(turn.user, 'user', turn.turnOrdinal)
  }

  function displayAssistantText(turn: ChatTurnItem): string {
    return applyFieldDisplay(
      assistantText(turn),
      'assistant',
      turn.turnOrdinal,
    )
  }

  function displayAssistantReasoning(turn: ChatTurnItem): string {
    return applyFieldDisplay(
      assistantReasoning(turn),
      'reasoning',
      turn.turnOrdinal,
    )
  }

  function displayStreamingAssistantText(
    text: string,
    turnOrdinal: number,
  ): string {
    return applyFieldDisplay(text, 'assistant', turnOrdinal)
  }

  function displayStreamingReasoningText(
    text: string,
    turnOrdinal: number,
  ): string {
    return applyFieldDisplay(text, 'reasoning', turnOrdinal)
  }

  return {
    ensureRulesLoaded,
    displayUserText,
    displayAssistantText,
    displayAssistantReasoning,
    displayStreamingAssistantText,
    displayStreamingReasoningText,
  }
}
