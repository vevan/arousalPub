import { translateApiError } from '@/utils/api-error-message'
import { formatChatMessagesForDisplay } from '@/utils/format-prompt-json-display'
import { computed, ref, type Ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'

export const MEMORY_VECTOR_INDEX_CORRUPT = 'memory_vector_index_corrupt'

export function useAssemblePreview(opts: {
  getConversationId: () => string
  userInput: Ref<string>
  getContextLength: () => number | null
  getModel: () => string
  t: ComposerTranslation
}) {
  const assemblePreviewOpen = ref(false)
  const assemblePreviewLoading = ref(false)
  const assemblePreviewError = ref('')
  const assemblePreviewErrorCode = ref('')
  const assemblePreviewMessages = ref<{ role: string; content: string }[]>([])
  const assemblePreviewFormattedJson = ref('')
  const assemblePreviewRawJson = ref('')
  const assemblePreviewMeta = ref({
    messages: 0,
    estimatedTokens: 0,
    droppedLoreCount: 0,
    droppedMemoryCount: 0,
    droppedHistoryCount: 0,
    memoryTurnIds: [] as string[],
  })
  const assemblePreviewCopied = ref(false)
  const assemblePreviewRawCopied = ref(false)

  const assemblePreviewMemoryCorrupt = computed(
    () => assemblePreviewErrorCode.value === MEMORY_VECTOR_INDEX_CORRUPT,
  )

  const canPreviewAssemble = computed(
    () =>
      !assemblePreviewLoading.value &&
      opts.getConversationId().trim().length > 0,
  )

  async function fetchAssemblePreview(): Promise<void> {
    assemblePreviewLoading.value = true
    assemblePreviewError.value = ''
    assemblePreviewErrorCode.value = ''
    assemblePreviewMessages.value = []
    assemblePreviewFormattedJson.value = ''
    assemblePreviewRawJson.value = ''
    assemblePreviewCopied.value = false
    assemblePreviewRawCopied.value = false
    assemblePreviewMeta.value = {
      messages: 0,
      estimatedTokens: 0,
      droppedLoreCount: 0,
      droppedMemoryCount: 0,
      droppedHistoryCount: 0,
      memoryTurnIds: [],
    }
    const id = opts.getConversationId().trim()
    try {
      const res = await fetch(
        `/api/chat/conversations/${id}/assemble-messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userText: opts.userInput.value.trim(),
            promptTrigger: 'normal',
            contextLength: opts.getContextLength() ?? undefined,
            model: opts.getModel().trim() || undefined,
          }),
        },
      )
      if (!res.ok) {
        let msg = opts.t('chat.previewAssembleLoadFailed')
        let code = ''
        try {
          const j = (await res.json()) as { error?: string; detail?: string }
          code = typeof j.error === 'string' ? j.error.trim() : ''
          if (code === MEMORY_VECTOR_INDEX_CORRUPT) {
            msg = translateApiError(code)
          } else {
            msg =
              (code ? translateApiError(code) : j.detail) || msg
          }
        } catch {
          const text = await res.text()
          if (text.trim()) msg = text.slice(0, 500)
        }
        assemblePreviewErrorCode.value = code
        assemblePreviewError.value = msg
        return
      }
      const data = (await res.json()) as {
        messages?: unknown[]
        estimatedTokens?: number
        droppedLoreCount?: number
        droppedMemoryCount?: number
        droppedHistoryCount?: number
        memoryTurnIds?: unknown[]
      }
      const messages = Array.isArray(data.messages) ? data.messages : []
      assemblePreviewMeta.value = {
        messages: messages.length,
        estimatedTokens:
          typeof data.estimatedTokens === 'number' ? data.estimatedTokens : 0,
        droppedLoreCount:
          typeof data.droppedLoreCount === 'number' ? data.droppedLoreCount : 0,
        droppedMemoryCount:
          typeof data.droppedMemoryCount === 'number'
            ? data.droppedMemoryCount
            : 0,
        droppedHistoryCount:
          typeof data.droppedHistoryCount === 'number'
            ? data.droppedHistoryCount
            : 0,
        memoryTurnIds: Array.isArray(data.memoryTurnIds)
          ? data.memoryTurnIds.filter((x): x is string => typeof x === 'string')
          : [],
      }
      assemblePreviewRawJson.value = JSON.stringify(messages, null, 2)
      assemblePreviewFormattedJson.value = formatChatMessagesForDisplay(
        messages as Parameters<typeof formatChatMessagesForDisplay>[0],
      )
      assemblePreviewMessages.value = messages
        .filter(
          (m): m is { role: string; content: string } =>
            !!m &&
            typeof m === 'object' &&
            typeof (m as { role?: unknown }).role === 'string' &&
            typeof (m as { content?: unknown }).content === 'string',
        )
        .map((m) => ({ role: m.role, content: m.content }))
    } catch {
      assemblePreviewError.value = opts.t('chat.previewAssembleLoadFailed')
    } finally {
      assemblePreviewLoading.value = false
    }
  }

  async function openAssemblePreview() {
    assemblePreviewOpen.value = true
    await fetchAssemblePreview()
  }

  function closeAssemblePreview() {
    assemblePreviewOpen.value = false
  }

  async function copyAssemblePreviewText(
    text: string,
    flag: { value: boolean },
  ): Promise<void> {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      flag.value = true
      setTimeout(() => {
        flag.value = false
      }, 1200)
    } catch {
      /* ignore */
    }
  }

  async function copyAssemblePreviewJson() {
    await copyAssemblePreviewText(
      assemblePreviewFormattedJson.value,
      assemblePreviewCopied,
    )
  }

  async function copyAssemblePreviewRaw() {
    await copyAssemblePreviewText(
      assemblePreviewRawJson.value,
      assemblePreviewRawCopied,
    )
  }

  return {
    assemblePreviewOpen,
    assemblePreviewLoading,
    assemblePreviewError,
    assemblePreviewErrorCode,
    assemblePreviewMemoryCorrupt,
    assemblePreviewMessages,
    assemblePreviewMeta,
    assemblePreviewCopied,
    assemblePreviewRawCopied,
    canPreviewAssemble,
    openAssemblePreview,
    closeAssemblePreview,
    copyAssemblePreviewJson,
    copyAssemblePreviewRaw,
  }
}
