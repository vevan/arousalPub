import type { ComposerInputHistory } from '@/utils/composer-input-history-storage'
import {
  pinComposerInputHistoryItem,
  pushComposerInputHistoryOnSend,
  readComposerInputHistory,
  trimComposerInputHistoryToLimits,
  unpinComposerInputHistoryItem,
  writeComposerInputHistory,
} from '@/utils/composer-input-history-storage'
import {
  readComposerInputHistoryLimits,
  writeComposerInputHistoryLimits,
  type ComposerInputHistoryLimits,
} from '@/utils/composer-input-history-limits'
import { writeComposerDraft } from '@/utils/composer-draft-storage'
import { ref, type Ref } from 'vue'

export function useComposerInputHistory(opts: {
  getConversationId: () => string
  getUserId: () => string
  userInput: Ref<string>
}) {
  const limits = ref<ComposerInputHistoryLimits>(readComposerInputHistoryLimits())
  const history = ref<ComposerInputHistory>({
    version: 1,
    pinned: [],
    recent: [],
  })

  function getLimits(): ComposerInputHistoryLimits {
    return limits.value
  }

  function persistHistory(): void {
    writeComposerInputHistory(
      opts.getConversationId(),
      history.value,
      opts.getUserId(),
      getLimits(),
    )
  }

  function loadHistoryForConversation(conversationId: string): void {
    const cid = conversationId.trim()
    history.value = cid
      ? readComposerInputHistory(cid, opts.getUserId(), getLimits())
      : { version: 1, pinned: [], recent: [] }
  }

  function switchConversationInputHistory(
    _oldId: string | undefined,
    newId: string,
  ): void {
    loadHistoryForConversation(newId)
  }

  function recordOnSend(rawText: string): void {
    const next = pushComposerInputHistoryOnSend(history.value, rawText, {
      recentMax: limits.value.recentMax,
    })
    history.value = next
    persistHistory()
  }

  function pinItem(text: string): boolean {
    const result = pinComposerInputHistoryItem(history.value, text, {
      pinnedMax: limits.value.pinnedMax,
    })
    if (!result.ok) return false
    history.value = result.history
    persistHistory()
    return true
  }

  function unpinItem(text: string): void {
    history.value = unpinComposerInputHistoryItem(history.value, text, {
      recentMax: limits.value.recentMax,
    })
    persistHistory()
  }

  function fillFromHistory(text: string): void {
    opts.userInput.value = text
    const cid = opts.getConversationId().trim()
    if (cid) {
      writeComposerDraft(cid, text, opts.getUserId())
    }
  }

  function applyLimits(next: Partial<ComposerInputHistoryLimits>): void {
    limits.value = writeComposerInputHistoryLimits({
      ...limits.value,
      ...next,
    })
    history.value = trimComposerInputHistoryToLimits(history.value, limits.value)
    persistHistory()
  }

  return {
    inputHistory: history,
    inputHistoryLimits: limits,
    recordOnSend,
    pinItem,
    unpinItem,
    fillFromHistory,
    applyInputHistoryLimits: applyLimits,
    switchConversationInputHistory,
  }
}
