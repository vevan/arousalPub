import type { ChatAuditSnapshotEntry, ChatTurnItem } from '@/types/chat-turn'
import { formatChatMessagesForDisplay } from '@/utils/format-prompt-json-display'
import { ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export function useTurnPrompt(opts: {
  getConversationId: () => string
  t: ComposerTranslation
}) {
  const turnPromptDialogOpen = ref(false)
  const turnPromptLoading = ref(false)
  const turnPromptError = ref('')
  const turnAuditEntry = ref<ChatAuditSnapshotEntry | null>(null)
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
    const entry = turnAuditEntry.value
    if (!entry?.messages?.length) return
    await copyTurnPromptText(
      formatChatMessagesForDisplay(entry.messages),
      turnPromptCopied,
    )
  }

  async function copyTurnPromptRaw() {
    await copyTurnPromptText(turnPromptRawJson.value, turnPromptRawCopied)
  }

  async function openTurnPromptSnapshot(turn: ChatTurnItem, segmentIndex?: number) {
    turnPromptDialogOpen.value = true
    turnPromptLoading.value = true
    turnPromptError.value = ''
    turnAuditEntry.value = null
    turnPromptRawJson.value = ''
    turnPromptIsEmpty.value = false
    turnPromptCopied.value = false
    turnPromptRawCopied.value = false
    const id = opts.getConversationId()
    const segIdx =
      typeof segmentIndex === 'number' &&
      Number.isInteger(segmentIndex) &&
      segmentIndex >= 0
        ? segmentIndex
        : typeof turn.activeSegmentIndex === 'number'
          ? turn.activeSegmentIndex
          : 0
    try {
      const res = await fetch(`/api/chat/conversations/${id}/chat-audit`)
      if (!res.ok) {
        turnPromptError.value = opts.t('chat.turnPromptLoadFailed')
        return
      }
      const data = (await res.json()) as { entries?: ChatAuditSnapshotEntry[] }
      const entries = Array.isArray(data.entries) ? data.entries : []
      const entriesForTurn = entries.filter((e) => e.turnOrdinal === turn.turnOrdinal)
      const exact = entriesForTurn.filter(
        (e) => (typeof e.segmentIndex === 'number' ? e.segmentIndex : 0) === segIdx,
      )
      let entry = exact.length ? exact[exact.length - 1] : null
      if (!entry) {
        turnPromptIsEmpty.value = true
        return
      }
      turnAuditEntry.value = entry
      turnPromptRawJson.value = JSON.stringify(entry, null, 2)
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
    turnAuditEntry,
    turnPromptRawJson,
    turnPromptIsEmpty,
    turnPromptCopied,
    turnPromptRawCopied,
    copyTurnPromptDisplay,
    copyTurnPromptRaw,
    openTurnPromptSnapshot,
  }
}
