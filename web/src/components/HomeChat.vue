<script setup lang="ts">
import {
  renderReasoningMarkdownToHtml,
  renderRichMessageToHtml,
} from '@/utils/render-rich-message'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  conversationId: string
}>()

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

onMounted(() => {
  void scrollChatToBottom()
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

const streamingTurnLabelN = computed(() => nextTurnOrdinal0() + 1)

function assistantText(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  return r?.content ?? ''
}

function assistantReasoning(turn: ChatTurnItem): string {
  const r = turn.receives[turn.activeReceiveIndex]
  const s = r?.reasoning
  return typeof s === 'string' ? s : ''
}

/** 与上游 chat/completions 对齐的多轮消息（仅正文，不含思维链） */
type DialogMessage = { role: 'user' | 'assistant'; content: string }

function orderedTurns(history: ChatTurnItem[]): ChatTurnItem[] {
  return [...history].sort((a, b) => a.turnOrdinal - b.turnOrdinal)
}

function turnsToDialogMessages(history: ChatTurnItem[]): DialogMessage[] {
  const out: DialogMessage[] = []
  for (const turn of orderedTurns(history)) {
    const u = turn.user.trim()
    if (u.length > 0) {
      out.push({ role: 'user', content: turn.user })
    }
    if (turn.receives.length > 0) {
      const assistant = assistantText(turn)
      if (assistant.length > 0) {
        out.push({ role: 'assistant', content: assistant })
      }
    }
  }
  return out
}

/** 当前输入作为最新一条 user（尚未写入 turns） */
function messagesForSend(userText: string): DialogMessage[] {
  return [...turnsToDialogMessages(turns.value), { role: 'user', content: userText }]
}

/** 再生某轮：仅含此前对话 + 该轮 user，不含该轮旧 assistant */
function messagesForRegenerateAt(listIndex: number): DialogMessage[] {
  const turn = turns.value[listIndex]
  if (!turn) return []
  const head = turns.value.slice(0, listIndex)
  return [...turnsToDialogMessages(head), { role: 'user', content: turn.user }]
}

function replaceTurnAt(listIndex: number, next: ChatTurnItem) {
  turns.value = turns.value.map((t, i) => (i === listIndex ? next : t))
}

async function persistTurnToServer(
  turn: ChatTurnItem,
  debugPrompt?: DialogMessage[],
): Promise<boolean> {
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
          ...(debugPrompt !== undefined ? { debugPrompt } : {}),
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
    streamingText.value = ''
    streamingReasoning.value = ''
    errorText.value = ''
    editingTurnOrdinal.value = null
    editingSide.value = null
    deleteTarget.value = null
    void loadMessages()
  },
  { immediate: true },
)

function buildRequestBody(messages: DialogMessage[]) {
  let customParams: Record<string, unknown> | undefined
  if (conn.customParamsJson.trim()) {
    customParams = conn.parseCustomParams()
  }

  return {
    alias: conn.alias.trim() || undefined,
    baseUrl: conn.baseUrl.trim() || undefined,
    apiKey: conn.apiKey.trim(),
    model: conn.model.trim(),
    messages,
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

async function persistFirstTurnIfNeeded(
  userText: string,
  assistantText: string,
  assistantReasoning: string | undefined,
  debugPrompt: DialogMessage[],
) {
  try {
    const res = await fetch(
      `/api/chat/conversations/${props.conversationId}/first-turn`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userContent: userText,
          assistantContent: assistantText,
          assistantReasoning:
            assistantReasoning?.trim() ? assistantReasoning.trim() : undefined,
          model: conn.model.trim() || undefined,
          ...(writeChatPromptSnapshot.value ? { debugPrompt } : {}),
        }),
      },
    )
    if (!res.ok && res.status !== 409) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text) as { error?: string }
        msg = j.error || text
      } catch {
        /* not JSON */
      }
      errorText.value =
        msg.slice(0, 500) || t('chat.errors.persistFirstTurnFailed')
    }
  } catch {
    errorText.value = t('chat.errors.persistFirstTurnFailed')
  }
}

