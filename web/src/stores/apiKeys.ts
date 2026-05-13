import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export interface ApiKeyEntry {
  id: string
  alias: string
  key: string
  createdAt: string
  updatedAt: string
}

interface ApiKeysDocument {
  version: 1
  savedAt: string
  keys: ApiKeyEntry[]
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

function normalizeEntry(o: unknown): ApiKeyEntry | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const e = o as Partial<ApiKeyEntry>
  if (typeof e.id !== 'string' || !e.id) return null
  if (typeof e.key !== 'string') return null
  return {
    id: e.id,
    alias: typeof e.alias === 'string' ? e.alias : '',
    key: e.key,
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : nowIso(),
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : nowIso(),
  }
}

export const useApiKeysStore = defineStore('apiKeys', () => {
  const keys = ref<ApiKeyEntry[]>([])

  const loaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  function scheduleSave() {
    if (!loaded.value) return
    if (saveTimer) clearTimeout(saveTimer)
    pending = true
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, 600)
  }

  async function flushSave(): Promise<void> {
    if (!pending) return
    pending = false
    saving.value = true
    lastError.value = null
    try {
      const res = await fetch('/api/api-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keys.value }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`PUT /api/api-keys ${res.status}: ${txt.slice(0, 200)}`)
      }
      const j = (await res.json()) as { savedAt?: string }
      if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      pending = true
    } finally {
      saving.value = false
    }
  }

  async function loadFromServer(): Promise<void> {
    if (loading.value || loaded.value) return
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
      const doc = raw as Partial<ApiKeysDocument>
      if (doc.version !== 1 || !Array.isArray(doc.keys)) {
        loaded.value = true
        return
      }
      const list: ApiKeyEntry[] = []
      for (const o of doc.keys) {
        const n = normalizeEntry(o)
        if (n) list.push(n)
      }
      keys.value = list
      if (typeof doc.savedAt === 'string') lastSavedAt.value = doc.savedAt
      loaded.value = true
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  watch(keys, () => scheduleSave(), { deep: true, flush: 'post' })

  function findById(id: string | null | undefined): ApiKeyEntry | undefined {
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

  function createKey(partial?: Partial<Pick<ApiKeyEntry, 'alias' | 'key'>>): ApiKeyEntry {
    const t = nowIso()
    const entry: ApiKeyEntry = {
      id: makeId(),
      alias:
        typeof partial?.alias === 'string' && partial.alias.trim()
          ? partial.alias.trim()
          : nextDefaultAlias(),
      key: typeof partial?.key === 'string' ? partial.key : '',
      createdAt: t,
      updatedAt: t,
    }
    keys.value = [...keys.value, entry]
    return entry
  }

  function updateKey(
    id: string,
    patch: Partial<Pick<ApiKeyEntry, 'alias' | 'key'>>,
  ): void {
    const idx = keys.value.findIndex((k) => k.id === id)
    if (idx < 0) return
    const next = keys.value.slice()
    next[idx] = {
      ...next[idx],
      alias:
        typeof patch.alias === 'string' ? patch.alias.trim() : next[idx].alias,
      key: typeof patch.key === 'string' ? patch.key : next[idx].key,
      updatedAt: nowIso(),
    }
    keys.value = next
  }

  function deleteKey(id: string): void {
    keys.value = keys.value.filter((k) => k.id !== id)
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
  }
})
