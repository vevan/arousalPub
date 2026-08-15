import { coreNotify } from '@/utils/core-notify'
import { apiFetch } from '@/utils/api-fetch'
import { readJsonSseStream } from '@/utils/json-sse'
import {
  computed,
  inject,
  onScopeDispose,
  ref,
  type InjectionKey,
} from 'vue'
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
      hybridFtsSpec: string
      lorebooksReindexed: number
      lorebookEntriesIndexed: number
    }
  | { type: 'error'; ok: false; error: string; detail?: string }

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

type CancelKind = 'none' | 'superseded' | 'aborted'

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

  let abortController: AbortController | null = null
  /** Bumped on each new rebuild() and on abort(); identifies the active run. */
  let runId = 0
  /** Why the previous run lost ownership (supersede vs user abort). */
  let cancelKind: CancelKind = 'none'

  const percent = computed(() => {
    if (total.value < 1) return loading.value ? 0 : 100
    return Math.min(100, Math.round((done.value / total.value) * 100))
  })

  const stageLabel = computed(() =>
    t(`chatConversation.memoryRebuildStage.${stage.value}`),
  )

  function resetProgress(): void {
    done.value = 0
    total.value = 0
    turns.value = 0
    loreEntries.value = 0
    stage.value = 'planning'
    stageDone.value = 0
    stageTotal.value = 0
  }

  function abort(): void {
    const ac = abortController
    abortController = null
    cancelKind = 'aborted'
    runId += 1
    ac?.abort()
    loading.value = false
    error.value = ''
    resetProgress()
  }

  function notifySuccess(
    conversationId: string,
    snap: { done: number; turns: number; loreEntries: number },
  ): void {
    coreNotify(
      t('notifications.memoryRebuildSuccess'),
      t('notifications.memoryRebuildSuccessBody', {
        indexed: snap.done,
        turns: snap.turns,
        loreEntries: snap.loreEntries,
      }),
      {
        level: 'success',
        action: { type: 'conversation', conversationId },
        dedupeKey: `memory-rebuild:${conversationId}`,
      },
    )
  }

  async function rebuild(): Promise<{
    embeddingModel: string
    hybridFtsSpec: string
  } | null> {
    const id = getConversationId().trim()
    if (!id) return null

    // Supersede prior run (do not wipe UI via abort() — we reset below).
    abortController?.abort()
    cancelKind = 'superseded'
    const myId = (runId += 1)
    const ac = new AbortController()
    abortController = ac
    cancelKind = 'none'

    loading.value = true
    error.value = ''
    resetProgress()

    let finished = false
    let result: { embeddingModel: string; hybridFtsSpec: string } | null = null
    let snap = { done: 0, turns: 0, loreEntries: 0 }

    const stillMine = () => runId === myId

    try {
      const res = await apiFetch(
        `/api/chat/conversations/${id}/memory/rebuild?stream=1`,
        { method: 'POST', signal: ac.signal },
      )
      if (!stillMine()) {
        return preferSuccessIfDone()
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string
          detail?: string
        }
        if (!stillMine()) return preferSuccessIfDone()
        error.value = j.error ?? t('chatConversation.memoryRebuildFailed')
        if (j.detail) error.value += `: ${j.detail}`
        return null
      }

      await readJsonSseStream<MemoryRebuildSseEvent>(res.body, (ev) => {
        if (!stillMine()) return
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
          const embeddingModel =
            typeof ev.embeddingModel === 'string' ? ev.embeddingModel.trim() : ''
          const hybridFtsSpec =
            typeof ev.hybridFtsSpec === 'string' ? ev.hybridFtsSpec.trim() : ''
          result = embeddingModel && hybridFtsSpec
            ? { embeddingModel, hybridFtsSpec }
            : null
          snap = {
            done: done.value,
            turns: turns.value,
            loreEntries: loreEntries.value,
          }
        }
      })

      if (!stillMine()) {
        return preferSuccessIfDone()
      }

      if (ac.signal.aborted && !(finished && result)) {
        return null
      }

      if (finished && !result) {
        error.value = t('chatConversation.memoryRebuildFailed')
      } else if (!finished && !error.value) {
        error.value = t('chatConversation.memoryRebuildFailed')
      }
    } catch (e) {
      if (!stillMine()) {
        return preferSuccessIfDone()
      }
      if (isAbortError(e) || ac.signal.aborted) {
        if (!(finished && result)) return null
      } else {
        error.value =
          e instanceof Error
            ? e.message
            : t('chatConversation.memoryRebuildFailed')
      }
    } finally {
      if (stillMine() && abortController === ac) {
        abortController = null
        loading.value = false
      }
    }

    if (!stillMine()) {
      return preferSuccessIfDone()
    }

    if (finished && result) {
      notifySuccess(id, snap)
      // Conversation may have switched; only return authoritative index identity
      // when the view is still on this conversation.
      if (getConversationId().trim() !== id) return null
      return result
    }
    if (error.value) {
      coreNotify(t('notifications.memoryRebuildFailedTitle'), error.value, {
        level: 'error',
        dedupeKey: `memory-rebuild:${id}:error`,
      })
    }
    return result

    function preferSuccessIfDone(): {
      embeddingModel: string
      hybridFtsSpec: string
    } | null {
      // User abort after server `done`: toast + return model if still on same conv.
      // Superseded by a newer rebuild(): stay silent (new run owns UI).
      if (!(finished && result) || cancelKind !== 'aborted') return null
      notifySuccess(id, snap)
      if (getConversationId().trim() !== id) return null
      return result
    }
  }

  onScopeDispose(() => {
    abort()
  })

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
    abort,
  }
}

export type MemoryRebuildApi = ReturnType<typeof useMemoryRebuild>

/** Provided by ChatConversationView so settings + offer share one rebuild session. */
export const MEMORY_REBUILD_INJECT_KEY: InjectionKey<MemoryRebuildApi> =
  Symbol('memoryRebuild')

/** Require the shared instance provided by ChatConversationView. */
export function useInjectedMemoryRebuild(): MemoryRebuildApi {
  const api = inject(MEMORY_REBUILD_INJECT_KEY, null)
  if (!api) {
    throw new Error(
      'MEMORY_REBUILD_INJECT_KEY missing: provide useMemoryRebuild in ChatConversationView',
    )
  }
  return api
}
