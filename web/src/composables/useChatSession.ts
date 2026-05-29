import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import { normalizeComposerEnterMode } from '@/utils/chat-display-settings'
import type { PromptTrigger } from '@/stores/prompts'
import type {
  AssembleMessagesResult,
  ChatPersistPayload,
  ChatPromptSnapshotEntry,
  ChatSessionProps,
  ChatTurnItem,
  ReceiveItem,
} from '@/types/chat-turn'
import {
  buildConversationChatRequestBody,
  runChatRequest,
} from '@/utils/chat-api'
import { allocateShortId } from '@/utils/short-id'
import {
  applyPersistWarning,
  deleteTurnOnServer,
  fetchConversationTurns,
  persistTurnToServer as persistTurnOnServer,
} from '@/utils/chat-messages'
import {
  assistantReasoning,
  assistantText,
  assistantDurationMs,
  assistantCompletionTokens,
  turnSendEstimatedTokens,
  characterImageUrl,
  isOpeningTurn,
  reasoningCharsCount,
  turnLabelN,
} from '@/utils/chat-turn-display'
import { translateApiError } from '@/utils/api-error-message'
import { formatDurationMs } from '@/utils/format-duration'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export type { ChatSessionProps } from '@/types/chat-turn'

export function useChatSession(props: ChatSessionProps) {
const { t } = useI18n()
const auth = useAuthStore()
const conn = useConnectionStore()
const prefs = usePreferencesStore()
const { writeChatPromptSnapshot } = storeToRefs(prefs)

function collectUsedReceiveIds(turns: ChatTurnItem[]): Set<string> {
  const used = new Set<string>()
  for (const t of turns) {
    for (const r of t.receives) {
      if (r.id?.trim()) used.add(r.id.trim())
    }
  }
  return used
}

function setPersistWarning(persist: ChatPersistPayload | undefined) {
  applyPersistWarning(
    persist,
    (msg) => {
      errorText.value = msg
    },
    t('chat.errors.persistAppendTurnFailed'),
  )
}

function streamDeltaHandler(d: { text?: string; reasoning?: string }) {
  if (d.text) streamingText.value += d.text
  if (d.reasoning) {
    streamingReasoning.value = (streamingReasoning.value || '') + d.reasoning
  }
}

async function requestChatCompletion(
  params: Parameters<typeof buildConversationChatRequestBody>[2],
) {
  return runChatRequest({
    conn,
    conversationId: props.conversationId,
    params,
    requestFailedMessage: (status) =>
      t('chat.errors.requestFailedStatus', { status }),
    noStreamMessage: t('chat.errors.noStream'),
    onStreamDelta: conn.stream ? streamDeltaHandler : undefined,
    onPromptEstimatedTokens: (n) => {
      pendingSendEstimatedTokens.value = n
    },
    onCompletionTokens: (n) => {
      pendingReceiveCompletionTokens.value = n
    },
  })
}

const userInput = ref('')
const turns = ref<ChatTurnItem[]>([])
const streamingText = ref('')
const streamingReasoning = ref('')
/** 已乐观展示用户消息、等待助手回复的轮次 ordinal */
const pendingSendTurnOrdinal = ref<number | null>(null)
/** 本轮发往模型的 messages 估算 token（流式头 / 非流式 JSON） */
const pendingSendEstimatedTokens = ref<number | null>(null)
/** 本轮助手回复 completion_tokens（SSE 末包 / 非流式 JSON） */
const pendingReceiveCompletionTokens = ref<number | null>(null)
const loading = ref(false)
const errorText = ref('')
const regeneratingTurnOrdinal = ref<number | null>(null)

const generationTimerAnchor = ref<number | null>(null)
const generationTimerTick = ref(0)
let generationTimerHandle: ReturnType<typeof setInterval> | null = null

function startGenerationTimer() {
  if (generationTimerHandle) {
    clearInterval(generationTimerHandle)
    generationTimerHandle = null
  }
  generationTimerAnchor.value = performance.now()
  generationTimerTick.value = performance.now()
  generationTimerHandle = setInterval(() => {
    generationTimerTick.value = performance.now()
  }, 100)
}

function stopGenerationTimer(): number {
  if (generationTimerHandle) {
    clearInterval(generationTimerHandle)
    generationTimerHandle = null
  }
  const anchor = generationTimerAnchor.value
  generationTimerAnchor.value = null
  if (anchor == null) return 0
  return Math.round(generationTimerTick.value - anchor)
}

function generationElapsedMs(): number {
  const anchor = generationTimerAnchor.value
  if (anchor == null) return 0
  return Math.round(generationTimerTick.value - anchor)
}

function assistantTimerLabel(turn: ChatTurnItem): string | null {
  if (isAssistantBubbleLoading(turn)) {
    const ms = generationElapsedMs()
    return ms > 0 ? formatDurationMs(ms) : null
  }
  const d = assistantDurationMs(turn)
  return d != null ? formatDurationMs(d) : null
}

/** 该轮用户发送时组装的 prompt 估算 token（turn-role meta） */
function userSendTokenLabel(turn: ChatTurnItem): string | null {
  const awaiting =
    pendingSendTurnOrdinal.value === turn.turnOrdinal ||
    regeneratingTurnOrdinal.value === turn.turnOrdinal
  if (awaiting) {
    const pending = pendingSendEstimatedTokens.value
    if (pending != null && pending > 0) return String(pending)
  }
  const n = turnSendEstimatedTokens(turn)
  return n != null ? String(n) : null
}

/** 该轮助手回复 token（turn-role meta） */
function assistantReceiveTokenLabel(turn: ChatTurnItem): string | null {
  const awaiting =
    pendingSendTurnOrdinal.value === turn.turnOrdinal ||
    regeneratingTurnOrdinal.value === turn.turnOrdinal
  if (awaiting) {
    const n = pendingReceiveCompletionTokens.value
    if (n != null && n > 0) return String(n)
  }
  const n = assistantCompletionTokens(turn)
  return n != null ? String(n) : null
}

const editingTurnOrdinal = ref<number | null>(null)
const editingSide = ref<'user' | 'assistant' | null>(null)
const editDraft = ref('')

/** assistant：删助手变体或整轮；wholeTurn：从用户条工具栏删整轮 */
const deleteTarget = ref<'assistant' | 'wholeTurn' | null>(null)

const deleteDialogOpen = ref(false)
const deleteListIndex = ref<number | null>(null)

const chatScrollEl = ref<HTMLElement | null>(null)

async function scrollChatToBottom() {
  await nextTick()
  await nextTick()
  const apply = () => {
    const el = chatScrollEl.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        apply()
        setTimeout(() => {
          apply()
          resolve()
        }, 0)
      })
    })
  })
}

