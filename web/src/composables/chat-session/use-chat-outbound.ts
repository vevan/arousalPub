import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload, ChatTurnItem, PersistTurnToServerResult } from '@/types/chat-turn'
import { resolveFinalUserTextAfterPersist, applyRetroPersistToTurns, applyPersistTurnPlugins } from '@/utils/persist-display'
import { isAbortError } from '@/utils/abort-error'
import type { ConversationChatRequestPlugins } from '@/utils/chat-api'
import { allocateShortId } from '@/utils/short-id'
import { isOpeningTurn } from '@/utils/chat-turn-display'
import { submitComposerParse, hasUnmatchedAtSlashNames } from '@/utils/composer-slash'
import {
  defaultGroupChatSettings,
  type GroupChatSettings,
} from '@/utils/group-chat-settings'
import {
  resolveSpeakerQueueIds,
  type PendingGroupContinue,
  getActiveSegmentIndex,
  getTurnSegmentsForUi,
} from '@/utils/group-chat-turn'
import { buildReceiveItem, collectUsedReceiveIds, nextTurnOrdinal0 } from './turn-helpers.js'
import type { createChatCompletionRunner } from './completion.js'
import type { createReplyEventHub } from './reply-events.js'
import { nextTick, ref, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

type CompletionRunner = ReturnType<typeof createChatCompletionRunner>
type ReplyEventHub = ReturnType<typeof createReplyEventHub>

export function useChatOutbound(opts: {
  turns: Ref<ChatTurnItem[]>
  userInput: Ref<string>
  loading: Ref<boolean>
  errorText: Ref<string>
  regeneratingTurnOrdinal: Ref<number | null>
  pendingSendTurnOrdinal: Ref<number | null>
  pendingSendSegmentIndex: Ref<number | null>
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
  runGroupContinue: CompletionRunner['runGroupContinue']
  abortChatGeneration: CompletionRunner['abortChatGeneration']
  getModel: () => string
  startGenerationTimer: () => void
  stopGenerationTimer: () => number
  setPersistWarning: (persist?: ChatPersistPayload) => void
  appendPendingUserTurn: (
    userText: string,
    ord: number,
    meta?: { speakerCharacterId?: string; speakerQueue?: string[] },
  ) => void
  rollbackPendingUserTurn: (ord: number, restoreUserText?: string) => void
  appendPendingSegment: (
    ord: number,
    segmentIndex: number,
    speakerCharacterId: string,
  ) => void
  rollbackPendingSegment: (ord: number, segmentIndex: number) => void
  finalizePendingTurn: (
    ord: number,
    receive: ChatTurnItem['receives'][number],
    finalUserText?: string,
    meta?: {
      speakerCharacterId?: string
      speakerQueue?: string[]
      segmentIndex?: number
      activeSegmentIndex?: number
    },
  ) => void
  finalizePendingSegment: (
    ord: number,
    receive: ChatTurnItem['receives'][number],
    meta: {
      segmentIndex: number
      speakerCharacterId: string
      activeSegmentIndex: number
    },
  ) => void
  replaceTurnAt: (listIndex: number, next: ChatTurnItem) => void
  persistTurnToServer: (
    turn: ChatTurnItem,
    patchOpts?: { segmentIndex?: number },
  ) => Promise<PersistTurnToServerResult>
  loadMessages: () => Promise<void>
  scrollChatToBottom: () => Promise<void>
  endRegeneratingUi: () => void
  emitAssistantReplyComplete: ReplyEventHub['emitAssistantReplyComplete']
  recordInputHistoryOnSend?: (text: string) => void
  getBoundDisplayNames?: () => readonly string[]
  getCharacterIds?: () => readonly string[]
  isGroupChatEnabled?: () => boolean
  getGroupChatSettings?: () => GroupChatSettings
  clearComposerAfterSlash?: () => void
  scrollToTurnOrdinal: (
    turnOrdinal: number,
  ) => Promise<'ok' | 'not_found' | 'future'>
  t: ComposerTranslation
}) {
  const pendingGroupContinue = ref<PendingGroupContinue | null>(null)
  const regeneratingSegmentIndex = ref<number | null>(null)
  const groupChatNoticeOpen = ref(false)
  const groupChatNoticeMessage = ref('')

  function resolveTurnListIndex(
    turnOrd: number,
    listIndexHint?: number,
  ): number {
    if (
      typeof listIndexHint === 'number' &&
      listIndexHint >= 0 &&
      opts.turns.value[listIndexHint]?.turnOrdinal === turnOrd
    ) {
      return listIndexHint
    }
    return opts.turns.value.findIndex((t) => t.turnOrdinal === turnOrd)
  }

  function buildPendingContinueFromPersist(
    persist: ChatPersistPayload | undefined,
    listIndexHint?: number,
  ): PendingGroupContinue | null {
    const nextId = persist?.nextSpeakerCharacterId?.trim()
    const turnOrd = persist?.turnOrdinal
    if (!nextId || typeof turnOrd !== 'number') return null
    const listIndex = resolveTurnListIndex(turnOrd, listIndexHint)
    if (listIndex < 0) return null
    const turn = opts.turns.value[listIndex]
    if (!turn || turn.turnOrdinal !== turnOrd) return null
    const segments = getTurnSegmentsForUi(turn)
    const afterSegmentIndex =
      typeof persist?.activeSegmentIndex === 'number'
        ? persist.activeSegmentIndex
        : Math.max(0, segments.length - 1)
    return {
      turnOrdinal: turnOrd,
      listIndex,
      afterSegmentIndex,
      nextSpeakerCharacterId: nextId,
    }
  }

  /** 更新 pending UI；若应 autoContinue 则返回待链式 continue 的 payload */
  function updatePendingContinueFromPersist(
    persist: ChatPersistPayload | undefined,
    listIndexHint?: number,
  ): PendingGroupContinue | null {
    if (persist?.groupChatDecayStopped) {
      groupChatNoticeMessage.value = opts.t('chat.groupChat.decayStopped')
      groupChatNoticeOpen.value = true
    }

    const settings =
      opts.getGroupChatSettings?.() ?? defaultGroupChatSettings()
    const pending = buildPendingContinueFromPersist(persist, listIndexHint)
    if (!pending || !settings.enabled) {
      pendingGroupContinue.value = null
      return null
    }

    if (settings.confirmContinue) {
      pendingGroupContinue.value = pending
      return null
    }

    pendingGroupContinue.value = null
    if (settings.autoContinue) return pending
    return null
  }

  function refreshPendingContinueListIndex(
    pending: PendingGroupContinue,
  ): PendingGroupContinue | null {
    const listIndex = resolveTurnListIndex(pending.turnOrdinal, pending.listIndex)
    if (listIndex < 0) return null
    return listIndex === pending.listIndex
      ? pending
      : { ...pending, listIndex }
  }

  function dismissGroupContinue() {
    pendingGroupContinue.value = null
  }

  function reconcilePendingGroupContinueListIndex() {
    const pending = pendingGroupContinue.value
    if (!pending) return
    const listIndex = opts.turns.value.findIndex(
      (t) => t.turnOrdinal === pending.turnOrdinal,
    )
    if (listIndex < 0) {
      pendingGroupContinue.value = null
      return
    }
    if (listIndex !== pending.listIndex) {
      pendingGroupContinue.value = { ...pending, listIndex }
    }
  }

  async function reloadMessagesAndReconcileContinue() {
    await opts.loadMessages()
    reconcilePendingGroupContinueListIndex()
  }
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
    const segIdx =
      regeneratingSegmentIndex.value ?? getActiveSegmentIndex(cur)
    const segments = getTurnSegmentsForUi(cur)
    const targetSeg = segments[segIdx]
    if (targetSeg && cur.segments?.length) {
      const nextSegments = [...cur.segments]
      nextSegments[segIdx] = {
        ...targetSeg,
        receives: [...targetSeg.receives, receive],
        activeReceiveIndex: targetSeg.receives.length,
      }
      const activeSeg = nextSegments[segIdx]!
      opts.replaceTurnAt(listIndex, {
        ...cur,
        segments: nextSegments,
        activeSegmentIndex: segIdx,
        receives: activeSeg.receives,
        activeReceiveIndex: activeSeg.activeReceiveIndex,
      })
      return
    }
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

  async function runSlashCommands(
    commands: ReturnType<typeof submitComposerParse>['commands'],
  ): Promise<void> {
    for (const cmd of commands) {
      if (cmd.kind !== 'goto') continue
      const result = await opts.scrollToTurnOrdinal(cmd.turnOrdinal)
      if (result === 'ok') continue
      if (result === 'future') {
        opts.errorText.value = opts.t('chat.slash.gotoFuture', {
          n: cmd.turnOrdinal,
        })
      } else {
        opts.errorText.value = opts.t('chat.slash.gotoNotFound', {
          n: cmd.turnOrdinal,
        })
      }
    }
  }

  function maybeWarnUnmatchedAtSlash(
    raw: string,
    warnOpts?: { onlyWhenSpeakerQueue?: boolean; speakerQueueLength?: number },
  ) {
    if (
      warnOpts?.onlyWhenSpeakerQueue &&
      (warnOpts.speakerQueueLength ?? 0) === 0
    ) {
      return
    }
    if (!hasUnmatchedAtSlashNames(raw, opts.getBoundDisplayNames?.() ?? [])) return
    groupChatNoticeMessage.value = opts.t('chat.groupChat.atNameUnmatched')
    groupChatNoticeOpen.value = true
  }

  function maybeWarnQueueNeedsEnabled(queueLength: number) {
    if (queueLength <= 1 || (opts.isGroupChatEnabled?.() ?? false)) return
    groupChatNoticeMessage.value = opts.t('chat.groupChat.queueNeedsEnabled')
    groupChatNoticeOpen.value = true
  }

  function resolveSpeakerQueueFromParsed(
    parsed: ReturnType<typeof submitComposerParse>,
  ): { speakerQueueIds: string[]; speakerQueueDisplayNames?: string[] } {
    const characterIds = opts.getCharacterIds?.() ?? []
    const displayNames = opts.getBoundDisplayNames?.() ?? []
    const speakerQueueIds = resolveSpeakerQueueIds(
      parsed.speakerQueue,
      [...characterIds],
      [...displayNames],
    )
    return {
      speakerQueueIds,
      speakerQueueDisplayNames:
        parsed.speakerQueue.length > 0 ? parsed.speakerQueue : undefined,
    }
  }

  function prepareOutboundRequest(): string | undefined {
    try {
      opts.parseCustomParamsOrThrow()
    } catch (e) {
      opts.errorText.value = opts.customParamsErrorMessage(e)
      return opts.errorText.value
    }
    if (!opts.assertApiReady()) {
      opts.errorText.value = opts.t('chat.errors.requestFailedStatus', {
        status: 400,
      })
      return opts.errorText.value
    }
    return undefined
  }

  async function sendMessageBody(
    userText: string,
    sendOpts?: {
      speakerQueue?: string[]
      speakerQueueDisplayNames?: string[]
      plugins?: ConversationChatRequestPlugins
    },
  ): Promise<string | undefined> {
    const ord = nextTurnOrdinal0(opts.turns.value)
    const pendingSpeakerId = sendOpts?.speakerQueue?.[0]?.trim()
    opts.appendPendingUserTurn(userText, ord, {
      ...(pendingSpeakerId ? { speakerCharacterId: pendingSpeakerId } : {}),
      ...(sendOpts?.speakerQueue?.length
        ? { speakerQueue: sendOpts.speakerQueue }
        : {}),
    })
    opts.loading.value = true
    opts.startGenerationTimer()
    opts.pendingSendSegmentIndex.value = 0
    dismissGroupContinue()
    let deferredAutoContinue: PendingGroupContinue | null = null
    try {
      const { receive, traceId, persist, shouldReload } = await opts.runSend({
        userText,
        speakerQueue: sendOpts?.speakerQueue,
        speakerQueueDisplayNames: sendOpts?.speakerQueueDisplayNames,
        ...(sendOpts?.plugins ? { plugins: sendOpts.plugins } : {}),
      })
      applyPersistRetroPatches(persist)
      opts.finalizePendingTurn(
        ord,
        receive,
        resolveFinalUserTextAfterPersist(persist),
        {
          speakerCharacterId: persist?.speakerCharacterId,
          speakerQueue: sendOpts?.speakerQueue,
          segmentIndex: persist?.segmentIndex,
          activeSegmentIndex: persist?.activeSegmentIndex,
        },
      )
      if (shouldReload) await reloadMessagesAndReconcileContinue()
      deferredAutoContinue = updatePendingContinueFromPersist(
        persist,
        opts.turns.value.findIndex((t) => t.turnOrdinal === ord),
      )
      opts.emitAssistantReplyComplete({ mode: 'send', traceId })
      return undefined
    } catch (e) {
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        const receive = partialReceiveFromStream(durationMs)
        if (receive) {
          opts.finalizePendingTurn(ord, receive)
        } else {
          opts.rollbackPendingUserTurn(ord, userText)
        }
        return undefined
      }
      opts.rollbackPendingUserTurn(ord, userText)
      const msg =
        e instanceof Error ? e.message : opts.t('chat.errors.network')
      opts.errorText.value = msg
      return msg
    } finally {
      if (opts.loading.value) {
        opts.stopGenerationTimer()
        opts.loading.value = false
      }
      opts.pendingSendSegmentIndex.value = null
      if (deferredAutoContinue) {
        const next = refreshPendingContinueListIndex(deferredAutoContinue)
        if (next) void continueGroupChat(next)
      }
    }
  }

  async function send() {
    if (!opts.isConversationWritable()) return
    opts.errorText.value = ''
    const raw = opts.userInput.value
    const trimmed = raw.trim()
    if (!trimmed) return

    const parsed = submitComposerParse(raw, {
      boundDisplayNames: opts.getBoundDisplayNames?.() ?? [],
    })

    maybeWarnUnmatchedAtSlash(raw)

    opts.recordInputHistoryOnSend?.(raw)

    if (parsed.commands.length > 0) {
      await runSlashCommands(parsed.commands)
    }

    const messageBody = parsed.body.trim()
    if (!messageBody) {
      opts.userInput.value = ''
      opts.clearComposerAfterSlash?.()
      return
    }

    const prepErr = prepareOutboundRequest()
    if (prepErr) return

    const { speakerQueueIds, speakerQueueDisplayNames } =
      resolveSpeakerQueueFromParsed(parsed)

    await sendMessageBody(messageBody, {
      speakerQueue: speakerQueueIds.length > 0 ? speakerQueueIds : undefined,
      speakerQueueDisplayNames,
    })

    maybeWarnQueueNeedsEnabled(parsed.speakerQueue.length)
  }

  async function sendWithPlugins(
    userText: string,
    plugins: ConversationChatRequestPlugins,
  ): Promise<string | undefined> {
    if (!opts.isConversationWritable()) return opts.t('chat.errors.network')
    opts.errorText.value = ''
    const raw = userText.trim()
    if (!raw) return opts.t('chat.errors.network')

    const parsed = submitComposerParse(raw)
    const messageBody = parsed.body.trim()
    if (!messageBody) return opts.t('chat.errors.network')

    maybeWarnUnmatchedAtSlash(raw, {
      onlyWhenSpeakerQueue: true,
      speakerQueueLength: parsed.speakerQueue.length,
    })

    const prepErr = prepareOutboundRequest()
    if (prepErr) return prepErr

    const { speakerQueueIds, speakerQueueDisplayNames } =
      resolveSpeakerQueueFromParsed(parsed)
    opts.recordInputHistoryOnSend?.(messageBody)

    const err = await sendMessageBody(messageBody, {
      speakerQueue: speakerQueueIds.length > 0 ? speakerQueueIds : undefined,
      speakerQueueDisplayNames,
      plugins,
    })
    maybeWarnQueueNeedsEnabled(parsed.speakerQueue.length)
    return err
  }

  function applyRegenerateReceive(
    listIndex: number,
    segIdx: number,
    receive: ChatTurnItem['receives'][number],
    persist: ChatPersistPayload | undefined,
    userTextFallback?: string,
  ): boolean {
    const cur = opts.turns.value[listIndex]
    if (!cur) return false
    const finalUser =
      resolveFinalUserTextAfterPersist(persist) ?? userTextFallback
    const segments = getTurnSegmentsForUi(cur)
    const targetSeg = segments[segIdx]
    if (targetSeg) {
      const nextSegments = [...(cur.segments ?? segments)]
      nextSegments[segIdx] = {
        ...targetSeg,
        receives: [...targetSeg.receives, receive],
        activeReceiveIndex: targetSeg.receives.length,
      }
      const activeSeg =
        nextSegments[persist?.activeSegmentIndex ?? segIdx] ??
        nextSegments[segIdx]!
      const next: ChatTurnItem = {
        ...cur,
        ...(finalUser !== undefined ? { user: finalUser } : {}),
        segments: nextSegments,
        activeSegmentIndex: persist?.activeSegmentIndex ?? segIdx,
        receives: activeSeg.receives,
        activeReceiveIndex: activeSeg.activeReceiveIndex,
      }
      opts.replaceTurnAt(listIndex, next)
    } else {
      const next: ChatTurnItem = {
        ...cur,
        ...(finalUser !== undefined ? { user: finalUser } : {}),
        receives: [...cur.receives, receive],
        activeReceiveIndex: cur.receives.length,
      }
      opts.replaceTurnAt(listIndex, next)
    }
    return true
  }

  async function finishRegenerateUi(shouldReload: boolean, traceId: string) {
    opts.endRegeneratingUi()
    await nextTick()
    if (shouldReload) {
      await reloadMessagesAndReconcileContinue()
    } else {
      await opts.scrollChatToBottom()
    }
    opts.emitAssistantReplyComplete({ mode: 'regenerate', traceId })
  }

  async function regenerateAssistantCore(
    listIndex: number,
    params: {
      userText: string
      promptTrigger?: PromptTrigger
      segmentIndex?: number
      plugins?: ConversationChatRequestPlugins
      userTextFallback?: string
    },
  ): Promise<string | undefined> {
    const turn = opts.turns.value[listIndex]
    if (!turn) return opts.t('chat.errors.network')

    const segIdx = params.segmentIndex ?? getActiveSegmentIndex(turn)
    beginRegeneratingUi(turn.turnOrdinal)
    regeneratingSegmentIndex.value = segIdx
    opts.errorText.value = ''
    opts.startGenerationTimer()
    dismissGroupContinue()
    let deferredAutoContinue: PendingGroupContinue | null = null

    try {
      try {
        opts.parseCustomParamsOrThrow()
      } catch (e) {
        opts.errorText.value = opts.customParamsErrorMessage(e)
        return opts.errorText.value
      }

      const { receive, traceId, persist, shouldReload } = await opts.runRegenerate({
        userText: params.userText,
        turnOrdinal: turn.turnOrdinal,
        segmentIndex: segIdx,
        promptTrigger: params.promptTrigger ?? 'regenerate',
        ...(params.plugins ? { plugins: params.plugins } : {}),
      })
      applyPersistRetroPatches(persist)

      if (
        !applyRegenerateReceive(
          listIndex,
          segIdx,
          receive,
          persist,
          params.userTextFallback,
        )
      ) {
        return opts.t('chat.errors.network')
      }

      await finishRegenerateUi(shouldReload, traceId)
      deferredAutoContinue = updatePendingContinueFromPersist(
        persist,
        opts.turns.value.findIndex((t) => t.turnOrdinal === turn.turnOrdinal),
      )
      return undefined
    } catch (e) {
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        finalizeAbortedRegenerate(listIndex, durationMs)
        await nextTick()
        await opts.scrollChatToBottom()
        return undefined
      }
      const msg =
        e instanceof Error ? e.message : opts.t('chat.errors.network')
      opts.errorText.value = msg
      return msg
    } finally {
      if (opts.regeneratingTurnOrdinal.value !== null) {
        opts.stopGenerationTimer()
        opts.endRegeneratingUi()
        regeneratingSegmentIndex.value = null
      }
      if (deferredAutoContinue) {
        const next = refreshPendingContinueListIndex(deferredAutoContinue)
        if (next) void continueGroupChat(next)
      }
    }
  }

  async function regenerateAssistant(
    listIndex: number,
    trigger: PromptTrigger = 'regenerate',
    segmentIndex?: number,
  ) {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn || !turn.user.trim()) return
    if (opts.regeneratingTurnOrdinal.value !== null) return
    await regenerateAssistantCore(listIndex, {
      userText: turn.user,
      promptTrigger: trigger,
      segmentIndex,
    })
  }

  async function regenerateWithPlugins(
    listIndex: number,
    userText: string,
    plugins: ConversationChatRequestPlugins,
  ): Promise<string | undefined> {
    if (!opts.isConversationWritable()) return opts.t('chat.errors.network')
    const turn = opts.turns.value[listIndex]
    if (!turn) return opts.t('chat.errors.network')
    const trimmed = userText.trim()
    if (!trimmed) return opts.t('chat.errors.network')
    if (opts.regeneratingTurnOrdinal.value !== null || opts.loading.value) {
      return opts.t('chat.errors.network')
    }

    opts.errorText.value = ''
    const prepErr = prepareOutboundRequest()
    if (prepErr) return prepErr

    return regenerateAssistantCore(listIndex, {
      userText: trimmed,
      plugins,
      userTextFallback: trimmed,
    })
  }

  async function continueGroupChat(explicit?: PendingGroupContinue) {
    const rawPending = explicit ?? pendingGroupContinue.value
    if (!rawPending || !opts.isConversationWritable()) return
    const pending = refreshPendingContinueListIndex(rawPending)
    if (!pending) return
    if (opts.loading.value || opts.regeneratingTurnOrdinal.value !== null) return
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

    const { turnOrdinal, afterSegmentIndex, nextSpeakerCharacterId } = pending
    const segmentIndex = afterSegmentIndex + 1
    dismissGroupContinue()
    opts.appendPendingSegment(turnOrdinal, segmentIndex, nextSpeakerCharacterId)
    opts.loading.value = true
    opts.startGenerationTimer()
    let deferredAutoContinue: PendingGroupContinue | null = null
    try {
      const { receive, traceId, persist, shouldReload } =
        await opts.runGroupContinue({
          turnOrdinal,
          afterSegmentIndex,
          speakerCharacterId: nextSpeakerCharacterId,
        })
      applyPersistRetroPatches(persist)
      opts.finalizePendingSegment(turnOrdinal, receive, {
        segmentIndex,
        speakerCharacterId: nextSpeakerCharacterId,
        activeSegmentIndex: segmentIndex,
      })
      deferredAutoContinue = updatePendingContinueFromPersist(
        persist,
        opts.turns.value.findIndex((t) => t.turnOrdinal === turnOrdinal),
      )
      if (shouldReload) await reloadMessagesAndReconcileContinue()
      opts.emitAssistantReplyComplete({ mode: 'send', traceId })
    } catch (e) {
      if (isAbortError(e)) {
        const durationMs = opts.stopGenerationTimer()
        const receive = partialReceiveFromStream(durationMs)
        if (receive) {
          opts.finalizePendingSegment(turnOrdinal, receive, {
            segmentIndex,
            speakerCharacterId: nextSpeakerCharacterId,
            activeSegmentIndex: segmentIndex,
          })
        } else {
          opts.rollbackPendingSegment(turnOrdinal, segmentIndex)
        }
      } else {
        opts.rollbackPendingSegment(turnOrdinal, segmentIndex)
        opts.errorText.value =
          e instanceof Error ? e.message : opts.t('chat.errors.network')
      }
    } finally {
      if (opts.loading.value) {
        opts.stopGenerationTimer()
        opts.loading.value = false
        opts.pendingSendTurnOrdinal.value = null
        opts.pendingSendSegmentIndex.value = null
      }
      if (deferredAutoContinue) {
        const next = refreshPendingContinueListIndex(deferredAutoContinue)
        if (next) void continueGroupChat(next)
      }
    }
  }

  function abortCurrentReply() {
    opts.abortChatGeneration()
  }

  function slideAssistant(
    listIndex: number,
    direction: 'left' | 'right',
    segmentIndex?: number,
  ) {
    if (!opts.isConversationWritable()) return
    const turn = opts.turns.value[listIndex]
    if (!turn) return
    const segIdx = segmentIndex ?? getActiveSegmentIndex(turn)
    const segments = getTurnSegmentsForUi(turn)
    const seg = segments[segIdx]
    if (!seg || seg.receives.length === 0) return
    const len = seg.receives.length
    const a = seg.activeReceiveIndex

    const applyVariantSwitch = (nextSegActive: number) => {
      const nextSegments = [...(turn.segments ?? segments)]
      nextSegments[segIdx] = {
        ...seg,
        activeReceiveIndex: nextSegActive,
      }
      const activeSeg = nextSegments[segIdx]!
      const next: ChatTurnItem = {
        ...turn,
        segments: nextSegments,
        activeSegmentIndex: segIdx,
        receives: activeSeg.receives,
        activeReceiveIndex: activeSeg.activeReceiveIndex,
      }
      void opts.persistTurnToServer(next, { segmentIndex: segIdx }).then((result) => {
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
      applyVariantSwitch(nextIdx)
      return
    }

    if (a === len - 1) {
      if (isOpeningTurn(turn)) {
        applyVariantSwitch(0)
        return
      }
      void regenerateAssistant(listIndex, 'swipe', segIdx)
      return
    }
    applyVariantSwitch(a + 1)
  }

  return {
    send,
    sendWithPlugins,
    regenerateAssistant,
    regenerateWithPlugins,
    slideAssistant,
    abortCurrentReply,
    continueGroupChat,
    dismissGroupContinue,
    pendingGroupContinue,
    regeneratingSegmentIndex,
    groupChatNoticeOpen,
    groupChatNoticeMessage,
  }
}
