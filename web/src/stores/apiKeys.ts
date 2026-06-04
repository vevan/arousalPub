import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { translateApiError } from '@/utils/api-error-message'

export interface ApiKeyEntryPublic {
  id: string
  alias: string
  createdAt: string
  updatedAt: string
  keyConfigured: boolean
}

interface ApiKeyEntryLocal extends ApiKeyEntryPublic {
  /** 本地草稿；undefined 表示 PUT 时不发送 key（保留服务端） */
  keyDraft?: string
}

interface ApiKeysDocumentPublic {
  version: 1
  savedAt: string
  keys: ApiKeyEntryPublic[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `key-${crypto.randomUUID()}`
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeEntry(o: unknown): ApiKeyEntryLocal | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const e = o as Partial<ApiKeyEntryPublic & { key?: string }>
  if (typeof e.id !== 'string' || !e.id) return null
  return {
    id: e.id,
    alias: typeof e.alias === 'string' ? e.alias : '',
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : nowIso(),
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : nowIso(),
    keyConfigured: Boolean(e.keyConfigured),
  }
}

function toPutPayload(entry: ApiKeyEntryLocal): {
  id: string
  alias: string
  key?: string
} {
  const base = { id: entry.id, alias: entry.alias }
  if (entry.keyDraft !== undefined) {
    return { ...base, key: entry.keyDraft }
  }
  return base
}

export const useApiKeysStore = defineStore('apiKeys', () => {
  const keys = ref<ApiKeyEntryLocal[]>([])

  const loaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  /** 仅用户/显式 mutator 改动后为 true；避免 load / flush 后误触发 PUT */
  const keysDirty = ref(false)

  function scheduleSave() {
    if (!loaded.value || !keysDirty.value) return
    if (saveTimer) clearTimeout(saveTimer)
    pending = true
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, 600)
  }

  async function flushSave(): Promise<void> {
    if (!pending && !keysDirty.value) return
    pending = false
    saving.value = true
    lastError.value = null
    try {
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keys.value.map(toPutPayload) }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`PUT /api/api-keys ${res.status}: ${txt.slice(0, 200)}`)
      }
      const j = (await res.json()) as { savedAt?: string }
      if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
      keysDirty.value = false
      const hasDraft = keys.value.some((k) => k.keyDraft !== undefined)
      if (hasDraft) {
        keys.value = keys.value.map((k) => {
          if (k.keyDraft === undefined) return k
          const next = { ...k }
          next.keyConfigured = next.keyDraft!.trim().length > 0
          delete next.keyDraft
          return next
        })
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      pending = true
    } finally {
      saving.value = false
    }
  }

  let loadInflight: Promise<void> | null = null

  async function loadFromServer(): Promise<void> {
    if (loaded.value) return
    if (loadInflight) return loadInflight
    loadInflight = (async () => {
      if (loaded.value) return
      loading.value = true
      lastError.value = null
      try {
        const res = await fetch('/api/api-keys')
        if (!res.ok) {
          if (res.status === 500) throw new Error(`GET /api/api-keys ${res.status}`)
          loaded.value = true
          return
        }
        const raw: unknown = await res.json()
        if (raw === null) {
          loaded.value = true
          return
        }
        if (typeof raw !== 'object' || raw === null) {
          loaded.value = true
          return
        }
        const doc = raw as Partial<ApiKeysDocumentPublic>
        if (doc.version !== 1 || !Array.isArray(doc.keys)) {
          loaded.value = true
          return
        }
        const list: ApiKeyEntryLocal[] = []
        for (const o of doc.keys) {
          const n = normalizeEntry(o)
          if (n) list.push(n)
        }
        keys.value = list
        keysDirty.value = false
        if (typeof doc.savedAt === 'string') lastSavedAt.value = doc.savedAt
        loaded.value = true
      } catch (e) {
        lastError.value = e instanceof Error ? e.message : String(e)
      } finally {
        loading.value = false
      }
    })().finally(() => {
      loadInflight = null
    })
    return loadInflight
  }

  function findById(id: string | null | undefined): ApiKeyEntryLocal | undefined {
    if (!id) return undefined
    return keys.value.find((k) => k.id === id)
  }

  const selectItems = computed(() =>
    keys.value.map((k) => ({
      value: k.id,
      title: k.alias.trim() || '(未命名)',
    })),
  )

  function nextDefaultAlias(): string {
    const taken = new Set(keys.value.map((k) => k.alias.trim()))
    for (let i = 1; i < 999; i++) {
      const c = `Key ${i}`
      if (!taken.has(c)) return c
    }
    return `Key-${Date.now()}`
  }

  function createKey(partial?: Partial<Pick<ApiKeyEntryLocal, 'alias' | 'keyDraft'>>): ApiKeyEntryLocal {
    const t = nowIso()
    const keyDraft = typeof partial?.keyDraft === 'string' ? partial.keyDraft : ''
    const entry: ApiKeyEntryLocal = {
      id: makeId(),
      alias:
        typeof partial?.alias === 'string' && partial.alias.trim()
          ? partial.alias.trim()
          : nextDefaultAlias(),
      keyConfigured: keyDraft.trim().length > 0,
      keyDraft,
      createdAt: t,
      updatedAt: t,
    }
    keys.value = [...keys.value, entry]
    keysDirty.value = true
    scheduleSave()
    return entry
  }

  function updateKey(
    id: string,
    patch: Partial<Pick<ApiKeyEntryLocal, 'alias' | 'keyDraft'>>,
  ): void {
    const idx = keys.value.findIndex((k) => k.id === id)
    if (idx < 0) return
    const cur = keys.value[idx]
    const alias =
      typeof patch.alias === 'string' ? patch.alias.trim() : cur.alias
    const hasKeyDraft = Object.prototype.hasOwnProperty.call(patch, 'keyDraft')
    const keyDraft = hasKeyDraft ? patch.keyDraft : cur.keyDraft
    if (alias === cur.alias && keyDraft === cur.keyDraft) return
    const next = keys.value.slice()
    next[idx] = {
      ...cur,
      alias,
      ...(hasKeyDraft ? { keyDraft: patch.keyDraft } : {}),
      updatedAt: nowIso(),
    }
    keys.value = next
    keysDirty.value = true
    scheduleSave()
  }

  function deleteKey(id: string): void {
    keys.value = keys.value.filter((k) => k.id !== id)
    keysDirty.value = true
    scheduleSave()
  }

  async function revealKey(id: string, password: string): Promise<string> {
    const res = await fetch(`/api/api-keys/${encodeURIComponent(id)}/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const j = (await res.json()) as { key?: string; error?: string }
    if (!res.ok || typeof j.key !== 'string') {
      const code = typeof j.error === 'string' ? j.error : 'api_key_reveal_failed'
      throw new Error(translateApiError(code))
    }
    return j.key
  }

  return {
    keys,
    loaded,
    loading,
    saving,
    lastSavedAt,
    lastError,
    selectItems,
    loadFromServer,
    flushSave,
    findById,
    createKey,
    updateKey,
    deleteKey,
    revealKey,
  }
})

export type ApiKeyEntry = ApiKeyEntryLocal
