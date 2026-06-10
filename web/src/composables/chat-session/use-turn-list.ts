import type { ChatTurnItem, PersistTurnToServerResult, ReceiveItem } from '@/types/chat-turn'
import {
  fetchConversationTurns,
  persistTurnToServer as persistTurnToServerApi,
} from '@/utils/chat-messages'
import { nextTick, type Ref } from 'vue'

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
}) {
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
    try {
      opts.turns.value = await fetchConversationTurns(opts.getConversationId())
    } catch {
      /* ignore */
    } finally {
      await nextTick()
      await opts.scrollChatToBottom()
    }
  }

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
    refreshConversation,
  }
}
