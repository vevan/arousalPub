import type { ChatTurnItem, PersistTurnToServerResult } from '@/types/chat-turn'
import { assistantText } from '@/utils/chat-turn-display'
import { deleteTurnOnServer } from '@/utils/chat-messages'
import { getActiveSegmentIndex, getTurnSegments } from '@/utils/group-chat-turn'
import { computed, ref, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export function useTurnEditDelete(opts: {
  turns: Ref<ChatTurnItem[]>
  isConversationWritable: () => boolean
  replaceTurnAt: (listIndex: number, next: ChatTurnItem) => void
  persistTurnToServer: (
    turn: ChatTurnItem,
    patchOpts?: { segmentIndex?: number },
  ) => Promise<PersistTurnToServerResult>
  getConversationId: () => string
  loadMessages: () => Promise<void>
  setErrorText: (msg: string) => void
  t: ComposerTranslation
}) {
  const editingTurnOrdinal = ref<number | null>(null)
  const editingSegmentIndex = ref<number | null>(null)
  const editingSide = ref<'user' | 'assistant' | null>(null)
  const editDraft = ref('')

  const deleteTarget = ref<'assistant' | 'wholeTurn' | null>(null)
  const deleteDialogOpen = ref(false)
  const deleteListIndex = ref<number | null>(null)
  const deleteSegmentIndex = ref<number | null>(null)

  function resetState() {
    editingTurnOrdinal.value = null
    editingSegmentIndex.value = null
    editingSide.value = null
    editDraft.value = ''
    deleteTarget.value = null
    deleteDialogOpen.value = false
    deleteListIndex.value = null
    deleteSegmentIndex.value = null
  }

  function openEditAssistant(turn: ChatTurnItem, segmentIndex = 0) {
    editingTurnOrdinal.value = turn.turnOrdinal
    editingSegmentIndex.value = segmentIndex
    editingSide.value = 'assistant'
    editDraft.value = assistantText(turn, segmentIndex)
  }

  function openEditUser(turn: ChatTurnItem) {
    editingTurnOrdinal.value = turn.turnOrdinal
    editingSegmentIndex.value = null
    editingSide.value = 'user'
    editDraft.value = turn.user
  }

  function cancelEdit() {
    editingTurnOrdinal.value = null
    editingSegmentIndex.value = null
    editingSide.value = null
    editDraft.value = ''
  }

  function isEditingAssistantSegment(turnOrdinal: number, segmentIndex: number): boolean {
    return (
      editingTurnOrdinal.value === turnOrdinal &&
      editingSide.value === 'assistant' &&
      (editingSegmentIndex.value ?? 0) === segmentIndex
    )
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
      const segIdx = editingSegmentIndex.value ?? getActiveSegmentIndex(turn)
      const segments = getTurnSegments(turn)
      const seg = segments[segIdx]
      if (!seg) return
      const ai = seg.activeReceiveIndex
      const newReceives = seg.receives.map((r, j) =>
        j === ai ? { ...r, content: text } : r,
      )
      const nextSegments = [...segments]
      nextSegments[segIdx] = { ...seg, receives: newReceives }
      const draft: ChatTurnItem = {
        ...turn,
        segments: nextSegments,
        activeSegmentIndex: segIdx,
      }
      cancelEdit()
      const result = await opts.persistTurnToServer(draft, { segmentIndex: segIdx })
      if (result.ok) {
        opts.replaceTurnAt(listIndex, result.turn)
      }
    }
  }

  function requestDelete(listIndex: number, segmentIndex?: number) {
    deleteListIndex.value = listIndex
    deleteSegmentIndex.value = segmentIndex ?? null
    deleteTarget.value = 'assistant'
    deleteDialogOpen.value = true
  }

  function requestDeleteWholeTurnFromUser(listIndex: number) {
    deleteListIndex.value = listIndex
    deleteSegmentIndex.value = null
    deleteTarget.value = 'wholeTurn'
    deleteDialogOpen.value = true
  }

  function cancelDelete() {
    deleteDialogOpen.value = false
    deleteListIndex.value = null
    deleteSegmentIndex.value = null
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

    if (target === 'assistant') {
      const segIdx = deleteSegmentIndex.value ?? getActiveSegmentIndex(turn)
      const segments = getTurnSegments(turn)
      const seg = segments[segIdx]
      if (seg && seg.receives.length > 1) {
        const active = seg.activeReceiveIndex
        const newReceives = seg.receives.filter((_, j) => j !== active)
        const newActive = Math.min(active, newReceives.length - 1)
        const nextSegments = [...segments]
        nextSegments[segIdx] = {
          ...seg,
          receives: newReceives,
          activeReceiveIndex: newActive,
        }
        const next: ChatTurnItem = {
          ...turn,
          segments: nextSegments,
          activeSegmentIndex: segIdx,
        }
        opts.replaceTurnAt(listIndex, next)
        cancelDelete()
        const result = await opts.persistTurnToServer(next, { segmentIndex: segIdx })
        if (result.ok) {
          opts.replaceTurnAt(listIndex, result.turn)
        }
        return
      }
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
    if (tgt === 'assistant') {
      const segIdx = deleteSegmentIndex.value ?? getActiveSegmentIndex(turn)
      const seg = getTurnSegments(turn)[segIdx]
      if (seg && seg.receives.length > 1) {
        return opts.t('chat.deleteVariantConfirm')
      }
    }
    return opts.t('chat.deleteTurnConfirm')
  })

  return {
    editingTurnOrdinal,
    editingSegmentIndex,
    editingSide,
    editDraft,
    deleteDialogOpen,
    deleteDialogMessage,
    resetState,
    openEditAssistant,
    openEditUser,
    cancelEdit,
    saveEdit,
    isEditingAssistantSegment,
    requestDelete,
    requestDeleteWholeTurnFromUser,
    cancelDelete,
    confirmDelete,
  }
}