/** 对话区内最后一条可见的思维链（按 DOM 顺序，即最近一轮助手） */
function lastReasoningChainInChat(): HTMLDetailsElement | null {
  const chains = document.querySelectorAll('.chat-body details.reasoning-chain')
  const last = chains[chains.length - 1]
  return last instanceof HTMLDetailsElement ? last : null
}

/**
 * R 快捷键：切换鼠标 hover 所在 turn 的思维链；若不在 turn 上，切换最后一个 assistant turn 的思维链。
 * 输入框/可编辑区域聚焦时不拦截。
 */
function onGlobalKeyR(e: KeyboardEvent) {
  if (e.key !== 'r' && e.key !== 'R') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target as HTMLElement | null
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable)
  ) {
    return
  }
  const hovered = document.querySelector(
    '.turn--assistant:hover, .turn--assistant.is-hover',
  ) as HTMLElement | null
  const target =
    hovered?.querySelector('details.reasoning-chain') ?? lastReasoningChainInChat()
  if (target instanceof HTMLDetailsElement) {
    target.open = !target.open
    e.preventDefault()
  }
}

onMounted(() => {
  void scrollChatToBottom()
  window.addEventListener('keydown', onGlobalKeyR)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyR)
  if (generationTimerHandle) {
    clearInterval(generationTimerHandle)
    generationTimerHandle = null
  }
})

const canSend = computed(
  () =>
    !loading.value &&
    regeneratingTurnOrdinal.value === null &&
    conn.apiKey.trim().length > 0 &&
    conn.model.trim().length > 0 &&
    userInput.value.trim().length > 0,
)

function nextTurnOrdinal0(): number {
  if (turns.value.length === 0) return 0
  return Math.max(...turns.value.map((t) => t.turnOrdinal)) + 1
}

