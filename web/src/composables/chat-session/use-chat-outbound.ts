import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload, ChatTurnItem, PersistTurnToServerResult, ReceiveItem } from '@/types/chat-turn'
import { resolveFinalUserTextAfterPersist, applyRetroPersistToTurns, applyPersistTurnPlugins } from '@/utils/persist-display'
import { isAbortError } from '@/utils/abort-error'
import type { ConversationChatRequestPlugins } from '@/utils/chat-api'
import { allocateShortId } from '@/utils/short-id'
import { isOpeningTurn } from '@/utils/chat-turn-display'
import { submitComposerParse, hasUnmatchedAtSlashNames } from '@/utils/composer-slash'
import { getComposerSlashPluginHandler } from '@/utils/composer-slash-registry'
import {
  defaultGroupChatSettings,
  type GroupChatSettings,
  type GroupChatTurnState,
} from '@/utils/group-chat-settings'
import {
  resolveSpeakerQueueIds,
  listEligibleSpeakersForContinue,
  mergeTurnGroupChatStateFromPersist,
  type PendingGroupContinue,
  getActiveSegmentIndex,
  getTurnSegments,
} from '@/utils/group-chat-turn'
import { patchRegenSegments } from '@/utils/regen-turn-segments'
import { coreNotify } from '@/utils/core-notify'
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
    receive: ReceiveItem,
    finalUserText?: string,
    meta?: {
      speakerCharacterId?: string
      speakerQueue?: string[]
      segmentIndex?: number
      activeSegmentIndex?: number
      groupChatTurnState?: GroupChatTurnState
      turnOrdinal?: number
      turnId?: string
    },
  ) => void
  finalizePendingSegment: (
    ord: number,
    receive: ReceiveItem,
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
  getConversationId?: () => string
  t: ComposerTranslation
}) {
  const pendingGroupContinue = ref<PendingGroupContinue | null>(null)
  const regeneratingSegmentIndex = ref<number | null>(null)

  function groupChatNotify(key: string, title: string): void {
    const convId = opts.getConversationId?.()?.trim()
    coreNotify(title, undefined, {
      level: 'warning',
      timeout: 6000,
      dedupeKey: convId ? `group-chat:${convId}:${key}` : undefined,
    })
  }

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
    if (typeof turnOrd !== 'number') return null
    if (!nextId && !persist?.groupChatNeedsManualContinue) return null
    const listIndex = resolveTurnListIndex(turnOrd, listIndexHint)
    if (listIndex < 0) return null
    const turn = mergeTurnGroupChatStateFromPersist(
      opts.turns.value[listIndex]!,
      persist,
    )
    if (!turn || turn.turnOrdinal !== turnOrd) return null
    const segments = getTurnSegments(turn)
    const afterSegmentIndex =
      typeof persist?.activeSegmentIndex === 'number'
        ? persist.activeSegmentIndex
        : Math.max(0, segments.length - 1)
    const charIds = opts.getCharacterIds?.() ?? []
    const lastSeg = segments.filter((s) => (s.receives?.length ?? 0) > 0)
    const lastSpeaker =
      lastSeg[lastSeg.length - 1]?.speakerCharacterId ?? null
    const settings =
      opts.getGroupChatSettings?.() ?? defaultGroupChatSettings()
    const eligibleFromServer = persist?.eligibleSpeakerCharacterIds?.filter(
      (id) => typeof id === 'string' && id.trim(),
    )
    const eligible =
      eligibleFromServer && eligibleFromServer.length > 0
        ? eligibleFromServer
        : listEligibleSpeakersForContinue(turn, [...charIds], settings)
    const manualPick = Boolean(persist?.groupChatNeedsManualContinue && !nextId)
    const allowSpeakerChange = Boolean(
      manualPick || (settings.confirmContinue && eligible.length > 0),
    )
    const fallbackNext =
      eligible[0]?.trim() ??
      charIds.find((id) => id.trim() && id !== lastSpeaker)?.trim() ??
      ''
    return {
      turnOrdinal: turnOrd,
      listIndex,
      afterSegmentIndex,
      nextSpeakerCharacterId: nextId ?? fallbackNext,
      manualPick,
      allowSpeakerChange,
      ...(allowSpeakerChange ? { eligibleSpeakerCharacterIds: eligible } : {}),
    }
  }

  /** 更新 pending UI；若应 autoContinue 则返回待链式 continue 的 payload */
  function updatePendingContinueFromPersist(
    persist: ChatPersistPayload | undefined,
    listIndexHint?: number,
  ): PendingGroupContinue | null {
    if (persist?.groupChatDecayStopped) {
      groupChatNotify('decay-stopped', opts.t('chat.groupChat.decayStopped'))
    }
    if (persist?.groupChatNeedsManualContinue) {
      groupChatNotify(
        'needs-manual-continue',
        opts.t('chat.groupChat.needsManualContinue'),
      )
    }

    const settings =
      opts.getGroupChatSettings?.() ?? defaultGroupChatSettings()
    const pending = buildPendingContinueFromPersist(persist, listIndexHint)
    if (!pending || !settings.enabled) {
      pendingGroupContinue.value = null
      return null
    }

    if (settings.confirmContinue || persist?.groupChatNeedsManualContinue) {
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

  function patchTurnGroupChatStateFromPersist(
    turnOrd: number,
    persist?: ChatPersistPayload,
  ) {
    if (!persist?.groupChatTurnState) return
    const idx = opts.turns.value.findIndex((t) => t.turnOrdinal === turnOrd)
    if (idx < 0) return
    opts.replaceTurnAt(
      idx,
      mergeTurnGroupChatStateFromPersist(opts.turns.value[idx]!, persist),
    )
  }

  function setPendingGroupContinueSpeaker(characterId: string) {
    const pending = pendingGroupContinue.value
    if (!pending) return
    const id = characterId.trim()
    if (!id) return
    pendingGroupContinue.value = { ...pending, nextSpeakerCharacterId: id }
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
  function applyPersistRetroPatches(
    persist?: ChatPersistPayload,
    clientPendingOrdinal?: number,
  ) {
    opts.setPersistWarning(persist)
    let next = opts.turns.value
    if (persist?.retro?.length) {
      next = applyRetroPersistToTurns(next, persist)
    }
    next = applyPersistTurnPlugins(next, persist, clientPendingOrdinal)
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
    const segments = [...getTurnSegments(cur)]
    const targetSeg = segments[segIdx]
    if (!targetSeg) return
    segments[segIdx] = {
      ...targetSeg,
      receives: [...targetSeg.receives, receive],
      activeReceiveIndex: targetSeg.receives.length,
    }
    opts.replaceTurnAt(listIndex, {
      ...cur,
      segments,
      activeSegmentIndex: segIdx,
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
    raw: string,
  ): Promise<void> {
    for (const cmd of commands) {
      if (cmd.kind === 'goto') {
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
        continue
      }
      if (cmd.kind === 'plugin') {
        const handler = getComposerSlashPluginHandler(cmd.name)
        if (!handler) continue
        try {
          await handler({
            conversationId: opts.getConversationId?.() ?? '',
            raw,
            args: cmd.args,
          })
        } catch (e) {
          // 插件 handler 失败不阻断后续命令；避免未捕获 rejection 卡死发送路径
          console.warn('[composer-slash] plugin handler failed:', cmd.name, e)
          coreNotify(opts.t('chat.slash.pluginHandlerFailed', { name: cmd.name }), undefined, {
            level: 'warning',
            timeout: 6000,
          })
        }
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
    groupChatNotify('at-unmatched', opts.t('chat.groupChat.atNameUnmatched'))
  }

  function maybeWarnQueueNeedsEnabled(queueLength: number) {
    if (queueLength <= 1 || (opts.isGroupChatEnabled?.() ?? false)) return
    groupChatNotify('queue-needs-enabled', opts.t('chat.groupChat.queueNeedsEnabled'))
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
      applyPersistRetroPatches(persist, ord)
      opts.finalizePendingTurn(
        ord,
        receive,
        resolveFinalUserTextAfterPersist(persist),
        {
          speakerCharacterId: persist?.speakerCharacterId,
          speakerQueue: sendOpts?.speakerQueue,
          segmentIndex: persist?.segmentIndex,
          activeSegmentIndex: persist?.activeSegmentIndex,
          groupChatTurnState: persist?.groupChatTurnState,
          turnOrdinal: persist?.turnOrdinal,
          turnId: persist?.turnId,
        },
      )
      if (shouldReload) await reloadMessagesAndReconcileContinue()
      const resolvedOrd =
        typeof persist?.turnOrdinal === 'number' ? persist.turnOrdinal : ord
      deferredAutoContinue = updatePendingContinueFromPersist(
        persist,
        opts.turns.value.findIndex((t) => t.turnOrdinal === resolvedOrd),
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

    const messageBody = parsed.body.trim()
    const hasPluginSlash = parsed.commands.some((c) => c.kind === 'plugin')
    if (hasPluginSlash && messageBody) {
      coreNotify(opts.t('chat.slash.pluginWithBody'), undefined, {
        level: 'warning',
        timeout: 6000,
      })
      return
    }

    maybeWarnUnmatchedAtSlash(raw)

    opts.recordInputHistoryOnSend?.(raw)

    if (parsed.commands.length > 0) {
      await runSlashCommands(parsed.commands, raw)
    }

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

  /** 普通发送：与 sendWithPlugins 同管线，但不传 body.plugins */
  async function sendUserText(userText: string): Promise<string | undefined> {
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
    })
    maybeWarnQueueNeedsEnabled(parsed.speakerQueue.length)
    return err
  }

  function applyRegenerateReceive(
    listIndex: number,
    segIdx: number,
    receive: ReceiveItem,
    persist: ChatPersistPayload | undefined,
    userTextFallback?: string,
  ): boolean {
    const cur = opts.turns.value[listIndex]
    if (!cur) return false
    const finalUser =
      resolveFinalUserTextAfterPersist(persist) ?? userTextFallback
    const source = [...getTurnSegments(cur)]
    if (!source[segIdx]) return false
    const segments = patchRegenSegments(source, segIdx, receive)
    const next: ChatTurnItem = mergeTurnGroupChatStateFromPersist(
      {
        ...cur,
        ...(finalUser !== undefined ? { user: finalUser } : {}),
        segments,
        activeSegmentIndex: persist?.activeSegmentIndex ?? segIdx,
      },
      persist,
    )
    opts.replaceTurnAt(listIndex, next)
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
      patchTurnGroupChatStateFromPersist(turnOrdinal, persist)
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
    const segments = getTurnSegments(turn)
    const seg = segments[segIdx]
    if (!seg || seg.receives.length === 0) return
    const len = seg.receives.length
    const a = seg.activeReceiveIndex

    const applyVariantSwitch = (nextSegActive: number) => {
      const nextSegments = [...(turn.segments ?? getTurnSegments(turn))]
      const baseSeg = nextSegments[segIdx]
      if (!baseSeg) return
      nextSegments[segIdx] = {
        ...baseSeg,
        activeReceiveIndex: nextSegActive,
      }
      const next: ChatTurnItem = {
        ...turn,
        segments: nextSegments,
        activeSegmentIndex: segIdx,
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
    sendUserText,
    sendWithPlugins,
    regenerateAssistant,
    regenerateWithPlugins,
    slideAssistant,
    abortCurrentReply,
    continueGroupChat,
    dismissGroupContinue,
    setPendingGroupContinueSpeaker,
    pendingGroupContinue,
    regeneratingSegmentIndex,
  }
}
