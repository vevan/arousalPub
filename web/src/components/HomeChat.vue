<script setup lang="ts">
import {
  renderReasoningMarkdownToHtml,
  renderRichMessageToHtml,
} from '@/utils/render-rich-message'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import type { PromptTrigger } from '@/stores/prompts'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    conversationId: string
    /** 对话级提示词预设 id；未设置或 null 时用全局激活预设组装 */
    conversationPromptPresetId?: string | null
    /** 已绑定角色 UUID 列表（顺序即主槽）；组装注入将后续使用 */
    conversationCharacterIds?: string[]
    /** 世界书 id 占位，供后续 lore 注入 */
    conversationLorebookIds?: string[]
    /** 会话内 `{{user}}` 快照名 */
    conversationUserName?: string | null
    /** 用户 persona 卡 id；仅用于头像回显 */
    conversationUserCharacterId?: string | null
  }>(),
  {
    conversationPromptPresetId: null,
    conversationCharacterIds: () => [],
    conversationLorebookIds: () => [],
    conversationUserName: null,
    conversationUserCharacterId: null,
  },
)

const { t } = useI18n()
const conn = useConnectionStore()
const prefs = usePreferencesStore()
const { writeChatPromptSnapshot } = storeToRefs(prefs)

interface ReceiveItem {
  id: string
  content: string
  reasoning?: string
}

interface ChatTurnItem {
  user: string
  receives: ReceiveItem[]
  activeReceiveIndex: number
  /** 与 chunk 中一致：从 0 起 */
  turnOrdinal: number
}

const userInput = ref('')
const turns = ref<ChatTurnItem[]>([])
const streamingText = ref('')
const streamingReasoning = ref('')
/** 已乐观展示用户消息、等待助手回复的轮次 ordinal */
const pendingSendTurnOrdinal = ref<number | null>(null)
const loading = ref(false)
const errorText = ref('')
const regeneratingTurnOrdinal = ref<number | null>(null)

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

function turnLabelN(turn: ChatTurnItem, listIndex: number): number {
  if (typeof turn.turnOrdinal === 'number' && !Number.isNaN(turn.turnOrdinal)) {
    return turn.turnOrdinal + 1
  }
  return listIndex + 1
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

function isOpeningTurn(turn: ChatTurnItem): boolean {
  return !turn.user.trim() && turn.receives.length > 0
}

function assistantText(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  return r?.content ?? ''
}

function assistantReasoning(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  const s = r?.reasoning
  return typeof s === 'string' ? s : ''
}

/**
 * 与上游 chat/completions 对齐的多轮消息（仅正文，不含思维链）。
 * 支持 system，因为提示词预设里的条目可以是 system / user / assistant。
 */
type DialogMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatPersistPayload {
  ok: boolean
  error?: string
}

function applyPersistWarning(persist: ChatPersistPayload | undefined) {
  if (persist && !persist.ok) {
    errorText.value =
      (typeof persist.error === 'string' && persist.error.trim()
        ? persist.error
        : t('chat.errors.persistAppendTurnFailed')
      ).slice(0, 500)
  }
}

function replaceTurnAt(listIndex: number, next: ChatTurnItem) {
  turns.value = turns.value.map((t, i) => (i === listIndex ? next : t))
}

function clearPendingSend() {
  pendingSendTurnOrdinal.value = null
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
  const idx = turns.value.findIndex((t) => t.turnOrdinal === ord)
  if (idx >= 0) {
    const cur = turns.value[idx]
    replaceTurnAt(idx, {
      ...cur,
      receives: [receive],
      activeReceiveIndex: 0,
    })
  }
  clearPendingSend()
}

async function persistTurnToServer(turn: ChatTurnItem): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/chat/conversations/${props.conversationId}/turns/${turn.turnOrdinal}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: turn.user,
          receives: turn.receives,
          activeReceiveIndex: turn.activeReceiveIndex,
        }),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

async function loadMessages() {
  try {
    const res = await fetch(
      `/api/chat/conversations/${props.conversationId}/messages`,
    )
    if (!res.ok) return
    const j = (await res.json()) as {
      turns?: {
        user?: string
        turnOrdinal?: number
        receives?: { id: string; content: string; reasoning?: string }[]
        activeReceiveIndex?: number
      }[]
    }
    const raw = j.turns ?? []
    turns.value = raw.map((row, i) => {
      const ord =
        typeof row.turnOrdinal === 'number' && !Number.isNaN(row.turnOrdinal)
          ? row.turnOrdinal
          : i
      const user = typeof row.user === 'string' ? row.user : ''
      const receives = Array.isArray(row.receives)
        ? row.receives.map((r) => {
            const item: ReceiveItem = {
              id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
              content: typeof r.content === 'string' ? r.content : '',
            }
            if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
              item.reasoning = r.reasoning
            }
            return item
          })
        : []
      let ai =
        typeof row.activeReceiveIndex === 'number' &&
        !Number.isNaN(row.activeReceiveIndex)
          ? row.activeReceiveIndex
          : 0
      if (receives.length === 0) {
        return {
          user,
          receives: [],
          activeReceiveIndex: 0,
          turnOrdinal: ord,
        }
      }
      ai = Math.min(Math.max(0, ai), receives.length - 1)
      return {
        user,
        receives,
        activeReceiveIndex: ai,
        turnOrdinal: ord,
      }
    })
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

function buildConversationChatRequestBody(params: {
  userText: string
  promptTrigger: PromptTrigger
  historyBeforeTurnOrdinalExclusive?: number
  regenerateTurnOrdinal?: number
}) {
  let customParams: Record<string, unknown> | undefined
  if (conn.customParamsJson.trim()) {
    customParams = conn.parseCustomParams()
  }

  return {
    alias: conn.alias.trim() || undefined,
    baseUrl: conn.baseUrl.trim() || undefined,
    apiKey: conn.apiKey.trim(),
    model: conn.model.trim(),
    conversationId: props.conversationId,
    userText: params.userText,
    promptTrigger: params.promptTrigger,
    ...(params.historyBeforeTurnOrdinalExclusive !== undefined
      ? {
          historyBeforeTurnOrdinalExclusive:
            params.historyBeforeTurnOrdinalExclusive,
        }
      : {}),
    ...(params.regenerateTurnOrdinal !== undefined
      ? { regenerateTurnOrdinal: params.regenerateTurnOrdinal }
      : {}),
    stream: conn.stream,
    contextLength: conn.contextLength ?? undefined,
    maxTokens: conn.maxTokens ?? undefined,
    temperature: conn.temperature ?? undefined,
    topP: conn.topP ?? undefined,
    topK: conn.topK ?? undefined,
    dry: conn.dry ?? undefined,
    frequencyPenalty: conn.frequencyPenalty ?? undefined,
    presencePenalty: conn.presencePenalty ?? undefined,
    customParams,
    requestReasoning: conn.requestReasoningChain,
  }
}

async function readSseStream(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (d: { text?: string; reasoning?: string }) => void,
): Promise<void> {
  if (!body) throw new Error(t('chat.errors.noStream'))
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data) as {
          choices?: {
            delta?: {
              content?: string
              reasoning_content?: string
              reasoning?: string
              thinking?: string
            }
          }[]
        }
        const d = j.choices?.[0]?.delta
        if (!d) continue
        const out: { text?: string; reasoning?: string } = {}
        if (typeof d.content === 'string' && d.content.length > 0) {
          out.text = d.content
        }
        const rs =
          typeof d.reasoning_content === 'string'
            ? d.reasoning_content
            : typeof d.reasoning === 'string'
              ? d.reasoning
              : typeof d.thinking === 'string'
                ? d.thinking
                : ''
        if (rs.length > 0) out.reasoning = rs
        if (out.text !== undefined || out.reasoning !== undefined) onDelta(out)
      } catch {
        /* ignore non-JSON lines */
      }
    }
  }
}