function isTurnAwaitingAssistant(turn: ChatTurnItem): boolean {
  return pendingSendTurnOrdinal.value === turn.turnOrdinal
}

function isAssistantBubbleLoading(turn: ChatTurnItem): boolean {
  return (
    isTurnAwaitingAssistant(turn) ||
    regeneratingTurnOrdinal.value === turn.turnOrdinal
  )
}

/** 等待首 token / 非流式请求中：显示骨架而非空白或转圈 */
function showAssistantSkeleton(turn: ChatTurnItem): boolean {
  if (!isAssistantBubbleLoading(turn)) return false
  if (conn.stream && streamingText.value.trim()) return false
  return true
}

function isAssistantStreamingBubble(turn: ChatTurnItem): boolean {
  return isAssistantBubbleLoading(turn) && conn.stream && !!streamingText.value.trim()
}

function replaceTurnAt(listIndex: number, next: ChatTurnItem) {
  turns.value = turns.value.map((t, i) => (i === listIndex ? next : t))
}

function clearPendingSend() {
  pendingSendTurnOrdinal.value = null
  pendingSendEstimatedTokens.value = null
  pendingReceiveCompletionTokens.value = null
  streamingText.value = ''
  streamingReasoning.value = ''
}

function appendPendingUserTurn(userText: string, ord: number) {
  turns.value = [
    ...turns.value,
    {
      user: userText,
      receives: [],
      activeReceiveIndex: 0,
      turnOrdinal: ord,
    },
  ]
  userInput.value = ''
  pendingSendTurnOrdinal.value = ord
  void scrollChatToBottom()
}

function rollbackPendingUserTurn(ord: number, restoreUserText?: string) {
  turns.value = turns.value.filter((t) => t.turnOrdinal !== ord)
  clearPendingSend()
  if (restoreUserText) userInput.value = restoreUserText
}

function finalizePendingTurn(ord: number, receive: ReceiveItem) {
  const sendEt = pendingSendEstimatedTokens.value
  const recvCt = pendingReceiveCompletionTokens.value
  const merged: ReceiveItem = {
    ...receive,
    ...(sendEt != null && sendEt > 0 && !receive.estimatedTokens
      ? { estimatedTokens: sendEt }
      : {}),
    ...(recvCt != null && recvCt > 0 && !receive.completionTokens
      ? { completionTokens: recvCt }
      : {}),
  }
  const idx = turns.value.findIndex((t) => t.turnOrdinal === ord)
  if (idx >= 0) {
    const cur = turns.value[idx]
    replaceTurnAt(idx, {
      ...cur,
      receives: [merged],
      activeReceiveIndex: 0,
    })
  }
  clearPendingSend()
}

async function persistTurnToServer(turn: ChatTurnItem): Promise<boolean> {
  return persistTurnOnServer(props.conversationId, turn)
}

async function loadMessages() {
  try {
    turns.value = await fetchConversationTurns(props.conversationId)
  } catch {
    /* ignore */
  } finally {
    await nextTick()
    await scrollChatToBottom()
  }
}

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

watch(
  () => props.conversationId,
  () => {
    turns.value = []
    userInput.value = ''
    clearPendingSend()
    errorText.value = ''
    editingTurnOrdinal.value = null
    editingSide.value = null
    deleteTarget.value = null
    void loadMessages()
  },
  { immediate: true },
)

function insertComposerNewline(e: KeyboardEvent) {
  const el = e.target
  if (!(el instanceof HTMLTextAreaElement)) return
  e.preventDefault()
  const start = el.selectionStart ?? userInput.value.length
  const end = el.selectionEnd ?? start
  const v = userInput.value
  userInput.value = `${v.slice(0, start)}\n${v.slice(end)}`
  void nextTick(() => {
    el.selectionStart = el.selectionEnd = start + 1
  })
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.isComposing) return

  const mode = normalizeComposerEnterMode(prefs.composerEnterMode)
  const mod = e.ctrlKey || e.metaKey

  if (mode === 'enter-send') {
    if (mod) {
      insertComposerNewline(e)
      return
    }
    if (e.shiftKey) return
    e.preventDefault()
    if (canSend.value) void send()
    return
  }

  if (!mod) return
  e.preventDefault()
  if (canSend.value) void send()
}

