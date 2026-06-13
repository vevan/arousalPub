import type { ChatTurnItem, PersistTurnToServerResult, ReceiveItem } from '@/types/chat-turn'
import {
  CONVERSATION_UI_TAIL_LIMIT,
  fetchConversationTurnsBefore,
  fetchConversationTurnsTail,
  persistTurnToServer as persistTurnToServerApi,
} from '@/utils/chat-messages'
import { nextTick, ref, watch, type Ref } from 'vue'

const SCROLL_LOAD_THRESHOLD_PX = 120

function mergeTurnsPrepend(
  existing: ChatTurnItem[],
  older: ChatTurnItem[],
): ChatTurnItem[] {
  if (older.length === 0) return existing
  const seen = new Set(existing.map((t) => t.turnOrdinal))
  const filtered = older.filter((t) => !seen.has(t.turnOrdinal))
  if (filtered.length === 0) return existing
  return [...filtered, ...existing].sort((a, b) => a.turnOrdinal - b.turnOrdinal)
}

export function useTurnList(opts: {
  getConversationId: () => string
  turns: Ref<ChatTurnItem[]>
  userInput: Ref<string>
  pendingSendTurnOrdinal: Ref<number | null>
  pendingSendEstimatedTokens: Ref<number | null>
  pendingReceiveCompletionTokens: Ref<number | null>
  streamingText: Ref<string>
  streamingReasoning: Ref<string>
  clearDraftAfterSend: (conversationId: string) => void
  scrollChatToBottom: () => Promise<void>
  chatScrollEl: Ref<HTMLElement | null>
}) {
  const hasMoreBefore = ref(false)
  const loadingOlder = ref(false)
  const messagesLoading = ref(false)

  function replaceTurnAt(listIndex: number, next: ChatTurnItem) {
    opts.turns.value = opts.turns.value.map((t, i) => (i === listIndex ? next : t))
  }

  function clearPendingSend() {
    opts.pendingSendTurnOrdinal.value = null
    opts.pendingSendEstimatedTokens.value = null
    opts.pendingReceiveCompletionTokens.value = null
    opts.streamingText.value = ''
    opts.streamingReasoning.value = ''
  }

  function appendPendingUserTurn(userText: string, ord: number) {
    opts.turns.value = [
      ...opts.turns.value,
      {
        user: userText,
        receives: [],
        activeReceiveIndex: 0,
        turnOrdinal: ord,
      },
    ]
    opts.userInput.value = ''
    opts.clearDraftAfterSend(opts.getConversationId())
    opts.pendingSendTurnOrdinal.value = ord
    void opts.scrollChatToBottom()
  }

  function rollbackPendingUserTurn(ord: number, restoreUserText?: string) {
    opts.turns.value = opts.turns.value.filter((t) => t.turnOrdinal !== ord)
    clearPendingSend()
    if (restoreUserText) opts.userInput.value = restoreUserText
  }

  function finalizePendingTurn(
    ord: number,
    receive: ReceiveItem,
    finalUserText?: string,
  ) {
    const sendEt = opts.pendingSendEstimatedTokens.value
    const recvCt = opts.pendingReceiveCompletionTokens.value
    const merged: ReceiveItem = {
      ...receive,
      ...(sendEt != null && sendEt > 0 && !receive.estimatedTokens
        ? { estimatedTokens: sendEt }
        : {}),
      ...(recvCt != null && recvCt > 0 && !receive.completionTokens
        ? { completionTokens: recvCt }
        : {}),
    }
    const idx = opts.turns.value.findIndex((t) => t.turnOrdinal === ord)
    if (idx >= 0) {
      const cur = opts.turns.value[idx]
      replaceTurnAt(idx, {
        ...cur,
        ...(finalUserText !== undefined ? { user: finalUserText } : {}),
        receives: [merged],
        activeReceiveIndex: 0,
      })
    }
    clearPendingSend()
  }

  async function persistTurnToServer(turn: ChatTurnItem): Promise<PersistTurnToServerResult> {
    return persistTurnToServerApi(opts.getConversationId(), turn)
  }

  async function loadMessages() {
    messagesLoading.value = true
    hasMoreBefore.value = false
    try {
      const { turns: loaded, page } = await fetchConversationTurnsTail(
        opts.getConversationId(),
        CONVERSATION_UI_TAIL_LIMIT,
      )
      opts.turns.value = loaded
      hasMoreBefore.value = page?.hasMoreBefore ?? false
    } catch {
      /* ignore */
    } finally {
      messagesLoading.value = false
      await nextTick()
      await opts.scrollChatToBottom()
    }
  }

  async function loadOlderMessages() {
    if (loadingOlder.value || !hasMoreBefore.value) return
    const first = opts.turns.value[0]
    if (!first || first.turnOrdinal <= 0) {
      hasMoreBefore.value = false
      return
    }
    loadingOlder.value = true
    const el = opts.chatScrollEl.value
    const prevScrollHeight = el?.scrollHeight ?? 0
    try {
      const { turns: older, page } = await fetchConversationTurnsBefore(
        opts.getConversationId(),
        first.turnOrdinal,
        CONVERSATION_UI_TAIL_LIMIT,
      )
      if (older.length === 0) {
        hasMoreBefore.value = false
        return
      }
      opts.turns.value = mergeTurnsPrepend(opts.turns.value, older)
      hasMoreBefore.value = page?.hasMoreBefore ?? false
      await nextTick()
      if (el) {
        el.scrollTop += el.scrollHeight - prevScrollHeight
      }
    } catch {
      /* ignore */
    } finally {
      loadingOlder.value = false
    }
  }

  function maybeLoadOlderOnScroll() {
    const el = opts.chatScrollEl.value
    if (!el || loadingOlder.value || !hasMoreBefore.value) return
    if (el.scrollTop <= SCROLL_LOAD_THRESHOLD_PX) {
      void loadOlderMessages()
    }
  }

  watch(
    () => opts.chatScrollEl.value,
    (el, _old, onCleanup) => {
      if (!el) return
      const handler = () => maybeLoadOlderOnScroll()
      el.addEventListener('scroll', handler, { passive: true })
      onCleanup(() => el.removeEventListener('scroll', handler))
    },
  )

  async function refreshConversation(): Promise<void> {
    await loadMessages()
  }

  return {
    replaceTurnAt,
    clearPendingSend,
    appendPendingUserTurn,
    rollbackPendingUserTurn,
    finalizePendingTurn,
    persistTurnToServer,
    loadMessages,
    loadOlderMessages,
    refreshConversation,
    hasMoreBefore,
    loadingOlder,
    messagesLoading,
  }
}