async function runChatRequest(params: {
  userText: string
  promptTrigger: PromptTrigger
  historyBeforeTurnOrdinalExclusive?: number
  regenerateTurnOrdinal?: number
}): Promise<{
  content: string
  reasoning?: string
  persist?: ChatPersistPayload
}> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildConversationChatRequestBody(params)),
  })

  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      const j = JSON.parse(text) as { detail?: string; error?: string }
      msg = j.detail || j.error || text
    } catch {
      /* not JSON */
    }
    throw new Error(
      msg.slice(0, 2000) ||
        t('chat.errors.requestFailedStatus', { status: String(res.status) }),
    )
  }

  const ct = res.headers.get('content-type') ?? ''
  if (conn.stream && ct.includes('text/event-stream') && res.body) {
    let acc = ''
    let accR = ''
    await readSseStream(res.body, (d) => {
      if (d.text) acc += d.text
      if (d.reasoning) accR += d.reasoning
    })
    const reasoning = accR.trim() || undefined
    return { content: acc, reasoning }
  }

  const data = (await res.json()) as {
    message?: { content?: string; reasoning?: string; reasoning_content?: string }
    persist?: ChatPersistPayload
  }
  const msg = data.message
  const content = typeof msg?.content === 'string' ? msg.content : ''
  const rawR = msg?.reasoning ?? msg?.reasoning_content
  const reasoning =
    typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
  return { content, reasoning, persist: data.persist }
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || !e.ctrlKey) return
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
  try {
    if (conn.stream) {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildConversationChatRequestBody({
            userText,
            promptTrigger: 'normal',
          }),
        ),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          const j = JSON.parse(text) as { detail?: string; error?: string }
          msg = j.detail || j.error || text
        } catch {
          /* not JSON */
        }
        errorText.value =
          msg.slice(0, 2000) ||
          t('chat.errors.requestFailedStatus', { status: String(res.status) })
        rollbackPendingUserTurn(ord, userText)
        return
      }
      const ct = res.headers.get('content-type') ?? ''
      let assistantOut = ''
      let reasoningOut: string | undefined
      if (ct.includes('text/event-stream') && res.body) {
        let accR = ''
        await readSseStream(res.body, (d) => {
          if (d.text) streamingText.value += d.text
          if (d.reasoning) {
            accR += d.reasoning
            streamingReasoning.value = accR
          }
        })
        assistantOut = streamingText.value
        reasoningOut = accR.trim() || undefined
      } else {
        const data = (await res.json()) as {
          message?: { content?: string; reasoning?: string; reasoning_content?: string }
          persist?: ChatPersistPayload
        }
        assistantOut = data.message?.content ?? ''
        const rawR = data.message?.reasoning ?? data.message?.reasoning_content
        reasoningOut =
          typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
        applyPersistWarning(data.persist)
      }
      const receive: ReceiveItem = {
        id: crypto.randomUUID(),
        content: assistantOut,
        ...(reasoningOut ? { reasoning: reasoningOut } : {}),
      }
      finalizePendingTurn(ord, receive)
      if (assistantOut.trim()) {
        await loadMessages()
      }
      return
    }

    const { content: assistantOut, reasoning: reasoningOut, persist } =
      await runChatRequest({ userText, promptTrigger: 'normal' })
    applyPersistWarning(persist)
    const receive: ReceiveItem = {
      id: crypto.randomUUID(),
      content: assistantOut,
      ...(reasoningOut ? { reasoning: reasoningOut } : {}),
    }
    finalizePendingTurn(ord, receive)

    if (assistantOut.trim()) {
      await loadMessages()
    }
  } catch (e) {
    rollbackPendingUserTurn(ord, userText)
    errorText.value = e instanceof Error ? e.message : t('chat.errors.network')
  } finally {
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
  streamingText.value = ''
  streamingReasoning.value = ''
  errorText.value = ''
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

    let assistantOut = ''
    let reasoningOut: string | undefined
    if (conn.stream) {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildConversationChatRequestBody({
            userText: turn.user,
            promptTrigger: trigger,
            historyBeforeTurnOrdinalExclusive: turn.turnOrdinal,
            regenerateTurnOrdinal: turn.turnOrdinal,
          }),
        ),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          const j = JSON.parse(text) as { detail?: string; error?: string }
          msg = j.detail || j.error || text
        } catch {
          /* not JSON */
        }
        errorText.value =
          msg.slice(0, 2000) ||
          t('chat.errors.requestFailedStatus', { status: String(res.status) })
        return
      }
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('text/event-stream') && res.body) {
        let accR = ''
        await readSseStream(res.body, (d) => {
          if (d.text) streamingText.value += d.text
          if (d.reasoning) {
            accR += d.reasoning
            streamingReasoning.value = accR
          }
        })
        assistantOut = streamingText.value
        reasoningOut = accR.trim() || undefined
      } else {
        const data = (await res.json()) as {
          message?: { content?: string; reasoning?: string; reasoning_content?: string }
          persist?: ChatPersistPayload
        }
        assistantOut = data.message?.content ?? ''
        const rawR = data.message?.reasoning ?? data.message?.reasoning_content
        reasoningOut =
          typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
        applyPersistWarning(data.persist)
      }
    } else {
      const r = await runChatRequest({
        userText: turn.user,
        promptTrigger: trigger,
        historyBeforeTurnOrdinalExclusive: turn.turnOrdinal,
        regenerateTurnOrdinal: turn.turnOrdinal,
      })
      assistantOut = r.content
      reasoningOut = r.reasoning
      applyPersistWarning(r.persist)
    }

    streamingText.value = ''
    streamingReasoning.value = ''

    const cur = turns.value[listIndex]
    if (!cur) return
    const newRec: ReceiveItem = {
      id: crypto.randomUUID(),
      content: assistantOut,
      ...(reasoningOut ? { reasoning: reasoningOut } : {}),
    }
    const next: ChatTurnItem = {
      ...cur,
      receives: [...cur.receives, newRec],
      activeReceiveIndex: cur.receives.length,
    }
    replaceTurnAt(listIndex, next)
    if (assistantOut.trim()) {
      await loadMessages()
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : t('chat.errors.network')
  } finally {
    regeneratingTurnOrdinal.value = null
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
    const res = await fetch(
      `/api/chat/conversations/${props.conversationId}/turns/${turn.turnOrdinal}`,
      { method: 'DELETE' },
    )
    if (res.ok) {
      cancelDelete()
      await loadMessages()
      return
    }
    if (res.status === 404) {
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

/** 仅最后一轮助手回复显示 swipe；流式进行中不显示（当前最后一条尚未定稿） */
function showAssistantSwipeFooter(turn: ChatTurnItem, listIndex: number): boolean {
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

interface ChatPromptSnapshotEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: { role: string; content: string }[]
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

function characterImageUrl(id: string | null | undefined): string | null {
  const clean = typeof id === 'string' ? id.trim() : ''
  return clean ? `/api/characters/${clean}/image` : null
}

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
  () => [props.conversationUserCharacterId, props.conversationCharacterIds] as const,
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

function reasoningCharsCount(text: string): number {
  if (!text) return 0
  return text.replace(/\s+/g, '').length
}

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

</script>

<template>
  <div
    ref="chatScrollEl"
    class="chat-body chat-scroll"
  >
    <template v-for="(turn, i) in turns" :key="`${turn.turnOrdinal}-${i}`">
      <div class="turn-block">
        <!-- 章回分隔 · ❦ 第 N 回 ❦ -->
        <div class="turn-divider" role="separator">
          <span class="turn-divider__line" />
          <span class="turn-divider__ornament">❦</span>
          <span class="turn-divider__label">
            {{ $t('chat.turnLabel', { n: turnLabelN(turn, i) }) }}
          </span>
          <span class="turn-divider__ornament">❦</span>
          <span class="turn-divider__line" />
        </div>

        <!-- User turn -->
        <div
          v-if="!isOpeningTurn(turn)"
          class="turn turn--user"
        >
          <div class="turn-avatar avatar avatar--user" aria-hidden="true">
            <img v-if="turnAvatarUrls.user" :src="turnAvatarUrls.user" alt="" />
            <span v-else>{{ userAvatarLetter }}</span>
          </div>
          <div class="turn-role turn-role--user">
            <span class="turn-role__label">
              {{ userDisplayName }}
              <span class="meta">{{ $t('chat.turnLabel', { n: turnLabelN(turn, i) }) }}</span>
            </span>
            <div class="plugin-slots" data-plugin-slot="user-turn">
              <button
                type="button"
                class="plugin-slot"
                :data-tt="$t('chat.pluginPlaceholderBookmark')"
                :aria-label="$t('chat.pluginPlaceholderBookmark')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                type="button"
                class="plugin-slot"
                :data-tt="$t('chat.pluginPlaceholderTranslate')"
                :aria-label="$t('chat.pluginPlaceholderTranslate')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
              </button>
              <button
                type="button"
                class="plugin-slot"
                :data-tt="$t('chat.pluginPlaceholderMore')"
                :aria-label="$t('chat.pluginPlaceholderMore')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          <template v-if="editingTurnOrdinal === turn.turnOrdinal && editingSide === 'user'">
            <div class="turn-bubble turn-bubble--user turn-bubble--editing">
              <v-textarea
                v-model="editDraft"
                rows="3"
                auto-grow
                max-rows="16"
                variant="outlined"
                density="compact"
                hide-details="auto"
                class="mb-2"
              />
              <div class="d-flex gap-2 justify-end">
                <v-btn size="small" variant="text" @click="cancelEdit">
                  {{ $t('settings.themeCancel') }}
                </v-btn>
                <v-btn size="small" color="primary" variant="flat" @click="saveEdit(i)">
                  {{ $t('settings.themeConfirm') }}
                </v-btn>
              </div>
            </div>
          </template>
          <div
            v-else
            class="turn-bubble turn-bubble--user"
          >
            <div
              class="chat-rich-text"
              v-html="renderRichMessageToHtml(turn.user)"
            />
          </div>

          <div class="turn-toolbar turn-toolbar--user">
            <button
              type="button"
              class="turn-toolbar__btn"
              :disabled="regeneratingTurnOrdinal !== null || isTurnAwaitingAssistant(turn)"
              :data-tt="$t('chat.edit')"
              :aria-label="$t('chat.edit')"
              @click="openEditUser(turn)"
            >
              <v-icon size="16">mdi-pencil-outline</v-icon>
            </button>
            <button
              type="button"
              class="turn-toolbar__btn"
              :data-tt="copiedTurnKey === `u-${turn.turnOrdinal}` ? $t('chat.copied') : $t('chat.copy')"
              :class="{ 'is-success': copiedTurnKey === `u-${turn.turnOrdinal}` }"
              :aria-label="$t('chat.copy')"
              @click="copyTurnText(turn.user, `u-${turn.turnOrdinal}`)"
            >
              <v-icon size="16">{{ copiedTurnKey === `u-${turn.turnOrdinal}` ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
            </button>
            <button
              type="button"
              class="turn-toolbar__btn turn-toolbar__btn--danger"
              :disabled="regeneratingTurnOrdinal !== null || isTurnAwaitingAssistant(turn)"
              :data-tt="$t('chat.delete')"
              :aria-label="$t('chat.delete')"
              @click="requestDeleteWholeTurnFromUser(i)"
            >
              <v-icon size="16">mdi-delete-outline</v-icon>
            </button>
          </div>
        </div>

        <!-- Assistant turn -->
        <div class="turn turn--assistant">
          <div class="turn-avatar avatar avatar--assistant" aria-hidden="true">
            <img v-if="turnAvatarUrls.assistant" :src="turnAvatarUrls.assistant" alt="" />
            <span v-else>{{ assistantAvatarLetter }}</span>
          </div>
          <div class="turn-role turn-role--assistant">
            <span class="turn-role__label">
              {{ assistantRoleName }}
              <span class="meta">
                {{ $t('chat.turnLabel', { n: turnLabelN(turn, i) }) }}
                <template v-if="conn.model.trim()"> · {{ conn.model.trim() }}</template>
                <template v-if="isAssistantStreamingBubble(turn)">
                  {{ $t('chat.streamingSuffix') }}
                </template>
              </span>
            </span>
            <div class="plugin-slots" data-plugin-slot="assistant-turn">
              <button
                type="button"
                class="plugin-slot"
                :class="{
                  'is-filled':
                    (conn.showReasoningChain && assistantReasoning(turn).length > 0) ||
                    (isAssistantBubbleLoading(turn) && !!streamingReasoning),
                }"
                :data-tt="$t('chat.pluginIndicatorReasoning')"
                :aria-label="$t('chat.pluginIndicatorReasoning')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 11a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
                  <path d="M17.657 16.657L13.414 20.9a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" />
                </svg>
              </button>
              <button
                type="button"
                class="plugin-slot"
                :class="{ 'is-filled': isAssistantStreamingBubble(turn) }"
                :data-tt="$t('chat.pluginIndicatorStream')"
                :aria-label="$t('chat.pluginIndicatorStream')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </button>
              <button
                type="button"
                class="plugin-slot"
                :data-tt="$t('chat.pluginPlaceholderTts')"
                :aria-label="$t('chat.pluginPlaceholderTts')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              </button>
              <button
                type="button"
                class="plugin-slot"
                :data-tt="$t('chat.pluginPlaceholderMore')"
                :aria-label="$t('chat.pluginPlaceholderMore')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          <details
            v-if="
              conn.showReasoningChain &&
              isAssistantBubbleLoading(turn) &&
              streamingReasoning &&
              !(editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant')
            "
            class="reasoning-chain"
          >
            <summary class="reasoning-chain__summary">
              <span class="reasoning-chain__caret">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span class="reasoning-chain__title">
                {{ $t('chat.reasoningSummary') }}
                <span class="reasoning-chain__meta">
                  {{ $t('chat.reasoningCharsMeta', { n: reasoningCharsCount(streamingReasoning) }) }}
                </span>
              </span>
              <span class="reasoning-chain__hint">
                <span class="reasoning-chain__hint-expand">{{ $t('chat.expand') }}</span>
                <span class="reasoning-chain__hint-collapse">{{ $t('chat.collapse') }}</span>
                <kbd>{{ $t('chat.shortcutKey') }}</kbd>
              </span>
            </summary>
            <div
              class="reasoning-chain__body chat-rich-text"
              v-html="renderReasoningMarkdownToHtml(streamingReasoning)"
            />
          </details>

          <details
            v-if="
              conn.showReasoningChain &&
              assistantReasoning(turn).length > 0 &&
              !isAssistantBubbleLoading(turn) &&
              !(editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant')
            "
            class="reasoning-chain"
          >
            <summary class="reasoning-chain__summary">
              <span class="reasoning-chain__caret">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span class="reasoning-chain__title">
                {{ $t('chat.reasoningSummary') }}
                <span class="reasoning-chain__meta">
                  {{ $t('chat.reasoningCharsMeta', { n: reasoningCharsCount(assistantReasoning(turn)) }) }}
                </span>
              </span>
              <span class="reasoning-chain__hint">
                <span class="reasoning-chain__hint-expand">{{ $t('chat.expand') }}</span>
                <span class="reasoning-chain__hint-collapse">{{ $t('chat.collapse') }}</span>
                <kbd>{{ $t('chat.shortcutKey') }}</kbd>
              </span>
            </summary>
            <div
              class="reasoning-chain__body chat-rich-text"
              v-html="renderReasoningMarkdownToHtml(assistantReasoning(turn))"
            />
          </details>

          <div
            class="turn-bubble turn-bubble--assistant position-relative"
            :class="{
              'turn-bubble--streaming': isAssistantStreamingBubble(turn),
            }"
          >
            <template v-if="editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant'">
              <v-textarea
                v-model="editDraft"
                rows="3"
                auto-grow
                max-rows="16"
                variant="outlined"
                density="compact"
                hide-details="auto"
                class="mb-2"
              />
              <div class="d-flex gap-2 justify-end">
                <v-btn size="small" variant="text" @click="cancelEdit">
                  {{ $t('settings.themeCancel') }}
                </v-btn>
                <v-btn size="small" color="primary" variant="flat" @click="saveEdit(i)">
                  {{ $t('settings.themeConfirm') }}
                </v-btn>
              </div>
            </template>
            <template v-else-if="isAssistantBubbleLoading(turn)">
              <div
                v-if="isAssistantStreamingBubble(turn)"
                class="chat-rich-text"
                v-html="renderRichMessageToHtml(streamingText)"
              />
              <v-skeleton-loader
                v-else
                type="paragraph"
                class="assistant-bubble-skeleton"
                :aria-label="$t('chat.assistantLoading')"
              />
            </template>
            <template v-else>
              <div
                class="chat-rich-text"
                v-html="renderRichMessageToHtml(assistantText(turn))"
              />
            </template>


          </div>

          <div
            v-if="!isAssistantBubbleLoading(turn)"
            class="turn-toolbar turn-toolbar--assistant"
          >
            <button
              type="button"
              class="turn-toolbar__btn"
              :disabled="regeneratingTurnOrdinal !== null"
              :data-tt="$t('chat.edit')"
              :aria-label="$t('chat.edit')"
              @click="openEditAssistant(turn)"
            >
              <v-icon size="16">mdi-pencil-outline</v-icon>
            </button>
            <button
              type="button"
              class="turn-toolbar__btn"
              :disabled="regeneratingTurnOrdinal !== null || !turn.user.trim()"
              :data-tt="$t('chat.regenerate')"
              :aria-label="$t('chat.regenerate')"
              @click="regenerateAssistant(i)"
            >
              <v-icon size="16">mdi-refresh</v-icon>
            </button>
            <button
              type="button"
              class="turn-toolbar__btn"
              :data-tt="copiedTurnKey === `a-${turn.turnOrdinal}` ? $t('chat.copied') : $t('chat.copy')"
              :class="{ 'is-success': copiedTurnKey === `a-${turn.turnOrdinal}` }"
              :aria-label="$t('chat.copy')"
              @click="copyTurnText(assistantText(turn), `a-${turn.turnOrdinal}`)"
            >
              <v-icon size="16">{{ copiedTurnKey === `a-${turn.turnOrdinal}` ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
            </button>
            <button
              v-if="writeChatPromptSnapshot"
              type="button"
              class="turn-toolbar__btn"
              :disabled="regeneratingTurnOrdinal !== null"
              :data-tt="$t('chat.viewTurnPrompt')"
              :aria-label="$t('chat.viewTurnPrompt')"
              @click="openTurnPromptSnapshot(turn)"
            >
              <v-icon size="16">mdi-text-box-search-outline</v-icon>
            </button>
            <button
              type="button"
              class="turn-toolbar__btn turn-toolbar__btn--danger"
              :disabled="regeneratingTurnOrdinal !== null"
              :data-tt="$t('chat.delete')"
              :aria-label="$t('chat.delete')"
              @click="requestDelete(i)"
            >
              <v-icon size="16">mdi-delete-outline</v-icon>
            </button>
          </div>

          <!-- swipe · 仅最后一轮 assistant -->
          <div
            v-if="showAssistantSwipeFooter(turn, i)"
            class="swipe"
            :aria-label="
              $t('chat.swipePosition', {
                current: turn.activeReceiveIndex + 1,
                total: turn.receives.length,
              })
            "
          >
            <button
              type="button"
              class="swipe__btn"
              :disabled="regeneratingTurnOrdinal !== null"
              :aria-label="$t('chat.prevAssistant')"
              @click="slideAssistant(i, 'left')"
            >
              <v-icon size="16">mdi-chevron-left</v-icon>
            </button>
            <span class="swipe__count tabular-nums">
              {{ turn.activeReceiveIndex + 1 }} / {{ turn.receives.length }}
            </span>
            <button
              type="button"
              class="swipe__btn"
              :disabled="regeneratingTurnOrdinal !== null"
              :aria-label="$t('chat.nextAssistant')"
              @click="slideAssistant(i, 'right')"
            >
              <v-icon size="16">mdi-chevron-right</v-icon>
            </button>
          </div>
        </div>
      </div>
    </template>


    <div
      v-if="!turns.length && !errorText"
      class="chat-empty"
    >
      <div class="chat-empty__ornament">❦</div>
      <div class="chat-empty__text">
        {{ $t('chat.emptyHint') }}
      </div>
    </div>
  </div>

  <!-- Composer · 底部输入栏 -->
  <div class="chat-footer">
    <div class="chat-footer__inner">
      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        class="text-pre-wrap mb-3"
        density="compact"
      >
        {{ errorText }}
      </v-alert>
      <div class="composer">
        <textarea
          v-model="userInput"
          class="composer__textarea"
          rows="3"
          :placeholder="$t('chat.messageLabel')"
          @keydown="onComposerKeydown"
        />
        <div
          class="composer__tools"
          data-plugin-slot="composer-toolbar"
        >
          <span class="composer__hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> {{ $t('chat.send') }}
          </span>
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            density="comfortable"
            :loading="loading"
            :disabled="!canSend"
            class="composer__send-btn"
            @click="send"
          >
            <v-icon size="16" start>mdi-send</v-icon>
            {{ $t('chat.send') }}
          </v-btn>
        </div>
      </div>
    </div>
  </div>

  <v-dialog
    v-model="deleteDialogOpen"
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('chat.delete') }}
      </v-card-title>
      <v-card-text class="text-body-2">
        {{ deleteDialogMessage }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="cancelDelete"
        >
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          @click="confirmDelete"
        >
          {{ $t('chat.delete') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="turnPromptDialogOpen"
    scrollable
  >
    <v-card>
      <v-card-title class="text-h6">
        {{ $t('chat.turnPromptDialogTitle') }}
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4" style="max-height: min(70vh, 32rem)">
        <v-progress-linear
          v-if="turnPromptLoading"
          indeterminate
          class="mb-2 rounded"
          color="primary"
        />
        <v-alert
          v-if="turnPromptError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-0"
        >
          {{ turnPromptError }}
        </v-alert>
        <template v-else-if="!turnPromptLoading">
          <p
            v-if="turnPromptIsEmpty"
            class="text-body-2 text-medium-emphasis mb-0"
          >
            {{ $t('chat.turnPromptEmpty') }}
          </p>
          <pre
            v-else
            class="prompt-json text-body-2 mb-0"
          >{{ turnPromptDisplay }}</pre>
        </template>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn
          variant="text"
          @click="turnPromptDialogOpen = false"
        >
          {{ $t('chat.turnPromptClose') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* ========== Chat body 滚动 ========== */
.chat-body {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 1rem 0;
}
.chat-scroll {
  padding-inline: 0;
}

/* ========== Turn block · 章节级容器 ========== */
.turn-block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0 auto 2rem;
  width: 100%;
}

/* ========== 章回分隔 ❦ 第 N 回 ❦ ========== */
.turn-divider {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0 2rem;
  margin-bottom: 0.25rem;
  user-select: none;
}
.turn-divider__line {
  flex: 1;
  height: 0.0625rem;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(var(--v-theme-primary), 0.35),
    transparent
  );
}
.turn-divider__ornament {
  color: rgb(var(--v-theme-primary));
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-style: italic;
  line-height: 1;
}
.turn-divider__label {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* ========== Turn · Grid 排版 ========== */
.turn {
  display: grid;
  column-gap: 1rem;
  row-gap: 0.375rem;
  padding: 0 2rem;
}
.turn--assistant {
  grid-template-columns: 4rem minmax(0, 1fr);
  grid-template-areas:
    "avatar role"
    "avatar reasoning"
    "avatar bubble"
    "avatar tools"
    "avatar swipe";
}
.turn--user {
  grid-template-columns: minmax(0, 1fr) 4rem;
  grid-template-areas:
    "role     avatar"
    "bubble   avatar"
    "tools    avatar";
  justify-items: end;
}

.turn > .turn-avatar    { grid-area: avatar; align-self: start; }
.turn > .turn-role      { grid-area: role; align-self: center; }
.turn > .turn-bubble    { grid-area: bubble; width: 100%; }
.turn > .turn-toolbar   { grid-area: tools; }
.turn > .reasoning-chain{ grid-area: reasoning; }
.turn > .swipe          { grid-area: swipe; justify-self: start; }
.turn--user > .turn-bubble  { width: fit-content; max-width: 100%; }

/* ========== Avatar · 4rem 客栈名牌 ========== */
.avatar {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  border: 0.125rem solid rgb(var(--v-theme-secondary));
  background: rgb(var(--v-theme-surface-light));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-style: italic;
  font-size: 2.125rem;
  font-weight: 500;
  color: rgb(var(--v-theme-secondary));
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
  box-shadow:
    0 0 0 0.0625rem rgb(var(--v-theme-background)) inset,
    0 0.25rem 0.75rem rgb(0 0 0 / 0.35),
    0 0.0625rem 0 rgba(var(--v-theme-on-surface), 0.04);
  background-image: radial-gradient(
    circle at 30% 25%,
    rgba(var(--v-theme-on-surface), 0.10),
    transparent 55%
  );
  line-height: 1;
}
.avatar::after {
  content: '';
  position: absolute;
  inset: 0.125rem;
  border-radius: 50%;
  background: linear-gradient(
    160deg,
    rgb(255 255 255 / 0.06) 0%,
    transparent 35%,
    transparent 65%,
    rgb(0 0 0 / 0.15) 100%
  );
  pointer-events: none;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar--user {
  border-color: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-secondary));
}
.avatar--assistant {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  background-image: radial-gradient(
    circle at 30% 25%,
    rgba(var(--v-theme-primary), 0.20),
    transparent 60%
  );
}

/* ========== Role 行 · label + plugin slots ========== */
.turn-role {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-height: 1.75rem;
  max-width: 100%;
}
.turn-role--user {
  flex-direction: row-reverse;
}
.turn-role__label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
}
.turn-role--user .turn-role__label { color: rgb(var(--v-theme-secondary)); }
.turn-role--assistant .turn-role__label { color: rgb(var(--v-theme-primary)); }
.turn-role__label .meta {
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-left: 0.5rem;
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.7813rem;
  font-weight: 400;
  letter-spacing: 0.01em;
  text-transform: none;
}

/* Plugin slots 容器：未被插件填充时不占空间 */
.plugin-slots {
  display: flex;
  align-items: center;
  gap: 0.1875rem;
  flex: 1;
  min-width: 0;
}
.turn-role--user .plugin-slots { justify-content: flex-end; }
.turn-role--assistant .plugin-slots { justify-content: flex-start; }
.plugin-slots:empty { display: none; }

/* 插件按钮（由插件渲染时使用此 class） */
.plugin-slots :deep(.plugin-slot) {
  width: 1.5rem;
  height: 1.5rem;
  border: 0.0625rem dashed rgba(var(--v-theme-on-surface), 0.10);
  background: transparent;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
}
.plugin-slots :deep(.plugin-slot:hover) {
  border-style: solid;
  border-color: rgba(var(--v-theme-primary), 0.35);
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
}
.plugin-slots :deep(.plugin-slot.is-filled) {
  border-style: solid;
  border-color: rgba(var(--v-theme-secondary), 0.45);
  color: rgb(var(--v-theme-secondary));
  background: rgba(var(--v-theme-secondary), 0.08);
}
.plugin-slots :deep(.plugin-slot svg) {
  width: 0.8125rem;
  height: 0.8125rem;
  display: block;
}
.plugin-slots :deep(.plugin-slot:disabled) {
  cursor: not-allowed;
  opacity: 0.5;
}

/* ========== 气泡 + 指向头像的小三角 ========== */
.turn-bubble {
  padding: 0.875rem 1.125rem;
  border-radius: var(--radius);
  line-height: 1.65;
  font-size: 0.9063rem;
  color: rgb(var(--v-theme-on-surface));
  position: relative;
  text-align: start;
}
.turn-bubble--user {
  background: rgba(var(--v-theme-secondary), 0.06);
  border: 0.0625rem solid rgba(var(--v-theme-secondary), 0.20);
}
.turn-bubble--user::before {
  content: '';
  position: absolute;
  right: -0.4375rem;
  top: 0.875rem;
  width: 0.75rem;
  height: 0.75rem;
  background: rgba(var(--v-theme-secondary), 0.06);
  border-top: 0.0625rem solid rgba(var(--v-theme-secondary), 0.20);
  border-right: 0.0625rem solid rgba(var(--v-theme-secondary), 0.20);
  transform: rotate(45deg);
}
.turn-bubble--assistant {
  background: rgb(var(--v-theme-surface-light));
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
}
.turn-bubble--assistant::before {
  content: '';
  position: absolute;
  left: -0.4375rem;
  top: 0.875rem;
  width: 0.75rem;
  height: 0.75rem;
  background: rgb(var(--v-theme-surface-light));
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-left: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  transform: rotate(45deg);
}
.turn-bubble--streaming {
  border-style: dashed;
}
.assistant-bubble-skeleton {
  background: transparent;
  padding: 0;
  margin: 0;
}
.assistant-bubble-skeleton :deep(.v-skeleton-loader__bone) {
  margin-block: 0.375rem;
}
.turn-bubble--editing {
  background: rgb(var(--v-theme-surface-bright));
}

/* Tavern · 助手气泡内的 **xxx** 渲染为「角色名」赤土橙衬线斜体（对应 demo 的 em.character） */
.turn-bubble--assistant .chat-rich-text :deep(strong),
.turn-bubble--assistant .chat-rich-text :deep(b) {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  font-size: 1.02em;
  color: rgb(var(--v-theme-primary));
}
/* `*xxx*` 单星斜体保留正文白色，避免误伤 */
.turn-bubble--assistant .chat-rich-text :deep(em),
.turn-bubble--assistant .chat-rich-text :deep(i) {
  font-style: italic;
  color: inherit;
}


/* ========== Toolbar · icon-only + tooltip ========== */
.turn-toolbar {
  display: flex;
  gap: 0.125rem;
  align-items: center;
}
.turn-toolbar--user { justify-content: flex-end; }
.turn-toolbar--assistant { justify-content: flex-start; }

.turn-toolbar__btn {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  position: relative;
}
.turn-toolbar__btn:hover:not(:disabled) {
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.turn-toolbar__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.turn-toolbar__btn--danger:hover:not(:disabled) {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.10);
}
.turn-toolbar__btn.is-success {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.12);
}

/* ========== Tooltip · 纯 CSS [data-tt] ========== */
[data-tt] {
  position: relative;
}
[data-tt]:hover:not(:disabled)::after {
  content: attr(data-tt);
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 50%;
  transform: translateX(-50%);
  background: rgb(var(--v-theme-surface-bright));
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgb(var(--v-theme-on-surface));
  font: 500 0.6875rem var(--font-ui);
  padding: 0.25rem 0.5625rem;
  border-radius: 0.25rem;
  white-space: nowrap;
  pointer-events: none;
  z-index: 20;
  letter-spacing: 0.02em;
  box-shadow: 0 0.25rem 0.75rem rgb(0 0 0 / 0.35);
}
[data-tt]:hover:not(:disabled)::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 0.125rem);
  left: 50%;
  transform: translateX(-50%);
  border: 0.3125rem solid transparent;
  border-top-color: rgb(var(--v-theme-surface-bright));
  pointer-events: none;
  z-index: 20;
}

/* ========== Swipe · 可滑动变体 ========== */
.swipe {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1875rem 0.3125rem;
  background: rgb(var(--v-theme-surface-light));
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: var(--radius-sm);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font: 500 0.6875rem var(--font-mono);
  letter-spacing: 0.04em;
  margin-top: 0.25rem;
}
.swipe__btn {
  width: 1.375rem;
  height: 1.375rem;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.swipe__btn:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}
.swipe__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.swipe__count {
  min-width: 2.5rem;
  text-align: center;
  user-select: none;
  line-height: 1;
}

/* ========== 可折叠思维链 · 对齐 demo-v3（hair + accent-soft 左条 + 极淡赤土底） ========== */
.reasoning-chain {
  /* 原型：0.0625rem hair + 0.125rem 压暗主色实线左边（非半透明 primary） */
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
  border-left: 0.125rem solid rgb(var(--v-theme-primary-darken-1));
  border-radius: 0.25rem var(--radius) var(--radius) 0.25rem;
  background: rgba(var(--v-theme-primary), 0.03);
  overflow: hidden;
  margin-bottom: 0.125rem;
}
.reasoning-chain__summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4375rem 0.75rem;
  cursor: pointer;
  user-select: none;
  font: 500 0.6875rem var(--font-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-primary));
  /* 原型 summary：rgba(217,96,46,0.04) */
  background: rgba(var(--v-theme-primary), 0.04);
  transition: background 0.12s;
}
.reasoning-chain__summary::-webkit-details-marker {
  display: none;
}
.reasoning-chain__summary:hover {
  /* 原型 hover：0.08 */
  background: rgba(var(--v-theme-primary), 0.08);
}
.reasoning-chain__caret {
  display: inline-flex;
  width: 0.625rem;
  height: 0.625rem;
  transition: transform 0.2s ease;
  color: rgb(var(--v-theme-primary));
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}
.reasoning-chain__caret svg {
  width: 100%;
  height: 100%;
  display: block;
}
.reasoning-chain[open] .reasoning-chain__caret {
  transform: rotate(90deg);
}
.reasoning-chain__title {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.reasoning-chain__sep {
  opacity: 0.4;
  font-weight: 400;
}
.reasoning-chain__meta {
  margin-left: 0.375rem;
  /* 原型 reasoning-chain__meta：ink-faint */
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-weight: 400;
  letter-spacing: 0.06em;
  text-transform: none;
  font-size: 0.6563rem;
}
.reasoning-chain__hint {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: none;
  font-size: 0.6563rem;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
.reasoning-chain__hint kbd {
  font: 500 0.625rem var(--font-mono);
  padding: 0.0625rem 0.3125rem;
  /* 原型：hair-strong 边框 + 最深底 + ink-muted 字 */
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 0.1875rem;
  background: rgb(var(--v-theme-background));
  color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 1;
}
.reasoning-chain:not([open]) .reasoning-chain__hint-collapse { display: none; }
.reasoning-chain[open] .reasoning-chain__hint-expand { display: none; }
.reasoning-chain__body {
  padding: 0.875rem 1.125rem 1rem;
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.8438rem;
  line-height: 1.8;
  color: rgba(var(--v-theme-on-surface), 0.72);
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
}
.reasoning-chain__body :deep(p) {
  margin: 0 0 0.5em;
}
.reasoning-chain__body :deep(p:last-child) { margin-bottom: 0; }
.reasoning-chain__body :deep(strong) {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
  font-style: normal;
}
.reasoning-chain__body :deep(em) {
  color: rgb(var(--v-theme-secondary));
}
/* markdown 解析出的 list 退化为普通段落（不要数字/项目符号） */
.reasoning-chain__body :deep(ul),
.reasoning-chain__body :deep(ol) {
  list-style: none;
  padding: 0;
  margin: 0;
}
.reasoning-chain__body :deep(li) {
  margin: 0 0 0.5em;
}
.reasoning-chain__body :deep(li:last-child) { margin-bottom: 0; }
.reasoning-chain__body :deep(code),
.reasoning-chain__body :deep(pre) {
  font-style: normal;
}

/* ========== Empty state ========== */
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem 2rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-align: center;
  user-select: none;
}
.chat-empty__ornament {
  font-family: var(--font-display);
  font-size: 1.75rem;
  font-style: italic;
  color: rgba(var(--v-theme-primary), 0.55);
  margin-bottom: 0.75rem;
}
.chat-empty__text {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.9375rem;
  letter-spacing: 0.01em;
}

/* ========== Composer · 底部输入 ========== */
.chat-footer {
  padding: 0.75rem 2rem calc(0.75rem + env(safe-area-inset-bottom, 0));
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
  background: linear-gradient(
    180deg,
    transparent,
    rgba(var(--v-theme-surface-light), 0.4)
  );
}
.chat-footer__inner {
  width: 100%;
  margin: 0;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.composer__textarea {
  width: 100%;
  background: rgb(var(--v-theme-surface-light));
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: var(--radius);
  color: rgb(var(--v-theme-on-surface));
  font: 400 0.875rem var(--font-ui);
  line-height: 1.55;
  padding: 0.75rem 0.875rem;
  min-height: 5rem;
  max-height: 20rem;
  resize: vertical;
  outline: none;
  transition: border-color 0.18s, background 0.18s;
  font-family: inherit;
}
.composer__textarea:focus {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgb(var(--v-theme-surface-bright));
}
.composer__textarea::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.9375rem;
}

.composer__tools {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.composer__hint {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-transform: uppercase;
}
.composer__send-btn {
  text-transform: none !important;
  letter-spacing: 0.01em !important;
  font-weight: 500 !important;
}

/* ========== Rich text · 通用渲染 ========== */
.chat-rich-text {
  line-height: 1.55;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-rich-text :deep(p) {
  margin: 0 0 0.5em;
}

.chat-rich-text :deep(p:last-child) {
  margin-bottom: 0;
}

.chat-rich-text :deep(ul),
.chat-rich-text :deep(ol) {
  margin: 0.35em 0 0.5em;
  padding-left: 1.35rem;
}

.chat-rich-text :deep(h1),
.chat-rich-text :deep(h2),
.chat-rich-text :deep(h3),
.chat-rich-text :deep(h4),
.chat-rich-text :deep(h5),
.chat-rich-text :deep(h6) {
  margin: 0.75em 0 0.35em;
  font-weight: 600;
  line-height: 1.25;
}

.chat-rich-text :deep(h1:first-child),
.chat-rich-text :deep(h2:first-child),
.chat-rich-text :deep(h3:first-child) {
  margin-top: 0;
}

.chat-rich-text :deep(pre) {
  margin: 0.5em 0;
  padding: 0.65em 0.85em;
  overflow: auto;
  border-radius: 0.5rem;
  background: rgba(var(--v-theme-surface-variant), 0.35);
  font-size: 0.9em;
}

.chat-rich-text :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background: rgba(var(--v-theme-surface-variant), 0.45);
}

.chat-rich-text :deep(pre code) {
  padding: 0;
  background: none;
  font-size: inherit;
}

.chat-rich-text :deep(blockquote) {
  margin: 0.5em 0;
  padding-left: 0.85em;
  border-left: 0.1875rem solid rgba(var(--v-theme-primary), 0.45);
  color: rgb(var(--v-theme-on-surface-variant));
}

.chat-rich-text :deep(a) {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
}

.chat-rich-text :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}

.chat-rich-text :deep(th),
.chat-rich-text :deep(td) {
  border: 0.0625rem solid rgb(var(--v-theme-surface-variant));
  padding: 0.35em 0.5em;
}

.chat-rich-text :deep(hr) {
  margin: 0.75em 0;
  border: none;
  border-top: 0.0625rem solid rgb(var(--v-theme-surface-variant));
}

.chat-rich-text :deep(.md-embedded-html) {
  margin: 0.5em 0;
  overflow: auto;
  max-width: 100%;
}

.chat-rich-text :deep(.md-embedded-html:first-child) {
  margin-top: 0;
}

.chat-rich-text :deep(.md-embedded-html:last-child) {
  margin-bottom: 0;
}

.prompt-json {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
  margin: 0;
  max-height: min(60vh, 28rem);
  overflow: auto;
}
</style>