async function send() {
  errorText.value = ''
  const userText = userInput.value.trim()
  try {
    if (conn.customParamsJson.trim()) {
      conn.parseCustomParams()
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.errors.invalidCustomJson')
    return
  }

  const ord = nextTurnOrdinal0()
  appendPendingUserTurn(userText, ord)
  loading.value = true
  startGenerationTimer()
  try {
    const {
      content: assistantOut,
      reasoning: reasoningOut,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
    } = await requestChatCompletion({
      userText,
      promptTrigger: 'normal',
    })
    setPersistWarning(persist)
    const elapsed = durationMs ?? stopGenerationTimer()
    const receive: ReceiveItem = {
      id: allocateShortId(collectUsedReceiveIds(turns.value)),
      content: assistantOut,
      ...(reasoningOut ? { reasoning: reasoningOut } : {}),
      ...(elapsed > 0 ? { durationMs: elapsed } : {}),
      ...(estimatedTokens && estimatedTokens > 0 ? { estimatedTokens } : {}),
      ...(completionTokens && completionTokens > 0 ? { completionTokens } : {}),
    }
    finalizePendingTurn(ord, receive)

    if (assistantOut.trim() && (!persist || persist.ok)) {
      await loadMessages()
    }
  } catch (e) {
    rollbackPendingUserTurn(ord, userText)
    errorText.value = e instanceof Error ? e.message : t('chat.errors.network')
  } finally {
    stopGenerationTimer()
    loading.value = false
  }
}

function slideAssistant(listIndex: number, direction: 'left' | 'right') {
  const turn = turns.value[listIndex]
  if (!turn || turn.receives.length === 0) return
  const len = turn.receives.length
  const a = turn.activeReceiveIndex

  if (direction === 'left') {
    const nextIdx = a === 0 ? len - 1 : a - 1
    const next = { ...turn, activeReceiveIndex: nextIdx }
    replaceTurnAt(listIndex, next)
    void persistTurnToServer(next)
    return
  }

  if (a === len - 1) {
    if (isOpeningTurn(turn)) {
      const next = { ...turn, activeReceiveIndex: 0 }
      replaceTurnAt(listIndex, next)
      void persistTurnToServer(next)
      return
    }
    void regenerateAssistant(listIndex, 'swipe')
    return
  }
  const next = { ...turn, activeReceiveIndex: a + 1 }
  replaceTurnAt(listIndex, next)
  void persistTurnToServer(next)
}

async function regenerateAssistant(
  listIndex: number,
  trigger: PromptTrigger = 'regenerate',
) {
  const turn = turns.value[listIndex]
  if (!turn || !turn.user.trim()) return
  if (regeneratingTurnOrdinal.value !== null) return
  regeneratingTurnOrdinal.value = turn.turnOrdinal
  pendingSendEstimatedTokens.value = null
  pendingReceiveCompletionTokens.value = null
  streamingText.value = ''
  streamingReasoning.value = ''
  errorText.value = ''
  startGenerationTimer()
  try {
    try {
      if (conn.customParamsJson.trim()) {
        conn.parseCustomParams()
      }
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.errors.invalidCustomJson')
      return
    }

    const {
      content: assistantOut,
      reasoning: reasoningOut,
      persist,
      durationMs,
      estimatedTokens,
      completionTokens,
    } = await requestChatCompletion({
        userText: turn.user,
        promptTrigger: trigger,
        historyBeforeTurnOrdinalExclusive: turn.turnOrdinal,
        regenerateTurnOrdinal: turn.turnOrdinal,
      })
    setPersistWarning(persist)

    streamingText.value = ''
    streamingReasoning.value = ''

    const cur = turns.value[listIndex]
    if (!cur) return
    const elapsed = durationMs ?? stopGenerationTimer()
    const newRec: ReceiveItem = {
      id: allocateShortId(collectUsedReceiveIds(turns.value)),
      content: assistantOut,
      ...(reasoningOut ? { reasoning: reasoningOut } : {}),
      ...(elapsed > 0 ? { durationMs: elapsed } : {}),
      ...(estimatedTokens && estimatedTokens > 0 ? { estimatedTokens } : {}),
      ...(completionTokens && completionTokens > 0 ? { completionTokens } : {}),
    }
    const next: ChatTurnItem = {
      ...cur,
      receives: [...cur.receives, newRec],
      activeReceiveIndex: cur.receives.length,
    }
    replaceTurnAt(listIndex, next)
    if (assistantOut.trim() && (!persist || persist.ok)) {
      await loadMessages()
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : t('chat.errors.network')
  } finally {
    stopGenerationTimer()
    regeneratingTurnOrdinal.value = null
    pendingSendEstimatedTokens.value = null
    pendingReceiveCompletionTokens.value = null
    streamingText.value = ''
    streamingReasoning.value = ''
  }
}

function openEditAssistant(turn: ChatTurnItem) {
  editingTurnOrdinal.value = turn.turnOrdinal
  editingSide.value = 'assistant'
  editDraft.value = assistantText(turn)
}

function openEditUser(turn: ChatTurnItem) {
  editingTurnOrdinal.value = turn.turnOrdinal
  editingSide.value = 'user'
  editDraft.value = turn.user
}

function cancelEdit() {
  editingTurnOrdinal.value = null
  editingSide.value = null
  editDraft.value = ''
}

function saveEdit(listIndex: number) {
  const turn = turns.value[listIndex]
  if (!turn || editingTurnOrdinal.value !== turn.turnOrdinal) return
  const text = editDraft.value
  const side = editingSide.value
  if (side === 'user') {
    const next: ChatTurnItem = {
      ...turn,
      user: text,
    }
    replaceTurnAt(listIndex, next)
    cancelEdit()
    void persistTurnToServer(next)
    return
  }
  if (side === 'assistant') {
    const ai = turn.activeReceiveIndex
    const newReceives = turn.receives.map((r, j) =>
      j === ai ? { ...r, content: text } : r,
    )
    const next: ChatTurnItem = {
      ...turn,
      receives: newReceives,
    }
    replaceTurnAt(listIndex, next)
    cancelEdit()
    void persistTurnToServer(next)
  }
}

function requestDelete(listIndex: number) {
  deleteListIndex.value = listIndex
  deleteTarget.value = 'assistant'
  deleteDialogOpen.value = true
}

function requestDeleteWholeTurnFromUser(listIndex: number) {
  deleteListIndex.value = listIndex
  deleteTarget.value = 'wholeTurn'
  deleteDialogOpen.value = true
}

function cancelDelete() {
  deleteDialogOpen.value = false
  deleteListIndex.value = null
  deleteTarget.value = null
}

async function confirmDelete() {
  const listIndex = deleteListIndex.value
  const target = deleteTarget.value
  if (listIndex === null || !target) return
  const turn = turns.value[listIndex]
  if (!turn) {
    cancelDelete()
    return
  }

  if (target === 'assistant' && turn.receives.length > 1) {
    const active = turn.activeReceiveIndex
    const newReceives = turn.receives.filter((_, j) => j !== active)
    const newActive = Math.min(active, newReceives.length - 1)
    const next: ChatTurnItem = {
      ...turn,
      receives: newReceives,
      activeReceiveIndex: newActive,
    }
    replaceTurnAt(listIndex, next)
    cancelDelete()
    void persistTurnToServer(next)
    return
  }

  try {
    const { ok, status } = await deleteTurnOnServer(
      props.conversationId,
      turn.turnOrdinal,
    )
    if (ok) {
      cancelDelete()
      await loadMessages()
      return
    }
    if (status === 404) {
      turns.value = turns.value
        .filter((_, i) => i !== listIndex)
        .map((t, i) => ({ ...t, turnOrdinal: i }))
      cancelDelete()
      return
    }
    errorText.value = t('chat.errors.deleteTurnFailed')
  } catch {
    errorText.value = t('chat.errors.deleteTurnFailed')
  }
  cancelDelete()
}

const deleteDialogMessage = computed(() => {
  const i = deleteListIndex.value
  const tgt = deleteTarget.value
  if (i === null || !tgt) return ''
  const turn = turns.value[i]
  if (!turn) return ''
  if (tgt === 'assistant' && turn.receives.length > 1) {
    return t('chat.deleteVariantConfirm')
  }
  return t('chat.deleteTurnConfirm')
})

/** 仅最后一轮助手回复显示 swipe；加载/流式进行中不显示 */
function showAssistantSwipeFooter(turn: ChatTurnItem, listIndex: number): boolean {
  if (isAssistantBubbleLoading(turn)) return false
  if (pendingSendTurnOrdinal.value !== null) return false
  if (regeneratingTurnOrdinal.value !== null) return false
  if (listIndex !== turns.value.length - 1) return false
  if (turn.receives.length === 0) return false
  if (
    editingTurnOrdinal.value === turn.turnOrdinal &&
    editingSide.value === 'assistant'
  ) {
    return false
  }
  return true
}

const turnPromptDialogOpen = ref(false)
const turnPromptLoading = ref(false)
const turnPromptError = ref('')
const turnPromptDisplay = ref('')
const turnPromptIsEmpty = ref(false)

const assistantDisplayName = ref('')

const userDisplayName = computed(() => {
  const n = props.conversationUserName?.trim()
  return n || t('chat.userBrand')
})

const assistantRoleName = computed(() => {
  const n = assistantDisplayName.value.trim()
  return n || t('chat.assistantBrand')
})

const userAvatarLetter = computed(() => {
  const m = userDisplayName.value
  const ch = m.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').charAt(0)
  return ch ? ch.toUpperCase() : 'Y'
})

const assistantAvatarLetter = computed(() => {
  const m = assistantRoleName.value || conn.alias.trim() || conn.model.trim()
  if (!m) return 'N'
  const ch = m.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '').charAt(0)
  return ch ? ch.toUpperCase() : 'N'
})

const turnAvatarUrls = ref<Record<'user' | 'assistant', string | null>>({
  user: null,
  assistant: null,
})

async function loadPrimaryAssistantName(id: string | null | undefined) {
  const clean = typeof id === 'string' ? id.trim() : ''
  assistantDisplayName.value = ''
  if (!clean) return
  try {
    const res = await fetch(`/api/characters/${clean}`)
    if (!res.ok) return
    const doc = (await res.json()) as { card?: Record<string, unknown> }
    const name = doc.card?.name
    assistantDisplayName.value =
      typeof name === 'string' && name.trim() ? name.trim() : ''
  } catch {
    /* 卡可能已删除；回退到默认助手名 */
  }
}

watch(
  () =>
    [
      props.conversationUserCharacterId,
      props.conversationCharacterIds,
      auth.token,
    ] as const,
  ([userId, charIds]) => {
    const primaryId = Array.isArray(charIds) ? charIds[0] : undefined
    turnAvatarUrls.value = {
      user: characterImageUrl(userId),
      assistant: characterImageUrl(primaryId),
    }
    void loadPrimaryAssistantName(primaryId)
  },
  { immediate: true, deep: true },
)

const copiedTurnKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyTurnText(text: string, key: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-100vw'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copiedTurnKey.value = key
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedTurnKey.value = null
    }, 1400)
  } catch (e) {
    console.warn('copy failed', e)
  }
}