async function persistAppendTurn(
  turn: ChatTurnItem,
  debugPrompt: DialogMessage[],
): Promise<void> {
  try {
    const res = await fetch(
      `/api/chat/conversations/${props.conversationId}/append-turn`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: turn.user,
          receives: turn.receives.map((r) => ({
            id: r.id,
            content: r.content,
            ...(r.reasoning?.trim() ? { reasoning: r.reasoning.trim() } : {}),
          })),
          activeReceiveIndex: turn.activeReceiveIndex,
          model: conn.model.trim() || undefined,
          ...(writeChatPromptSnapshot.value ? { debugPrompt } : {}),
        }),
      },
    )
    if (!res.ok) {
      const text = await res.text()
      let msg = text
      try {
        const j = JSON.parse(text) as { error?: string }
        msg = j.error || text
      } catch {
        /* not JSON */
      }
      errorText.value =
        msg.slice(0, 500) || t('chat.errors.persistAppendTurnFailed')
    }
  } catch {
    errorText.value = t('chat.errors.persistAppendTurnFailed')
  }
}

async function runChatRequest(
  messages: DialogMessage[],
): Promise<{ content: string; reasoning?: string }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(messages)),
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
  }
  const msg = data.message
  const content = typeof msg?.content === 'string' ? msg.content : ''
  const rawR = msg?.reasoning ?? msg?.reasoning_content
  const reasoning =
    typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
  return { content, reasoning }
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || !e.ctrlKey) return
  e.preventDefault()
  if (canSend.value) void send()
}

async function send() {
  errorText.value = ''
  streamingText.value = ''
  streamingReasoning.value = ''
  const userText = userInput.value.trim()
  loading.value = true
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

    const priorLen = turns.value.length
    const ord = nextTurnOrdinal0()
    const debugPrompt = messagesForSend(userText)

    if (conn.stream) {
      streamingText.value = ''
      streamingReasoning.value = ''
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(messagesForSend(userText))),
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
        }
        assistantOut = data.message?.content ?? ''
        const rawR = data.message?.reasoning ?? data.message?.reasoning_content
        reasoningOut =
          typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
      }
      streamingText.value = ''
      streamingReasoning.value = ''
      const recId = crypto.randomUUID()
      const receive: ReceiveItem = {
        id: recId,
        content: assistantOut,
        ...(reasoningOut ? { reasoning: reasoningOut } : {}),
      }
      const newTurn: ChatTurnItem = {
        user: userText,
        receives: [receive],
        activeReceiveIndex: 0,
        turnOrdinal: ord,
      }
      turns.value = [...turns.value, newTurn]
      userInput.value = ''
      if (assistantOut.trim()) {
        if (priorLen === 0) {
          await persistFirstTurnIfNeeded(
            userText,
            assistantOut,
            reasoningOut,
            debugPrompt,
          )
          await loadMessages()
        } else {
          await persistAppendTurn(newTurn, debugPrompt)
        }
      }
      return
    }

    const { content: assistantOut, reasoning: reasoningOut } =
      await runChatRequest(debugPrompt)
    const receive: ReceiveItem = {
      id: crypto.randomUUID(),
      content: assistantOut,
      ...(reasoningOut ? { reasoning: reasoningOut } : {}),
    }
    const newTurn: ChatTurnItem = {
      user: userText,
      receives: [receive],
      activeReceiveIndex: 0,
      turnOrdinal: ord,
    }
    turns.value = [...turns.value, newTurn]
    userInput.value = ''

    if (assistantOut.trim()) {
      if (priorLen === 0) {
        await persistFirstTurnIfNeeded(
          userText,
          assistantOut,
          reasoningOut,
          debugPrompt,
        )
        await loadMessages()
      } else {
        await persistAppendTurn(newTurn, debugPrompt)
      }
    }
  } catch (e) {
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
    void regenerateAssistant(listIndex)
    return
  }
  const next = { ...turn, activeReceiveIndex: a + 1 }
  replaceTurnAt(listIndex, next)
  void persistTurnToServer(next)
}

