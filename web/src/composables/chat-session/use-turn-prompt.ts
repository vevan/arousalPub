import type { ChatPromptSnapshotEntry, ChatTurnItem } from '@/types/chat-turn'
import { ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export function useTurnPrompt(opts: {
  getConversationId: () => string
  t: ComposerTranslation
}) {
  const turnPromptDialogOpen = ref(false)
  const turnPromptLoading = ref(false)
  const turnPromptError = ref('')
  const turnPromptDisplay = ref('')
  const turnPromptIsEmpty = ref(false)

  async function openTurnPromptSnapshot(turn: ChatTurnItem) {
    turnPromptDialogOpen.value = true
    turnPromptLoading.value = true
    turnPromptError.value = ''
    turnPromptDisplay.value = ''
    turnPromptIsEmpty.value = false
    const id = opts.getConversationId()
    try {
      const res = await fetch(`/api/chat/conversations/${id}/chat-prompt`)
      if (!res.ok) {
        turnPromptError.value = opts.t('chat.turnPromptLoadFailed')
        return
      }
      const data = (await res.json()) as { entries?: ChatPromptSnapshotEntry[] }
      const entries = Array.isArray(data.entries) ? data.entries : []
      const match = entries.filter((e) => e.turnOrdinal === turn.turnOrdinal)
      const entry = match.length ? match[match.length - 1] : null
      if (!entry) {
        turnPromptIsEmpty.value = true
        return
      }
      turnPromptDisplay.value = JSON.stringify(entry, null, 2)
    } catch {
      turnPromptError.value = opts.t('chat.turnPromptLoadFailed')
    } finally {
      turnPromptLoading.value = false
    }
  }

  return {
    turnPromptDialogOpen,
    turnPromptLoading,
    turnPromptError,
    turnPromptDisplay,
    turnPromptIsEmpty,
    openTurnPromptSnapshot,
  }
}
