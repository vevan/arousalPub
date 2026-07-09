import { coreNotify } from '@/utils/core-notify'
import { readJsonSseStream } from '@/utils/json-sse'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type MemoryRebuildStage =
  | 'planning'
  | 'collecting_turns'
  | 'embedding_turns'
  | 'writing_turns'
  | 'embedding_lorebooks'
  | 'finalizing'

export type MemoryRebuildSseEvent =
  | { type: 'start'; turns: number; loreEntries: number; total: number }
  | {
      type: 'progress'
      done: number
      total: number
      stage?: MemoryRebuildStage
      stageDone?: number
      stageTotal?: number
    }
  | {
      type: 'done'
      ok: true
      indexed: number
      embeddingModel: string
      lorebooksReindexed: number
      lorebookEntriesIndexed: number
    }
  | { type: 'error'; ok: false; error: string; detail?: string }

export function useMemoryRebuild(getConversationId: () => string) {
  const { t } = useI18n()

  const loading = ref(false)
  const error = ref('')
  const done = ref(0)
  const total = ref(0)
  const turns = ref(0)
  const loreEntries = ref(0)
  const stage = ref<MemoryRebuildStage>('planning')
  const stageDone = ref(0)
  const stageTotal = ref(0)

  const percent = computed(() => {
    if (total.value < 1) return loading.value ? 0 : 100
    return Math.min(100, Math.round((done.value / total.value) * 100))
  })

  const stageLabel = computed(() =>
    t(`chatConversation.memoryRebuildStage.${stage.value}`),
  )

  async function rebuild(): Promise<string | null> {
    const id = getConversationId().trim()
    if (!id) return null

    loading.value = true
    error.value = ''
    done.value = 0
    total.value = 0
    turns.value = 0
    loreEntries.value = 0
    stage.value = 'planning'
    stageDone.value = 0
    stageTotal.value = 0
    let finished = false
    let nextModel: string | null = null

    try {
      const res = await fetch(
        `/api/chat/conversations/${id}/memory/rebuild?stream=1`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string
          detail?: string
        }
        error.value = j.error ?? t('chatConversation.memoryRebuildFailed')
        if (j.detail) error.value += `: ${j.detail}`
        return null
      }

      await readJsonSseStream<MemoryRebuildSseEvent>(res.body, (ev) => {
        if (ev.type === 'start') {
          total.value = ev.total
          turns.value = ev.turns
          loreEntries.value = ev.loreEntries
          done.value = 0
          stage.value = 'planning'
          return
        }
        if (ev.type === 'progress') {
          done.value = ev.done
          total.value = ev.total
          if (ev.stage) stage.value = ev.stage
          stageDone.value = ev.stageDone ?? 0
          stageTotal.value = ev.stageTotal ?? 0
          return
        }
        if (ev.type === 'error') {
          error.value = ev.error ?? t('chatConversation.memoryRebuildFailed')
          if (ev.detail) error.value += `: ${ev.detail}`
          return
        }
        if (ev.type === 'done') {
          finished = true
          done.value = total.value
          stage.value = 'finalizing'
          stageDone.value = total.value
          stageTotal.value = total.value
          nextModel =
            typeof ev.embeddingModel === 'string' && ev.embeddingModel.trim()
              ? ev.embeddingModel.trim()
              : null
        }
      })

      if (!finished && !error.value) {
        error.value = t('chatConversation.memoryRebuildFailed')
      }
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : t('chatConversation.memoryRebuildFailed')
    } finally {
      loading.value = false
    }

    if (finished && nextModel) {
      coreNotify(
        t('notifications.memoryRebuildSuccess'),
        t('notifications.memoryRebuildSuccessBody', {
          indexed: done.value,
          turns: turns.value,
          loreEntries: loreEntries.value,
        }),
        {
          level: 'success',
          persist: true,
          action: { type: 'conversation', conversationId: id },
          dedupeKey: `memory-rebuild:${id}`,
        },
      )
    } else if (error.value) {
      coreNotify(t('notifications.memoryRebuildFailedTitle'), error.value, {
        level: 'error',
        persist: true,
        dedupeKey: `memory-rebuild:${id}:error`,
      })
    }

    return nextModel
  }

  return {
    loading,
    error,
    done,
    total,
    turns,
    loreEntries,
    stage,
    stageDone,
    stageTotal,
    stageLabel,
    percent,
    rebuild,
  }
}