async function regenerateAssistant(listIndex: number) {
  const turn = turns.value[listIndex]
  if (!turn || !turn.user.trim()) return
  if (regeneratingTurnOrdinal.value !== null) return
  regeneratingTurnOrdinal.value = turn.turnOrdinal
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

    const regenMessagesSnapshot = messagesForRegenerateAt(listIndex)

    let assistantOut = ''
    let reasoningOut: string | undefined
    if (conn.stream) {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(regenMessagesSnapshot)),
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
        let acc = ''
        let accR = ''
        await readSseStream(res.body, (d) => {
          if (d.text) acc += d.text
          if (d.reasoning) accR += d.reasoning
        })
        assistantOut = acc
        reasoningOut = accR.trim() || undefined
      } else {
        const data = (await res.json()) as {
          message?: { content?: string; reasoning?: string; reasoning_content?: string }
        }
        assistantOut = data.message?.content ?? ''
        const rawR = data.message?.reasoning ?? data.message?.reasoning_content
        reasoningOut =
          typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
      }
    } else {
      const r = await runChatRequest(regenMessagesSnapshot)
      assistantOut = r.content
      reasoningOut = r.reasoning
    }

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
    const ok = await persistTurnToServer(
      next,
      writeChatPromptSnapshot.value ? regenMessagesSnapshot : undefined,
    )
    if (!ok) {
      /* 仅本地会话或未落盘轮次 */
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : t('chat.errors.network')
  } finally {
    regeneratingTurnOrdinal.value = null
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
  if (streamingText.value) return false
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
          <div class="turn-index text-caption text-medium-emphasis">
            {{ $t('chat.turnLabel', { n: turnLabelN(turn, i) }) }}
          </div>
          <div class="d-flex justify-end w-100">
            <div class="turn-card turn-card--user">
              <div class="turn-card__header d-flex align-center justify-end flex-wrap gap-x-1 gap-y-1">
                <span class="toolbar-role toolbar-role--user text-subtitle-2 font-weight-medium">
                  {{ $t('chat.user') }}
                </span>
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-pencil-outline"
                  :disabled="regeneratingTurnOrdinal !== null"
                  @click="openEditUser(turn)"
                >
                  {{ $t('chat.edit') }}
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-delete-outline"
                  color="error"
                  :disabled="regeneratingTurnOrdinal !== null"
                  @click="requestDeleteWholeTurnFromUser(i)"
                >
                  {{ $t('chat.delete') }}
                </v-btn>
              </div>
              <div class="turn-card__body turn-card__body--user text-body-2">
                <template v-if="editingTurnOrdinal === turn.turnOrdinal && editingSide === 'user'">
                  <v-textarea
                    v-model="editDraft"
                    rows="4"
                    auto-grow
                    max-rows="16"
                    variant="outlined"
                    density="compact"
                    hide-details="auto"
                    class="mb-2"
                  />
                  <div class="d-flex gap-2">
                    <v-btn
                      size="small"
                      variant="text"
                      @click="cancelEdit"
                    >
                      {{ $t('settings.themeCancel') }}
                    </v-btn>
                    <v-btn
                      size="small"
                      color="primary"
                      variant="flat"
                      @click="saveEdit(i)"
                    >
                      {{ $t('settings.themeConfirm') }}
                    </v-btn>
                  </div>
                </template>
                <div
                  v-else
                  class="chat-rich-text"
                  v-html="renderRichMessageToHtml(turn.user)"
                ></div>
              </div>
            </div>
          </div>

          <div class="d-flex justify-start assistant-stack">
            <div class="assistant-column">
              <div class="turn-card turn-card--assistant">
                <div class="turn-card__header d-flex align-center flex-wrap gap-x-1 gap-y-1">
                  <span class="toolbar-role toolbar-role--assistant text-subtitle-2 font-weight-medium">
                    {{ $t('chat.assistant') }}
                  </span>
                  <v-btn
                    v-if="writeChatPromptSnapshot"
                    size="small"
                    variant="text"
                    prepend-icon="mdi-text-box-search-outline"
                    :disabled="regeneratingTurnOrdinal !== null"
                    @click="openTurnPromptSnapshot(turn)"
                  >
                    {{ $t('chat.viewTurnPrompt') }}
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-pencil-outline"
                    :disabled="regeneratingTurnOrdinal !== null"
                    @click="openEditAssistant(turn)"
                  >
                    {{ $t('chat.edit') }}
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-delete-outline"
                    color="error"
                    :disabled="regeneratingTurnOrdinal !== null"
                    @click="requestDelete(i)"
                  >
                    {{ $t('chat.delete') }}
                  </v-btn>
                  <div
                    class="turn-card__plugins flex-grow-1 d-flex flex-wrap gap-1 justify-end align-center"
                    data-plugin-slot="assistant-turn-toolbar"
                  />
                </div>

                <div
                  class="turn-card__body turn-card__body--assistant position-relative text-body-2"
                  :class="{ 'turn-card__body--busy': regeneratingTurnOrdinal === turn.turnOrdinal }"
                >
                  <template v-if="editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant'">
                    <v-textarea
                      v-model="editDraft"
                      rows="4"
                      auto-grow
                      max-rows="16"
                      variant="outlined"
                      density="compact"
                      hide-details="auto"
                      class="mb-2"
                    />
                    <div class="d-flex gap-2">
                      <v-btn
                        size="small"
                        variant="text"
                        @click="cancelEdit"
                      >
                        {{ $t('settings.themeCancel') }}
                      </v-btn>
                      <v-btn
                        size="small"
                        color="primary"
                        variant="flat"
                        @click="saveEdit(i)"
                      >
                        {{ $t('settings.themeConfirm') }}
                      </v-btn>
                    </div>
                  </template>
                  <template v-else>
                    <details
                      v-if="conn.showReasoningChain && assistantReasoning(turn).length > 0"
                      class="reasoning-chain mb-2"
                    >
                      <summary class="reasoning-chain__summary text-caption text-medium-emphasis">
                        {{ $t('chat.reasoningSummary') }}
                      </summary>
                      <div
                        class="reasoning-chain__body text-body-2 chat-rich-text"
                        v-html="renderReasoningMarkdownToHtml(assistantReasoning(turn))"
                      />
                    </details>
                    <div
                      class="chat-rich-text"
                      v-html="renderRichMessageToHtml(assistantText(turn))"
                    />
                  </template>

                  <v-overlay
                    v-if="regeneratingTurnOrdinal === turn.turnOrdinal"
                    contained
                    class="assistant-regen-overlay align-center justify-center"
                    scrim="rgba(0,0,0,0.25)"
                  >
                    <v-progress-circular indeterminate size="28" width="2" />
                  </v-overlay>
                </div>

                <div
                  v-if="showAssistantSwipeFooter(turn, i)"
                  class="turn-card__footer assistant-swipe-footer d-flex justify-end align-center"
                  :aria-label="
                    $t('chat.swipePosition', {
                      current: turn.activeReceiveIndex + 1,
                      total: turn.receives.length,
                    })
                  "
                >
                  <div class="assistant-nav d-flex align-center">
                    <v-btn
                      icon
                      size="x-small"
                      variant="tonal"
                      density="compact"
                      :aria-label="$t('chat.prevAssistant')"
                      :disabled="regeneratingTurnOrdinal !== null"
                      @click="slideAssistant(i, 'left')"
                    >
                      <v-icon size="18">
                        mdi-chevron-left
                      </v-icon>
                    </v-btn>
                    <span class="assistant-nav__count text-caption text-medium-emphasis tabular-nums">
                      {{ turn.activeReceiveIndex + 1 }}/{{ turn.receives.length }}
                    </span>
                    <v-btn
                      icon
                      size="x-small"
                      variant="tonal"
                      density="compact"
                      :aria-label="$t('chat.nextAssistant')"
                      :disabled="regeneratingTurnOrdinal !== null"
                      @click="slideAssistant(i, 'right')"
                    >
                      <v-icon size="18">
                        mdi-chevron-right
                      </v-icon>
                    </v-btn>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div
        v-if="streamingText"
        class="turn-block"
      >
        <div class="turn-index text-caption text-medium-emphasis">
          {{ $t('chat.turnLabel', { n: streamingTurnLabelN }) }}
        </div>
        <div class="d-flex justify-start assistant-stack">
          <div class="assistant-column">
            <div class="turn-card turn-card--assistant">
              <div class="turn-card__header d-flex align-center flex-wrap gap-1">
                <span class="toolbar-role toolbar-role--assistant text-subtitle-2 font-weight-medium">
                  {{ $t('chat.assistant') }}
                  <span class="text-disabled text-body-2 font-weight-regular">
                    {{ $t('chat.streamingSuffix') }}
                  </span>
                </span>
              </div>
              <div class="turn-card__body turn-card__body--assistant turn-card__body--streaming text-body-2">
                <details
                  v-if="conn.showReasoningChain && streamingReasoning"
                  class="reasoning-chain mb-2"
                >
                  <summary class="reasoning-chain__summary text-caption text-medium-emphasis">
                    {{ $t('chat.reasoningSummary') }}
                  </summary>
                  <div
                    class="reasoning-chain__body text-body-2 chat-rich-text"
                    v-html="renderReasoningMarkdownToHtml(streamingReasoning)"
                  />
                </details>
                <div
                  class="chat-rich-text"
                  v-html="renderRichMessageToHtml(streamingText)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="!turns.length && !streamingText && !errorText"
        class="text-body-2 text-medium-emphasis"
      >
        {{ $t('chat.emptyHint') }}
      </div>
  </div>

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
      <v-textarea
        v-model="userInput"
        :label="$t('chat.messageLabel')"
        rows="3"
        auto-grow
        max-rows="12"
        variant="outlined"
        class="mb-3"
        hide-details="auto"
        @keydown="onComposerKeydown"
      />
      <div
        class="chat-footer__tools d-flex flex-wrap align-center gap-2"
        data-plugin-slot="composer-toolbar"
      >
        <v-btn
          color="primary"
          :loading="loading"
          :disabled="!canSend"
          @click="send"
        >
          {{ $t('chat.send') }}
        </v-btn>
      </div>
    </div>
  </div>

  <v-dialog
    v-model="deleteDialogOpen"
    max-width="24rem"
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
    max-width="720"
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
/* 中性灰滑块；WebKit 悬停时用主题 primary（Firefox 的 scrollbar-color 无 hover，保持中性灰） */
.chat-body {
  --chat-scrollbar-neutral: rgba(128, 128, 136, 0.42);
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--chat-scrollbar-neutral) transparent;
}

