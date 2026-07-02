import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import type { ChatPersistPayload, ChatSessionProps, ChatTurnItem } from '@/types/chat-turn'
import {
  defaultGroupChatSettings,
  normalizeGroupChatSettings,
} from '@/utils/group-chat-settings'
import { applyPersistWarning } from '@/utils/chat-messages'
import {
  assistantReasoning,
  assistantText,
  assistantModelName,
  isOpeningTurn,
  reasoningCharsCount,
  turnLabelN,
} from '@/utils/chat-turn-display'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createChatCompletionRunner } from './chat-session/completion.js'
import { createReplyEventHub } from './chat-session/reply-events.js'
import { isLastUserTurn } from './chat-session/turn-helpers.js'
import { useAssemblePreview } from './chat-session/use-assemble-preview.js'
import { useChatDisplay } from './chat-session/use-chat-display.js'
import { useChatOutbound } from './chat-session/use-chat-outbound.js'
import { useChatScroll } from './chat-session/use-chat-scroll.js'
import { useComposerDraft } from './chat-session/use-composer-draft.js'
import { useComposerInputHistory } from './chat-session/use-composer-input-history.js'
import { useComposerKeydown } from './chat-session/use-composer-keydown.js'
import { useConversationWriteLock } from './chat-session/use-conversation-write-lock.js'
import { useCopyFeedback } from './chat-session/use-copy-feedback.js'
import { useGenerationTimer } from './chat-session/use-generation-timer.js'
import { useTurnBubbleUi } from './chat-session/use-turn-bubble-ui.js'
import { useTurnEditDelete } from './chat-session/use-turn-edit-delete.js'
import { useTurnList } from './chat-session/use-turn-list.js'
import { useTurnPrompt } from './chat-session/use-turn-prompt.js'
import { createRegexDisplayText } from './chat-session/use-regex-display-text.js'
import { useBoundCharacterDisplayNames } from './chat-session/use-bound-character-display-names.js'
import { canSubmitComposerInput, parseComposerSubmit } from '@/utils/composer-slash'

export type {
  ChatSessionProps,
  ComposerRef,
  AssistantReplyCompleteEvent,
  AssistantReplyPersistedEvent,
} from './chat-session/types.js'
export { ConversationHostError } from './chat-session/types.js'

