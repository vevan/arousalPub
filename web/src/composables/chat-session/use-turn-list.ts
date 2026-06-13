import type { ChatTurnItem, PersistTurnToServerResult, ReceiveItem } from '@/types/chat-turn'
import {
  CONVERSATION_UI_TAIL_LIMIT,
  fetchConversationTurnsBefore,
  fetchConversationTurnsTail,
  persistTurnToServer as persistTurnToServerApi,
} from '@/utils/chat-messages'
import { nextTick, ref, watch, type Ref } from 'vue'
import type { ChatScrollerHandle } from './use-chat-scroll.js'

const SCROLL_LOAD_THRESHOLD_PX = 120
const SCROLL_REARM_PX = 240
const LOAD_OLDER_COOLDOWN_MS = 500

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
  scrollChatToBottom: (opts?: { onlyIfNearBottom?: boolean }) => Promise<void>
  chatScrollEl: Ref<HTMLElement | null>
  chatScroller: Ref<ChatScrollerHandle | null>
  onLoadMessagesFailed: () => void
  onLoadOlderFailed: () => void
}) {
  const hasMoreBefore = ref(false)
  const loadingOlder = ref(false)
  const messagesLoading = ref(false)
  const initialScrollPending = ref(true)

  let autoLoadArmed = false
  let loadOlderCooldownUntil = 0
  let scrollHintRaf = 0

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

  async function restoreScrollAfterPrepend(anchorOrdinal: number) {
    await nextTick()
    const el = opts.chatScrollEl.value
    const prevScrollHeight = el?.scrollHeight ?? 0
    const anchorIndex = opts.turns.value.findIndex((t) => t.turnOrdinal === anchorOrdinal)
    const scroller = opts.chatScroller.value
    if (scroller && anchorIndex >= 0 && scroller.scrollToItem(anchorIndex)) {
      return
    }
    if (el) {
      el.scrollTop += el.scrollHeight - prevScrollHeight
    }
  }

  async function loadMessages() {
    messagesLoading.value = true
    initialScrollPending.value = true
    autoLoadArmed = false
    hasMoreBefore.value = false
    try {
      const { turns: loaded, page } = await fetchConversationTurnsTail(
        opts.getConversationId(),
        CONVERSATION_UI_TAIL_LIMIT,
      )
      if (page === null) {
        opts.onLoadMessagesFailed()
        return
      }
      opts.turns.value = loaded
      hasMoreBefore.value = page.hasMoreBefore ?? false
    } catch {
      opts.onLoadMessagesFailed()
    } finally {
      messagesLoading.value = false
      await opts.scrollChatToBottom()
      initialScrollPending.value = false
    }
  }

  async function loadOlderMessages(manual = false) {
    if (loadingOlder.value || !hasMoreBefore.value) return
    if (initialScrollPending.value) return
    if (!manual && Date.now() < loadOlderCooldownUntil) return

    const first = opts.turns.value[0]
    if (!first || first.turnOrdinal <= 0) {
      hasMoreBefore.value = false
      return
    }

    const anchorOrdinal = first.turnOrdinal
    loadingOlder.value = true
    if (!manual) autoLoadArmed = false
    try {
      const { turns: older, page } = await fetchConversationTurnsBefore(
        opts.getConversationId(),
        anchorOrdinal,
        CONVERSATION_UI_TAIL_LIMIT,
      )
      if (page === null) {
        opts.onLoadOlderFailed()
        return
      }
      if (older.length === 0) {
        hasMoreBefore.value = false
        return
      }
      opts.turns.value = mergeTurnsPrepend(opts.turns.value, older)
      hasMoreBefore.value = page?.hasMoreBefore ?? false
      await restoreScrollAfterPrepend(anchorOrdinal)
    } catch {
      opts.onLoadOlderFailed()
    } finally {
      loadingOlder.value = false
      if (!manual) {
        loadOlderCooldownUntil = Date.now() + LOAD_OLDER_COOLDOWN_MS
      }
    }
  }

  function maybeLoadOlderOnScroll() {
    const el = opts.chatScrollEl.value
    if (!el || loadingOlder.value || !hasMoreBefore.value) return
    if (initialScrollPending.value || messagesLoading.value) return
    if (Date.now() < loadOlderCooldownUntil) return

    if (el.scrollTop > SCROLL_REARM_PX) {
      autoLoadArmed = true
      return
    }
    if (!autoLoadArmed) return
    if (el.scrollTop <= SCROLL_LOAD_THRESHOLD_PX) {
      autoLoadArmed = false
      void loadOlderMessages(false)
    }
  }

  function scheduleLoadOlderCheck() {
    if (scrollHintRaf) return
    scrollHintRaf = requestAnimationFrame(() => {
      scrollHintRaf = 0
      maybeLoadOlderOnScroll()
    })
  }

  watch(
    () => opts.chatScrollEl.value,
    (el, _old, onCleanup) => {
      if (!el) return
      const handler = () => scheduleLoadOlderCheck()
      el.addEventListener('scroll', handler, { passive: true })
      onCleanup(() => {
        el.removeEventListener('scroll', handler)
        if (scrollHintRaf) {
          cancelAnimationFrame(scrollHintRaf)
          scrollHintRaf = 0
        }
      })
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
    initialScrollPending,
  }
}