.chat-body::-webkit-scrollbar {
  width: 10px;
}

.chat-body::-webkit-scrollbar-track {
  background: transparent;
  margin-block: 0.25rem;
}

.chat-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
  background-color: var(--chat-scrollbar-neutral);
}

.chat-body::-webkit-scrollbar-thumb:hover {
  background-color: rgb(var(--v-theme-primary));
}

.chat-footer {
  padding-top: 0.5rem;
  padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid rgb(var(--v-theme-surface-variant));
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.06);
}

.chat-footer__inner {
  width: 100%;
}

.min-height-0 {
  min-height: 0;
}

.chat-scroll {
  padding-inline: 0.5rem;
}

.turn-block {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  margin-bottom: 1.25rem;
}

.turn-index {
  text-align: center;
  letter-spacing: 0.02em;
}

.assistant-stack {
  width: 100%;
}

.assistant-column {
  width: min(88%, 36rem);
  max-width: 100%;
}

.turn-card {
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
  overflow: visible;
}

.turn-card--user {
  width: min(88%, 36rem);
  max-width: 100%;
}

.turn-card--assistant {
  width: 100%;
}

.turn-card__header {
  padding: 0.5rem 0.75rem 0.25rem;
  background: transparent;
  border: none;
}

.turn-card__body {
  padding: 0.75rem 1rem;
  line-height: 1.55;
  /* 主题未提供 outline 时 rgba(var(--v-theme-outline),…) 整句无效，边框会消失 */
  border: 1px solid rgb(var(--v-theme-surface-variant));
  border-radius: 0.75rem;
  background: transparent;
}