export function useChatSession(props: ChatSessionProps) {
  const { t } = useI18n()
  const auth = useAuthStore()
  const conn = useConnectionStore()
  const prefs = usePreferencesStore()
  const { writeChatPromptSnapshot } = storeToRefs(prefs)

  const boundCharacterNames = useBoundCharacterDisplayNames({
    getCharacterIds: () => props.conversationCharacterIds,
    getPropDisplayNames: () => props.conversationCharacterDisplayNames,
  })
  const effectiveCharacterDisplayNames = computed(() =>
    boundCharacterNames.getBoundDisplayNames(),
  )

  const replyEvents = createReplyEventHub()
  const {
    onAssistantReplyComplete,
    onAssistantReplyPersisted,
    onTurnDataChanged,
    onGeneratingChanged,
    emitAssistantReplyComplete,
    emitAssistantReplyPersisted,
    emitTurnDataChanged,
    emitGeneratingChanged,
  } = replyEvents

  const userInput = ref('')
  const turns = ref<ChatTurnItem[]>([])
  const streamingText = ref('')
  const streamingReasoning = ref('')
  const pendingSendTurnOrdinal = ref<number | null>(null)
  const pendingSendSegmentIndex = ref<number | null>(null)
  const pendingSendEstimatedTokens = ref<number | null>(null)
  const pendingReceiveCompletionTokens = ref<number | null>(null)
  const loading = ref(false)
  const errorText = ref('')
  const regeneratingTurnOrdinal = ref<number | null>(null)
  /** 插件占用（如摘要预览），禁止发送 */
  const pluginHoldConversation = ref(false)

  const timer = useGenerationTimer()
  const { startGenerationTimer, stopGenerationTimer, generationElapsedMs, dispose: disposeTimer } =
    timer

  const scroll = useChatScroll()
  const {
    chatScrollEl,
    chatScroller,
    registerChatScroller,
    scrollChatToBottom,
    isNearBottom,
    onGlobalKeyR,
  } = scroll

  const composerDraft = useComposerDraft({
    getConversationId: () => props.conversationId,
    userInput,
    getUserId: () => auth.user?.id ?? auth.defaultUserId ?? 'anonymous',
  })

  const composerInputHistory = useComposerInputHistory({
    getConversationId: () => props.conversationId,
    getUserId: () => auth.user?.id ?? auth.defaultUserId ?? 'anonymous',
    userInput,
  })
  const {
    inputHistory,
    inputHistoryLimits,
    recordOnSend: recordInputHistoryOnSend,
    pinItem: pinInputHistoryItem,
    unpinItem: unpinInputHistoryItem,
    fillFromHistory: fillComposerFromInputHistory,
    applyInputHistoryLimits,
    switchConversationInputHistory,
  } = composerInputHistory

  const writeLock = useConversationWriteLock({
    getConversationId: () => props.conversationId,
    loading,
    regeneratingTurnOrdinal,
  })
  const {
    conversationWriteLocked,
    isConversationWritable,
    runConversationScope,
    runConversationBatch,
  } = writeLock

  const turnList = useTurnList({
    getConversationId: () => props.conversationId,
    turns,
    userInput,
    pendingSendTurnOrdinal,
    pendingSendSegmentIndex,
    pendingSendEstimatedTokens,
    pendingReceiveCompletionTokens,
    streamingText,
    streamingReasoning,
    clearDraftAfterSend: composerDraft.clearDraftAfterSend,
    scrollChatToBottom,
    chatScrollEl,
    chatScroller,
    onLoadMessagesFailed: () => {
      errorText.value = t('chat.errors.loadMessagesFailed')
    },
    onLoadOlderFailed: () => {
      errorText.value = t('chat.errors.loadOlderFailed')
    },
  })
  const {
    replaceTurnAt,
    clearPendingSend,
    appendPendingUserTurn,
    rollbackPendingUserTurn,
    appendPendingSegment,
    rollbackPendingSegment,
    finalizePendingTurn,
    finalizePendingSegment,
    persistTurnToServer,
    loadMessages,
    loadOlderMessages,
    refreshConversation,
    scrollToTurnOrdinal,
    hasMoreBefore,
    loadingOlder,
    messagesLoading,
  } = turnList

  const completion = createChatCompletionRunner({
    conn,
    getConversationId: () => props.conversationId,
    t,
    turns,
    streamingText,
    streamingReasoning,
    pendingSendEstimatedTokens,
    pendingReceiveCompletionTokens,
    emitAssistantReplyPersisted,
    resolveDurationMs: stopGenerationTimer,
  })
  const {
    parseCustomParamsOrThrow,
    customParamsErrorMessage,
    assertApiReady,
    runSend,
    runRegenerate,
    runGroupContinue,
    abortChatGeneration,
  } = completion

  function setPersistWarning(persist: ChatPersistPayload | undefined) {
    applyPersistWarning(
      persist,
      (msg) => {
        errorText.value = msg
      },
      t('chat.errors.persistAppendTurnFailed'),
    )
  }

  function endRegeneratingUi() {
    streamingText.value = ''
    streamingReasoning.value = ''
    regeneratingTurnOrdinal.value = null
    pendingSendEstimatedTokens.value = null
    pendingReceiveCompletionTokens.value = null
  }

  const turnEditDelete = useTurnEditDelete({
    turns,
    isConversationWritable,
    replaceTurnAt,
    persistTurnToServer,
    getConversationId: () => props.conversationId,
    loadMessages,
    setErrorText: (msg) => {
      errorText.value = msg
    },
    t,
  })

  const outbound = useChatOutbound({
    turns,
    userInput,
    loading,
    errorText,
    regeneratingTurnOrdinal,
    pendingSendTurnOrdinal,
    pendingSendSegmentIndex,
    pendingSendEstimatedTokens,
    pendingReceiveCompletionTokens,
    streamingText,
    streamingReasoning,
    isConversationWritable,
    parseCustomParamsOrThrow,
    customParamsErrorMessage,
    assertApiReady,
    runSend,
    runRegenerate,
    runGroupContinue,
    abortChatGeneration,
    getModel: () => conn.model,
    startGenerationTimer,
    stopGenerationTimer,
    setPersistWarning,
    appendPendingUserTurn,
    rollbackPendingUserTurn,
    finalizePendingTurn,
    finalizePendingSegment,
    appendPendingSegment,
    rollbackPendingSegment,
    replaceTurnAt,
    persistTurnToServer,
    loadMessages,
    scrollChatToBottom,
    endRegeneratingUi,
    emitAssistantReplyComplete,
    recordInputHistoryOnSend,
    getBoundDisplayNames: () => boundCharacterNames.getBoundDisplayNames(),
    getCharacterIds: () => props.conversationCharacterIds ?? [],
    isGroupChatEnabled: () => props.groupChatEnabled ?? false,
    getGroupChatSettings: () =>
      normalizeGroupChatSettings(
        props.groupChatSettings ?? defaultGroupChatSettings(),
      ),
    clearComposerAfterSlash: () => {
      composerDraft.clearDraftAfterSend(props.conversationId)
    },
    scrollToTurnOrdinal,
    t,
  })
  const {
    send,
    sendWithPlugins,
    regenerateAssistant,
    regenerateWithPlugins,
    slideAssistant,
    abortCurrentReply,
    continueGroupChat,
    dismissGroupContinue,
    pendingGroupContinue,
    groupChatNoticeOpen,
    groupChatNoticeMessage,
    regeneratingSegmentIndex,
  } = outbound

  const bubbleUi = useTurnBubbleUi({
    turns,
    pendingSendTurnOrdinal,
    pendingSendSegmentIndex,
    pendingSendEstimatedTokens,
    pendingReceiveCompletionTokens,
    regeneratingTurnOrdinal,
    regeneratingSegmentIndex,
    streamingText,
    streamEnabled: () => conn.stream,
    generationElapsedMs,
    editingTurnOrdinal: turnEditDelete.editingTurnOrdinal,
    editingSegmentIndex: turnEditDelete.editingSegmentIndex,
    editingSide: turnEditDelete.editingSide,
  })

  const isGenerating = computed(
    () => loading.value || regeneratingTurnOrdinal.value !== null,
  )

  const canSend = computed(() => {
    if (
      conversationWriteLocked.value ||
      pluginHoldConversation.value ||
      loading.value ||
      regeneratingTurnOrdinal.value !== null
    ) {
      return false
    }
    const raw = userInput.value.trim()
    if (!canSubmitComposerInput(raw)) return false
    const { body } = parseComposerSubmit(raw, {
      boundDisplayNames: boundCharacterNames.getBoundDisplayNames(),
    })
    if (!body.trim()) return true
    return conn.isApiKeyConfigured && conn.model.trim().length > 0
  })

  const { onComposerKeydown } = useComposerKeydown({
    userInput,
    canSend,
    composerEnterMode: () => prefs.composerEnterMode,
    send,
  })

  const assemblePreview = useAssemblePreview({
    getConversationId: () => props.conversationId,
    userInput,
    getContextLength: () => conn.contextLength,
    getModel: () => conn.model,
    t,
  })

  const turnPrompt = useTurnPrompt({
    getConversationId: () => props.conversationId,
    t,
  })

  const display = useChatDisplay({
    conversationUserName: props.conversationUserName,
    getUserCharacterId: () => props.conversationUserCharacterId,
    getCharacterIds: () => props.conversationCharacterIds,
    getBoundDisplayNames: () => boundCharacterNames.getBoundDisplayNames(),
    getAuthUserId: () => auth.user?.id ?? auth.defaultUserId,
    getConnAlias: () => conn.alias,
    getConnModel: () => conn.model,
    t,
  })

  const regexDisplay = createRegexDisplayText({
    turns,
    getUserId: () => auth.user?.id ?? auth.defaultUserId,
  })

  const { copiedTurnKey, copyTurnText } = useCopyFeedback()

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeyR)
    window.addEventListener('pagehide', composerDraft.flushComposerDraftOnPageHide)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onGlobalKeyR)
    window.removeEventListener('pagehide', composerDraft.flushComposerDraftOnPageHide)
    composerDraft.dispose()
    disposeTimer()
  })

  watch(
    () => {
      const turnsList = turns.value
      return turnsList.length > 0
        ? turnsList[turnsList.length - 1]!.turnOrdinal
        : -1
    },
    (lastOrd, prevLastOrd) => {
      if (loadingOlder.value) return
      if (prevLastOrd < 0) return
      if (lastOrd > prevLastOrd) {
        void scrollChatToBottom()
      }
    },
    { flush: 'post' },
  )

  watch(streamingText, () => {
    void scrollChatToBottom({ onlyIfNearBottom: true })
  }, { flush: 'post' })

  watch(regeneratingTurnOrdinal, (cur, prev) => {
    if (prev !== null && cur === null) {
      void nextTick().then(() => scrollChatToBottom())
    }
  })

  watch([loading, regeneratingTurnOrdinal], () => {
    emitGeneratingChanged()
  })

  watch(
    () => auth.user?.id ?? auth.defaultUserId,
    (uid) => {
      if (uid) void regexDisplay.ensureRulesLoaded()
    },
    { immediate: true },
  )

  watch(
    () => props.conversationId,
    (newId, oldId) => {
      composerDraft.switchConversationDraft(oldId, newId ?? '')
      switchConversationInputHistory(oldId, newId ?? '')
      turns.value = []
      clearPendingSend()
      pendingSendSegmentIndex.value = null
      errorText.value = ''
      turnEditDelete.resetState()
      dismissGroupContinue()
      groupChatNoticeOpen.value = false
      groupChatNoticeMessage.value = ''
      void regexDisplay.ensureRulesLoaded()
      void loadMessages()
    },
    { immediate: true },
  )

  watch(userInput, (text) => {
    composerDraft.scheduleComposerDraftSave(props.conversationId, text)
  })

  watch(
    () =>
      turns.value.map(
        (t) =>
          `${t.turnOrdinal}:${t.activeReceiveIndex}:${t.receives.map((r) => r.id).join(',')}:${JSON.stringify(t.plugins ?? [])}`,
      ),
    () => {
      emitTurnDataChanged()
    },
  )

  return reactive({
    chatScrollEl,
    registerChatScroller,
    scrollChatToBottom,
    isNearBottom,
    turns,
    userInput,
    streamingText,
    streamingReasoning,
    pendingSendTurnOrdinal,
    loading,
    errorText,
    regeneratingTurnOrdinal,
    editingTurnOrdinal: turnEditDelete.editingTurnOrdinal,
    editingSide: turnEditDelete.editingSide,
    editDraft: turnEditDelete.editDraft,
    deleteDialogOpen: turnEditDelete.deleteDialogOpen,
    deleteDialogMessage: turnEditDelete.deleteDialogMessage,
    ...turnPrompt,
    ...display,
    ...regexDisplay,
    copiedTurnKey,
    ...assemblePreview,
    canSend,
    isGenerating,
    abortCurrentReply,
    inputHistory,
    inputHistoryLimits,
    pinInputHistoryItem,
    unpinInputHistoryItem,
    fillComposerFromInputHistory,
    applyInputHistoryLimits,
    loadMessages,
    loadOlderMessages,
    conversationId: props.conversationId,
    conversationCharacterIds: props.conversationCharacterIds,
    conversationCharacterDisplayNames: effectiveCharacterDisplayNames,
    conversationWriteLocked,
    pluginHoldConversation,
    hasMoreBefore,
    loadingOlder,
    messagesLoading,
    setPluginHold(hold: boolean) {
      pluginHoldConversation.value = hold
    },
    runConversationScope,
    runConversationBatch,
    refreshConversation,
    writeChatPromptSnapshot,
    turnLabelN,
    ...bubbleUi,
    isOpeningTurn,
    assistantText,
    assistantReasoning,
    reasoningCharsCount,
    assistantModelName,
    send,
    onComposerKeydown,
    slideAssistant,
    regenerateAssistant,
    continueGroupChat,
    dismissGroupContinue,
    pendingGroupContinue,
    groupChatNoticeOpen,
    groupChatNoticeMessage,
    isEditingAssistantSegment: turnEditDelete.isEditingAssistantSegment,
    openEditAssistant: turnEditDelete.openEditAssistant,
    openEditUser: turnEditDelete.openEditUser,
    cancelEdit: turnEditDelete.cancelEdit,
    saveEdit: turnEditDelete.saveEdit,
    requestDelete: turnEditDelete.requestDelete,
    requestDeleteWholeTurnFromUser: turnEditDelete.requestDeleteWholeTurnFromUser,
    cancelDelete: turnEditDelete.cancelDelete,
    confirmDelete: turnEditDelete.confirmDelete,
    copyTurnText,
    sendWithPlugins,
    regenerateWithPlugins,
    isLastUserTurn: (turn: ChatTurnItem) => isLastUserTurn(turns.value, turn),
    onAssistantReplyComplete,
    onAssistantReplyPersisted,
    onTurnDataChanged,
    onGeneratingChanged,
  })
}
