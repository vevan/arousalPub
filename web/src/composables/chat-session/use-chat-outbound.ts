import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload, ChatTurnItem, PersistTurnToServerResult } from '@/types/chat-turn'
import { resolveFinalUserTextAfterPersist, applyRetroPersistToTurns, applyPersistTurnPlugins } from '@/utils/persist-display'
import { isAbortError } from '@/utils/abort-error'
import type { ConversationChatRequestPlugins } from '@/utils/chat-api'
import { allocateShortId } from '@/utils/short-id'
import { isOpeningTurn } from '@/utils/chat-turn-display'
import { buildReceiveItem, collectUsedReceiveIds, nextTurnOrdinal0 } from './turn-helpers.js'
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
  abortChatGeneration: CompletionRunner['abortChatGeneration']
  getModel: () => string
  startGenerationTimer: () => void
  stopGenerationTimer: () => number
  setPersistWarning: (persist?: ChatPersistPayload) => void
  appendPendingUserTurn: (userText: string, ord: number) => void
  rollbackPendingUserTurn: (ord: number, restoreUserText?: string) => void
  finalizePendingTurn: (
    ord: number,
    receive: ChatTurnItem['receives'][number],
    finalUserText?: string,
  ) => void
  replaceTurnAt: (listIndex: number, next: ChatTurnItem) => void
  persistTurnToServer: (turn: ChatTurnItem) => Promise<PersistTurnToServerResult>
  loadMessages: () => Promise<void>
  scrollChatToBottom: () => Promise<void>
  endRegeneratingUi: () => void
  emitAssistantReplyComplete: ReplyEventHub['emitAssistantReplyComplete']
  t: ComposerTranslation
}) {
  function applyPersistRetroPatches(persist?: ChatPersistPayload) {
    opts.setPersistWarning(persist)
    let next = opts.turns.value
    if (persist?.retro?.length) {
      next = applyRetroPersistToTurns(next, persist)
    }
    next = applyPersistTurnPlugins(next, persist)
    opts.turns.value = next
  }

  function partialReceiveFromStream(durationMs: number) {
    const content = opts.streamingText.value
    const reasoning = opts.streamingReasoning.value.trim() || undefined
    if (!content.trim() && !reasoning) return null
    return buildReceiveItem(
      opts.getModel(),
      allocateShortId(collectUsedReceiveIds(opts.turns.value)),
      content,
      {
        reasoning,
        durationMs,
      },
    )
  }

  function finalizeAbortedRegenerate(listIndex: number, durationMs: number) {
    const receive = partialReceiveFromStream(durationMs)
    if (!receive) return
    const cur = opts.turns.value[listIndex]
    if (!cur) return
    opts.replaceTurnAt(listIndex, {
      ...cur,
      receives: [...cur.receives, receive],
      activeReceiveIndex: cur.receives.length,
    })
  }

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
      applyPersistRetroPatches(persist)
      opts.finalizePendingTurn(
        ord,
        receive,
        resolveFinalUserTextAfterPersist(persist),
      )
      if (shouldReload) await opts.loadMessages()
      opts.emitAssistantReplyComplete({ mode: 'send', traceId })
    } catch (e) {
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        const receive = partialReceiveFromStream(durationMs)
        if (receive) {
          opts.finalizePendingTurn(ord, receive)
        } else {
          opts.rollbackPendingUserTurn(ord, userText)
        }
      } else {
        opts.rollbackPendingUserTurn(ord, userText)
        opts.errorText.value =
          e instanceof Error ? e.message : opts.t('chat.errors.network')
      }
    } finally {
      if (opts.loading.value) {
        opts.stopGenerationTimer()
        opts.loading.value = false
      }
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
      applyPersistRetroPatches(persist)
      opts.finalizePendingTurn(
        ord,
        receive,
        resolveFinalUserTextAfterPersist(persist),
      )
      if (shouldReload) await opts.loadMessages()
      opts.emitAssistantReplyComplete({ mode: 'send', traceId })
    } catch (e) {
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        const receive = partialReceiveFromStream(durationMs)
        if (receive) {
          opts.finalizePendingTurn(ord, receive)
        } else {
          opts.rollbackPendingUserTurn(ord, trimmed)
        }
      } else {
        opts.rollbackPendingUserTurn(ord, trimmed)
        opts.errorText.value =
          e instanceof Error ? e.message : opts.t('chat.errors.network')
      }
    } finally {
      if (opts.loading.value) {
        opts.stopGenerationTimer()
        opts.loading.value = false
      }
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
      applyPersistRetroPatches(persist)

      const cur = opts.turns.value[listIndex]
      if (!cur) return
      const finalUser = resolveFinalUserTextAfterPersist(persist)
      const next: ChatTurnItem = {
        ...cur,
        ...(finalUser !== undefined ? { user: finalUser } : {}),
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
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        finalizeAbortedRegenerate(listIndex, durationMs)
        await nextTick()
        await opts.scrollChatToBottom()
      } else {
        opts.errorText.value =
          e instanceof Error ? e.message : opts.t('chat.errors.network')
      }
    } finally {
      if (opts.regeneratingTurnOrdinal.value !== null) {
        opts.stopGenerationTimer()
        opts.endRegeneratingUi()
      }
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
      applyPersistRetroPatches(persist)

      const cur = opts.turns.value[listIndex]
      if (!cur) return
      const finalUser = resolveFinalUserTextAfterPersist(persist) ?? trimmed
      const next: ChatTurnItem = {
        ...cur,
        user: finalUser,
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
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        finalizeAbortedRegenerate(listIndex, durationMs)
        await nextTick()
        await opts.scrollChatToBottom()
      } else {
        opts.errorText.value =
          e instanceof Error ? e.message : opts.t('chat.errors.network')
      }
    } finally {
      if (opts.regeneratingTurnOrdinal.value !== null) {
        opts.stopGenerationTimer()
        opts.endRegeneratingUi()
      }
    }
  }

  function abortCurrentReply() {
    opts.abortChatGeneration()
  }

  function slideAssistant(listIndex: number, direction: 'left' | 'right') {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn || turn.receives.length === 0) return
    const len = turn.receives.length
    const a = turn.activeReceiveIndex

    const applyVariantSwitch = (next: ChatTurnItem) => {
      void opts.persistTurnToServer(next).then((result) => {
        if (result.ok) {
          opts.replaceTurnAt(listIndex, result.turn)
        } else {
          opts.replaceTurnAt(listIndex, next)
        }
        void nextTick().then(() => opts.scrollChatToBottom())
      })
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
    abortCurrentReply,
  }
}