.turn-card__body--user {
  text-align: start;
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-theme-primary), 0.55);
}

.turn-card__body--assistant {
  text-align: start;
  color: rgb(var(--v-theme-on-surface));
  min-height: 2.5rem;
}

.turn-card__body--streaming {
  border-style: dashed;
}

.turn-card__body--busy {
  min-height: 4rem;
}

.turn-card__footer {
  padding: 0.35rem 0.25rem 0;
  background: transparent;
  border: none;
}

.assistant-swipe-footer {
  min-height: 2.25rem;
}

.toolbar-role--user {
  color: rgb(var(--v-theme-primary));
}

.toolbar-role--assistant {
  color: rgb(var(--v-theme-primary));
}

.assistant-nav {
  column-gap: 0.125rem;
}

.assistant-nav__count {
  min-width: 2.25rem;
  text-align: center;
  user-select: none;
  line-height: 1;
}

.assistant-regen-overlay {
  border-radius: 0.75rem;
}

.reasoning-chain {
  border: 1px solid rgb(var(--v-theme-surface-variant));
  border-radius: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: rgba(var(--v-theme-surface-variant), 0.15);
}

.reasoning-chain__summary {
  cursor: pointer;
  user-select: none;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
}

.reasoning-chain__body {
  margin: 0.35rem 0 0;
  /* 不在此再限高，避免长思维链/内嵌 HTML 被误截断；整页由 .chat-body 滚动 */
  min-width: 0;
}

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
  border-left: 3px solid rgba(var(--v-theme-primary), 0.45);
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
  border: 1px solid rgb(var(--v-theme-surface-variant));
  padding: 0.35em 0.5em;
}

.chat-rich-text :deep(hr) {
  margin: 0.75em 0;
  border: none;
  border-top: 1px solid rgb(var(--v-theme-surface-variant));
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