const assemblePreviewOpen = ref(false)
const assemblePreviewLoading = ref(false)
const assemblePreviewError = ref('')
const assemblePreviewJson = ref('')
const assemblePreviewMeta = ref({
  messages: 0,
  estimatedTokens: 0,
  droppedHistoryCount: 0,
  memoryTurnIds: [] as string[],
})
const assemblePreviewCopied = ref(false)

const canPreviewAssemble = computed(
  () =>
    !assemblePreviewLoading.value &&
    props.conversationId.trim().length > 0,
)

async function fetchAssemblePreview(): Promise<void> {
  assemblePreviewLoading.value = true
  assemblePreviewError.value = ''
  assemblePreviewJson.value = ''
  assemblePreviewMeta.value = {
    messages: 0,
    estimatedTokens: 0,
    droppedHistoryCount: 0,
    memoryTurnIds: [],
  }
  const id = props.conversationId.trim()
  try {
    const res = await fetch(
      `/api/chat/conversations/${id}/assemble-messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: userInput.value.trim(),
          promptTrigger: 'normal',
          contextLength: conn.contextLength ?? undefined,
          model: conn.model.trim() || undefined,
        }),
      },
    )
    if (!res.ok) {
      let msg = t('chat.previewAssembleLoadFailed')
      try {
        const j = (await res.json()) as { error?: string; detail?: string }
        msg =
          (typeof j.error === 'string' && j.error.trim()
            ? translateApiError(j.error.trim())
            : j.detail) || msg
      } catch {
        const text = await res.text()
        if (text.trim()) msg = text.slice(0, 500)
      }
      assemblePreviewError.value = msg
      return
    }
    const data = (await res.json()) as AssembleMessagesResult
    const messages = Array.isArray(data.messages) ? data.messages : []
    assemblePreviewMeta.value = {
      messages: messages.length,
      estimatedTokens:
        typeof data.estimatedTokens === 'number' ? data.estimatedTokens : 0,
      droppedHistoryCount:
        typeof data.droppedHistoryCount === 'number'
          ? data.droppedHistoryCount
          : 0,
      memoryTurnIds: Array.isArray(data.memoryTurnIds)
        ? data.memoryTurnIds.filter((x): x is string => typeof x === 'string')
        : [],
    }
    assemblePreviewJson.value = JSON.stringify(messages, null, 2)
  } catch {
    assemblePreviewError.value = t('chat.previewAssembleLoadFailed')
  } finally {
    assemblePreviewLoading.value = false
  }
}

async function openAssemblePreview() {
  assemblePreviewOpen.value = true
  await fetchAssemblePreview()
}

async function copyAssemblePreviewJson() {
  if (!assemblePreviewJson.value) return
  try {
    await navigator.clipboard.writeText(assemblePreviewJson.value)
    assemblePreviewCopied.value = true
    setTimeout(() => {
      assemblePreviewCopied.value = false
    }, 1200)
  } catch {
    /* ignore */
  }
}

async function openTurnPromptSnapshot(turn: ChatTurnItem) {
  turnPromptDialogOpen.value = true
  turnPromptLoading.value = true
  turnPromptError.value = ''
  turnPromptDisplay.value = ''
  turnPromptIsEmpty.value = false
  const id = props.conversationId
  try {
    const res = await fetch(`/api/chat/conversations/${id}/chat-prompt`)
    if (!res.ok) {
      turnPromptError.value = t('chat.turnPromptLoadFailed')
      return
    }
    const data = (await res.json()) as { entries?: ChatPromptSnapshotEntry[] }
    const entries = Array.isArray(data.entries) ? data.entries : []
    const match = entries.filter((e) => e.turnOrdinal === turn.turnOrdinal)
    const entry = match.length ? match[match.length - 1] : null
    if (!entry) {
      turnPromptIsEmpty.value = true
      return
    }
    turnPromptDisplay.value = JSON.stringify(entry, null, 2)
  } catch {
    turnPromptError.value = t('chat.turnPromptLoadFailed')
  } finally {
    turnPromptLoading.value = false
  }
}
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
    editingTurnOrdinal,
    editingSide,
    editDraft,
    deleteDialogOpen,
    deleteDialogMessage,
    turnPromptDialogOpen,
    turnPromptLoading,
    turnPromptError,
    turnPromptDisplay,
    turnPromptIsEmpty,
    turnAvatarUrls,
    userDisplayName,
    assistantRoleName,
    userAvatarLetter,
    assistantAvatarLetter,
    copiedTurnKey,
    assemblePreviewOpen,
    assemblePreviewLoading,
    assemblePreviewError,
    assemblePreviewJson,
    assemblePreviewMeta,
    assemblePreviewCopied,
    canSend,
    canPreviewAssemble,
    writeChatPromptSnapshot,
    turnLabelN,
    isTurnAwaitingAssistant,
    isAssistantBubbleLoading,
    showAssistantSkeleton,
    isAssistantStreamingBubble,
    isOpeningTurn,
    assistantText,
    assistantReasoning,
    reasoningCharsCount,
    assistantTimerLabel,
    userSendTokenLabel,
    assistantReceiveTokenLabel,
    showAssistantSwipeFooter,
    send,
    onComposerKeydown,
    slideAssistant,
    regenerateAssistant,
    openEditAssistant,
    openEditUser,
    cancelEdit,
    saveEdit,
    requestDelete,
    requestDeleteWholeTurnFromUser,
    cancelDelete,
    confirmDelete,
    copyTurnText,
    openAssemblePreview,
    copyAssemblePreviewJson,
    openTurnPromptSnapshot,
  })
}
