import type { ChatPromptSnapshotEntry, ChatTurnItem } from '@/types/chat-turn'
import { formatPromptSnapshotForDisplay } from '@/utils/format-prompt-json-display'
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
  const turnPromptRawJson = ref('')
  const turnPromptIsEmpty = ref(false)
  const turnPromptCopied = ref(false)
  const turnPromptRawCopied = ref(false)

  async function copyTurnPromptText(
    text: string,
    flag: { value: boolean },
  ): Promise<void> {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      flag.value = true
      setTimeout(() => {
        flag.value = false
      }, 1200)
    } catch {
      /* ignore */
    }
  }

  async function copyTurnPromptDisplay() {
    await copyTurnPromptText(turnPromptDisplay.value, turnPromptCopied)
  }

  async function copyTurnPromptRaw() {
    await copyTurnPromptText(turnPromptRawJson.value, turnPromptRawCopied)
  }

  async function openTurnPromptSnapshot(turn: ChatTurnItem) {
    turnPromptDialogOpen.value = true
    turnPromptLoading.value = true
    turnPromptError.value = ''
    turnPromptDisplay.value = ''
    turnPromptRawJson.value = ''
    turnPromptIsEmpty.value = false
    turnPromptCopied.value = false
    turnPromptRawCopied.value = false
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
      turnPromptRawJson.value = JSON.stringify(entry, null, 2)
      turnPromptDisplay.value = formatPromptSnapshotForDisplay(entry)
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
    turnPromptRawJson,
    turnPromptIsEmpty,
    turnPromptCopied,
    turnPromptRawCopied,
    copyTurnPromptDisplay,
    copyTurnPromptRaw,
    openTurnPromptSnapshot,
  }
}
