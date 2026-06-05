import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload, ChatTurnItem } from '@/types/chat-turn'
import type { ConversationChatRequestPlugins } from '@/utils/chat-api'
import { isOpeningTurn } from '@/utils/chat-turn-display'
import { nextTurnOrdinal0 } from './turn-helpers.js'
import type { createChatCompletionRunner } from './completion.js'
import type { createReplyEventHub } from './reply-events.js'
import { nextTick, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

type CompletionRunner = ReturnType<typeof createChatCompletionRunner>
type ReplyEventHub = ReturnType<typeof createReplyEventHub>

export function useChatOutbound(opts: {
  turns: Ref<ChatTurnItem[]>
  userInput: Ref<string>
  loading: Ref<boolean>
  errorText: Ref<string>
  regeneratingTurnOrdinal: Ref<number | null>
  pendingSendEstimatedTokens: Ref<number | null>
  pendingReceiveCompletionTokens: Ref<number | null>
  streamingText: Ref<string>
  streamingReasoning: Ref<string>
  isConversationWritable: () => boolean
  parseCustomParamsOrThrow: CompletionRunner['parseCustomParamsOrThrow']
  customParamsErrorMessage: CompletionRunner['customParamsErrorMessage']
  assertApiReady: CompletionRunner['assertApiReady']
  runSend: CompletionRunner['runSend']
  runRegenerate: CompletionRunner['runRegenerate']
  startGenerationTimer: () => void
  stopGenerationTimer: () => number
  setPersistWarning: (persist?: ChatPersistPayload) => void
  appendPendingUserTurn: (userText: string, ord: number) => void
  rollbackPendingUserTurn: (ord: number, restoreUserText?: string) => void
  finalizePendingTurn: (ord: number, receive: ChatTurnItem['receives'][number]) => void
  replaceTurnAt: (listIndex: number, next: ChatTurnItem) => void
  persistTurnToServer: (turn: ChatTurnItem) => Promise<boolean>
  loadMessages: () => Promise<void>
  scrollChatToBottom: () => Promise<void>
  endRegeneratingUi: () => void
  emitAssistantReplyComplete: ReplyEventHub['emitAssistantReplyComplete']
  t: ComposerTranslation
}) {
  function beginRegeneratingUi(turnOrdinal: number) {
    opts.regeneratingTurnOrdinal.value = turnOrdinal
    opts.pendingSendEstimatedTokens.value = null
    opts.pendingReceiveCompletionTokens.value = null
    opts.streamingText.value = ''
    opts.streamingReasoning.value = ''
  }

  async function send() {
    if (!opts.isConversationWritable()) return
    opts.errorText.value = ''
    const userText = opts.userInput.value.trim()
    try {
      opts.parseCustomParamsOrThrow()
    } catch (e) {
      opts.errorText.value = opts.customParamsErrorMessage(e)
      return
    }

    const ord = nextTurnOrdinal0(opts.turns.value)
    opts.appendPendingUserTurn(userText, ord)
    opts.loading.value = true
    opts.startGenerationTimer()
    try {
      const { receive, traceId, persist, shouldReload } = await opts.runSend({
        userText,
      })
      opts.setPersistWarning(persist)
      opts.finalizePendingTurn(ord, receive)
      if (shouldReload) await opts.loadMessages()
      opts.emitAssistantReplyComplete({ mode: 'send', traceId })
    } catch (e) {
      opts.rollbackPendingUserTurn(ord, userText)
      opts.errorText.value =
        e instanceof Error ? e.message : opts.t('chat.errors.network')
    } finally {
      opts.stopGenerationTimer()
      opts.loading.value = false
    }
  }

  async function sendWithPlugins(
    userText: string,
    plugins: ConversationChatRequestPlugins,
  ) {
    if (!opts.isConversationWritable()) return
    opts.errorText.value = ''
    const trimmed = userText.trim()
    if (!trimmed) return
    try {
      opts.parseCustomParamsOrThrow()
    } catch (e) {
      opts.errorText.value = opts.customParamsErrorMessage(e)
      return
    }
    if (!opts.assertApiReady()) {
      opts.errorText.value = opts.t('chat.errors.requestFailedStatus', {
        status: 400,
      })
      return
    }

    const ord = nextTurnOrdinal0(opts.turns.value)
    opts.appendPendingUserTurn(trimmed, ord)
    opts.loading.value = true
    opts.startGenerationTimer()
    try {
      const { receive, traceId, persist, shouldReload } = await opts.runSend({
        userText: trimmed,
        plugins,
      })
      opts.setPersistWarning(persist)
      opts.finalizePendingTurn(ord, receive)
      if (shouldReload) await opts.loadMessages()
      opts.emitAssistantReplyComplete({ mode: 'send', traceId })
    } catch (e) {
      opts.rollbackPendingUserTurn(ord, trimmed)
      opts.errorText.value =
        e instanceof Error ? e.message : opts.t('chat.errors.network')
    } finally {
      opts.stopGenerationTimer()
      opts.loading.value = false
    }
  }

  async function regenerateAssistant(
    listIndex: number,
    trigger: PromptTrigger = 'regenerate',
  ) {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn || !turn.user.trim()) return
    if (opts.regeneratingTurnOrdinal.value !== null) return
    beginRegeneratingUi(turn.turnOrdinal)
    opts.errorText.value = ''
    opts.startGenerationTimer()
    try {
      try {
        opts.parseCustomParamsOrThrow()
      } catch (e) {
        opts.errorText.value = opts.customParamsErrorMessage(e)
        return
      }

      const { receive, traceId, persist, shouldReload } = await opts.runRegenerate({
        userText: turn.user,
        turnOrdinal: turn.turnOrdinal,
        promptTrigger: trigger,
      })
      opts.setPersistWarning(persist)

      const cur = opts.turns.value[listIndex]
      if (!cur) return
      const next: ChatTurnItem = {
        ...cur,
        receives: [...cur.receives, receive],
        activeReceiveIndex: cur.receives.length,
      }
      opts.replaceTurnAt(listIndex, next)
      opts.endRegeneratingUi()
      await nextTick()
      if (shouldReload) {
        await opts.loadMessages()
      } else {
        await opts.scrollChatToBottom()
      }
      opts.emitAssistantReplyComplete({ mode: 'regenerate', traceId })
    } catch (e) {
      opts.errorText.value =
        e instanceof Error ? e.message : opts.t('chat.errors.network')
    } finally {
      opts.stopGenerationTimer()
      opts.endRegeneratingUi()
    }
  }

  async function regenerateWithPlugins(
    listIndex: number,
    userText: string,
    plugins: ConversationChatRequestPlugins,
  ) {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn) return
    const trimmed = userText.trim()
    if (!trimmed) return
    if (opts.regeneratingTurnOrdinal.value !== null || opts.loading.value) return

    opts.errorText.value = ''
    try {
      opts.parseCustomParamsOrThrow()
    } catch (e) {
      opts.errorText.value = opts.customParamsErrorMessage(e)
      return
    }
    if (!opts.assertApiReady()) {
      opts.errorText.value = opts.t('chat.errors.requestFailedStatus', {
        status: 400,
      })
      return
    }

    beginRegeneratingUi(turn.turnOrdinal)
    opts.startGenerationTimer()
    try {
      const { receive, traceId, persist, shouldReload } = await opts.runRegenerate({
        userText: trimmed,
        turnOrdinal: turn.turnOrdinal,
        promptTrigger: 'regenerate',
        plugins,
      })
      opts.setPersistWarning(persist)

      const cur = opts.turns.value[listIndex]
      if (!cur) return
      const next: ChatTurnItem = {
        ...cur,
        user: trimmed,
        receives: [...cur.receives, receive],
        activeReceiveIndex: cur.receives.length,
      }
      opts.replaceTurnAt(listIndex, next)
      opts.endRegeneratingUi()
      await nextTick()
      if (shouldReload) {
        await opts.loadMessages()
      } else {
        await opts.scrollChatToBottom()
      }
      opts.emitAssistantReplyComplete({ mode: 'regenerate', traceId })
    } catch (e) {
      opts.errorText.value =
        e instanceof Error ? e.message : opts.t('chat.errors.network')
    } finally {
      opts.stopGenerationTimer()
      opts.endRegeneratingUi()
    }
  }

  function slideAssistant(listIndex: number, direction: 'left' | 'right') {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn || turn.receives.length === 0) return
    const len = turn.receives.length
    const a = turn.activeReceiveIndex

    const applyVariantSwitch = (next: ChatTurnItem) => {
      opts.replaceTurnAt(listIndex, next)
      void opts.persistTurnToServer(next)
      void nextTick().then(() => opts.scrollChatToBottom())
    }

    if (direction === 'left') {
      const nextIdx = a === 0 ? len - 1 : a - 1
      applyVariantSwitch({ ...turn, activeReceiveIndex: nextIdx })
      return
    }

    if (a === len - 1) {
      if (isOpeningTurn(turn)) {
        applyVariantSwitch({ ...turn, activeReceiveIndex: 0 })
        return
      }
      void regenerateAssistant(listIndex, 'swipe')
      return
    }
    applyVariantSwitch({ ...turn, activeReceiveIndex: a + 1 })
  }

  return {
    send,
    sendWithPlugins,
    regenerateAssistant,
    regenerateWithPlugins,
    slideAssistant,
  }
}
