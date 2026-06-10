import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import type { ChatPersistPayload, ChatSessionProps, ChatTurnItem } from '@/types/chat-turn'
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
import { useComposerKeydown } from './chat-session/use-composer-keydown.js'
import { useConversationWriteLock } from './chat-session/use-conversation-write-lock.js'
import { useCopyFeedback } from './chat-session/use-copy-feedback.js'
import { useGenerationTimer } from './chat-session/use-generation-timer.js'
import { useTurnBubbleUi } from './chat-session/use-turn-bubble-ui.js'
import { useTurnEditDelete } from './chat-session/use-turn-edit-delete.js'
import { useTurnList } from './chat-session/use-turn-list.js'
import { useTurnPrompt } from './chat-session/use-turn-prompt.js'
import { createRegexDisplayText } from './chat-session/use-regex-display-text.js'

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

  const replyEvents = createReplyEventHub()
  const {
    onAssistantReplyComplete,
    onAssistantReplyPersisted,
    emitAssistantReplyComplete,
    emitAssistantReplyPersisted,
  } = replyEvents

  const userInput = ref('')
  const turns = ref<ChatTurnItem[]>([])
  const streamingText = ref('')
  const streamingReasoning = ref('')
  const pendingSendTurnOrdinal = ref<number | null>(null)
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
  const { chatScrollEl, scrollChatToBottom, onGlobalKeyR } = scroll

  const composerDraft = useComposerDraft({
    getConversationId: () => props.conversationId,
    userInput,
    getUserId: () => auth.user?.id ?? auth.defaultUserId ?? 'anonymous',
  })

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
    pendingSendEstimatedTokens,
    pendingReceiveCompletionTokens,
    streamingText,
    streamingReasoning,
    clearDraftAfterSend: composerDraft.clearDraftAfterSend,
    scrollChatToBottom,
  })
  const {
    replaceTurnAt,
    clearPendingSend,
    appendPendingUserTurn,
    rollbackPendingUserTurn,
    finalizePendingTurn,
    persistTurnToServer,
    loadMessages,
    refreshConversation,
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

  const bubbleUi = useTurnBubbleUi({
    turns,
    pendingSendTurnOrdinal,
    pendingSendEstimatedTokens,
    pendingReceiveCompletionTokens,
    regeneratingTurnOrdinal,
    streamingText,
    streamEnabled: () => conn.stream,
    generationElapsedMs,
    editingTurnOrdinal: turnEditDelete.editingTurnOrdinal,
    editingSide: turnEditDelete.editingSide,
  })

  const outbound = useChatOutbound({
    turns,
    userInput,
    loading,
    errorText,
    regeneratingTurnOrdinal,
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
    abortChatGeneration,
    getModel: () => conn.model,
    startGenerationTimer,
    stopGenerationTimer,
    setPersistWarning,
    appendPendingUserTurn,
    rollbackPendingUserTurn,
    finalizePendingTurn,
    replaceTurnAt,
    persistTurnToServer,
    loadMessages,
    scrollChatToBottom,
    endRegeneratingUi,
    emitAssistantReplyComplete,
    t,
  })
  const {
    send,
    sendWithPlugins,
    regenerateAssistant,
    regenerateWithPlugins,
    slideAssistant,
    abortCurrentReply,
  } = outbound

  const isGenerating = computed(
    () => loading.value || regeneratingTurnOrdinal.value !== null,
  )

  const { onComposerKeydown } = useComposerKeydown({
    userInput,
    canSend: computed(
      () =>
        !conversationWriteLocked.value &&
        !pluginHoldConversation.value &&
        !loading.value &&
        regeneratingTurnOrdinal.value === null &&
        conn.isApiKeyConfigured &&
        conn.model.trim().length > 0 &&
        userInput.value.trim().length > 0,
    ),
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
    getAuthToken: () => auth.token,
    getConnAlias: () => conn.alias,
    getConnModel: () => conn.model,
    t,
  })

  const regexDisplay = createRegexDisplayText({
    turns,
    getUserId: () => auth.user?.id ?? auth.defaultUserId,
  })

  const { copiedTurnKey, copyTurnText } = useCopyFeedback()

  const canSend = computed(
    () =>
      !conversationWriteLocked.value &&
      !pluginHoldConversation.value &&
      !loading.value &&
      regeneratingTurnOrdinal.value === null &&
      conn.isApiKeyConfigured &&
      conn.model.trim().length > 0 &&
      userInput.value.trim().length > 0,
  )

  onMounted(() => {
    void scrollChatToBottom()
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
    () => turns.value.length,
    () => {
      void scrollChatToBottom()
    },
    { flush: 'post' },
  )

  watch(streamingText, () => {
    void scrollChatToBottom()
  }, { flush: 'post' })

  watch(regeneratingTurnOrdinal, (cur, prev) => {
    if (prev !== null && cur === null) {
      void nextTick().then(() => scrollChatToBottom())
    }
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
      turns.value = []
      clearPendingSend()
      errorText.value = ''
      turnEditDelete.resetState()
      void regexDisplay.ensureRulesLoaded()
      void loadMessages()
    },
    { immediate: true },
  )

  watch(userInput, (text) => {
    composerDraft.scheduleComposerDraftSave(props.conversationId, text)
  })

  return reactive({
    chatScrollEl,
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
    loadMessages,
    conversationId: props.conversationId,
    conversationWriteLocked,
    pluginHoldConversation,
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
  })
}
