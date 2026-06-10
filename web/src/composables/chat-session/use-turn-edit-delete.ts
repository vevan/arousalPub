import type { ChatTurnItem, PersistTurnToServerResult } from '@/types/chat-turn'
import { assistantText } from '@/utils/chat-turn-display'
import { deleteTurnOnServer } from '@/utils/chat-messages'
import { computed, ref, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export function useTurnEditDelete(opts: {
  turns: Ref<ChatTurnItem[]>
  isConversationWritable: () => boolean
  replaceTurnAt: (listIndex: number, next: ChatTurnItem) => void
  persistTurnToServer: (turn: ChatTurnItem) => Promise<PersistTurnToServerResult>
  getConversationId: () => string
  loadMessages: () => Promise<void>
  setErrorText: (msg: string) => void
  t: ComposerTranslation
}) {
  const editingTurnOrdinal = ref<number | null>(null)
  const editingSide = ref<'user' | 'assistant' | null>(null)
  const editDraft = ref('')

  const deleteTarget = ref<'assistant' | 'wholeTurn' | null>(null)
  const deleteDialogOpen = ref(false)
  const deleteListIndex = ref<number | null>(null)

  function resetState() {
    editingTurnOrdinal.value = null
    editingSide.value = null
    editDraft.value = ''
    deleteTarget.value = null
    deleteDialogOpen.value = false
    deleteListIndex.value = null
  }

  function openEditAssistant(turn: ChatTurnItem) {
    editingTurnOrdinal.value = turn.turnOrdinal
    editingSide.value = 'assistant'
    editDraft.value = assistantText(turn)
  }

  function openEditUser(turn: ChatTurnItem) {
    editingTurnOrdinal.value = turn.turnOrdinal
    editingSide.value = 'user'
    editDraft.value = turn.user
  }

  function cancelEdit() {
    editingTurnOrdinal.value = null
    editingSide.value = null
    editDraft.value = ''
  }

  async function saveEdit(listIndex: number) {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn || editingTurnOrdinal.value !== turn.turnOrdinal) return
    const text = editDraft.value
    const side = editingSide.value
    if (side === 'user') {
      const draft: ChatTurnItem = { ...turn, user: text }
      cancelEdit()
      const result = await opts.persistTurnToServer(draft)
      if (result.ok) {
        opts.replaceTurnAt(listIndex, result.turn)
      }
      return
    }
    if (side === 'assistant') {
      const ai = turn.activeReceiveIndex
      const newReceives = turn.receives.map((r, j) =>
        j === ai ? { ...r, content: text } : r,
      )
      const draft: ChatTurnItem = { ...turn, receives: newReceives }
      cancelEdit()
      const result = await opts.persistTurnToServer(draft)
      if (result.ok) {
        opts.replaceTurnAt(listIndex, result.turn)
      }
    }
  }

  function requestDelete(listIndex: number) {
    deleteListIndex.value = listIndex
    deleteTarget.value = 'assistant'
    deleteDialogOpen.value = true
  }

  function requestDeleteWholeTurnFromUser(listIndex: number) {
    deleteListIndex.value = listIndex
    deleteTarget.value = 'wholeTurn'
    deleteDialogOpen.value = true
  }

  function cancelDelete() {
    deleteDialogOpen.value = false
    deleteListIndex.value = null
    deleteTarget.value = null
  }

  async function confirmDelete() {
    if (!opts.isConversationWritable()) return
    const listIndex = deleteListIndex.value
    const target = deleteTarget.value
    if (listIndex === null || !target) return
    const turn = opts.turns.value[listIndex]
    if (!turn) {
      cancelDelete()
      return
    }

    if (target === 'assistant' && turn.receives.length > 1) {
      const active = turn.activeReceiveIndex
      const newReceives = turn.receives.filter((_, j) => j !== active)
      const newActive = Math.min(active, newReceives.length - 1)
      const next: ChatTurnItem = {
        ...turn,
        receives: newReceives,
        activeReceiveIndex: newActive,
      }
      opts.replaceTurnAt(listIndex, next)
      cancelDelete()
      const result = await opts.persistTurnToServer(next)
      if (result.ok) {
        opts.replaceTurnAt(listIndex, result.turn)
      }
      return
    }

    try {
      const { ok, status } = await deleteTurnOnServer(
        opts.getConversationId(),
        turn.turnOrdinal,
      )
      if (ok) {
        cancelDelete()
        await opts.loadMessages()
        return
      }
      if (status === 404) {
        opts.turns.value = opts.turns.value
          .filter((_, i) => i !== listIndex)
          .map((t, i) => ({ ...t, turnOrdinal: i }))
        cancelDelete()
        return
      }
      opts.setErrorText(opts.t('chat.errors.deleteTurnFailed'))
    } catch {
      opts.setErrorText(opts.t('chat.errors.deleteTurnFailed'))
    }
    cancelDelete()
  }

  const deleteDialogMessage = computed(() => {
    const i = deleteListIndex.value
    const tgt = deleteTarget.value
    if (i === null || !tgt) return ''
    const turn = opts.turns.value[i]
    if (!turn) return ''
    if (tgt === 'assistant' && turn.receives.length > 1) {
      return opts.t('chat.deleteVariantConfirm')
    }
    return opts.t('chat.deleteTurnConfirm')
  })

  return {
    editingTurnOrdinal,
    editingSide,
    editDraft,
    deleteDialogOpen,
    deleteDialogMessage,
    resetState,
    openEditAssistant,
    openEditUser,
    cancelEdit,
    saveEdit,
    requestDelete,
    requestDeleteWholeTurnFromUser,
    cancelDelete,
    confirmDelete,
  }
}
