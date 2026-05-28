import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export interface LorebookGroup {
  id: string
  name: string
  order: number
  description?: string
}

export interface LorebookEntry {
  id: string
  groupId: string
  title: string
  content: string
  comment?: string
  enabled: boolean
  order: number
  keys: string[]
  constant: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

export interface Lorebook {
  id: string
  name: string
  description?: string
  groups: LorebookGroup[]
  entries: LorebookEntry[]
  createdAt: string
  updatedAt: string
}

interface LorebooksServerDocument {
  schemaVersion?: number
  savedAt?: string
  lorebooks?: Lorebook[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildDefaultLorebook(): Lorebook {
  const t = nowIso()
  const mainGroupId = 'group-main'
  return {
    id: 'lore-default',
    name: '默认资料库',
    description: '示例分组与条目结构。',
    groups: [
      { id: mainGroupId, name: '主要设定', order: 0 },
      { id: 'group-characters', name: '角色', order: 1 },
      { id: 'group-locations', name: '地点', order: 2 },
    ],
    entries: [
      {
        id: 'entry-pub-tone',
        groupId: mainGroupId,
        title: '酒馆基调',
        content:
          'Arousal Pub 坐落于三王国岔路口，灯火昏黄、木梁吱呀。叙事偏慢节奏奇幻，重视气味与触感。',
        enabled: true,
        order: 0,
        keys: [],
        constant: true,
        priority: 100,
        createdAt: t,
        updatedAt: t,
      },
    ],
    createdAt: t,
    updatedAt: t,
  }
}

function buildInitialState(): { lorebooks: Lorebook[]; activeLorebookId: string } {
  const lb = buildDefaultLorebook()
  return { lorebooks: [lb], activeLorebookId: lb.id }
}

function normalizeLorebook(lb: Lorebook): Lorebook {
  const groups = lb.groups
    .slice()
    .sort((a, b) => a.order - b.order)
  const groupIds = new Set(groups.map((g) => g.id))
  const entries = lb.entries
    .filter((e) => groupIds.has(e.groupId))
    .slice()
    .sort((a, b) => {
      const ga = groups.find((g) => g.id === a.groupId)?.order ?? 0
      const gb = groups.find((g) => g.id === b.groupId)?.order ?? 0
      if (ga !== gb) return ga - gb
      return a.order - b.order
    })
  return { ...lb, groups, entries }
}

function normalizeServerDoc(raw: unknown): {
  lorebooks: Lorebook[]
  activeLorebookId: string
} | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as LorebooksServerDocument
  const list = doc.lorebooks?.filter(
    (lb) =>
      lb &&
      typeof lb.id === 'string' &&
      Array.isArray(lb.groups) &&
      Array.isArray(lb.entries),
  )
  if (!list?.length) return null
  const lorebooks = list.map(normalizeLorebook)
  return { lorebooks, activeLorebookId: lorebooks[0].id }
}

export const useLorebooksStore = defineStore('lorebooks', () => {
  const initial = buildInitialState()
  const lorebooks = ref<Lorebook[]>(initial.lorebooks)
  const activeLorebookId = ref(initial.activeLorebookId)
  const activeGroupId = ref<string | null>(null)
  const selectedEntryId = ref<string | null>(null)
  const searchText = ref('')

  const loaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave = false

  const activeLorebook = computed<Lorebook>(() => {
    const lb =
      lorebooks.value.find((x) => x.id === activeLorebookId.value) ??
      lorebooks.value[0]
    return lb
  })

  const activeGroups = computed(() =>
    activeLorebook.value.groups.slice().sort((a, b) => a.order - b.order),
  )

  const activeEntries = computed(() => activeLorebook.value.entries)

  const visibleEntries = computed(() => {
    const gid = activeGroupId.value
    const q = searchText.value.trim().toLowerCase()
    return activeLorebook.value.entries
      .filter((e) => (gid ? e.groupId === gid : true))
      .filter((e) => {
        if (!q) return true
        return (
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          (e.comment ?? '').toLowerCase().includes(q) ||
          e.keys.some((k) => k.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => {
        const ga =
          activeGroups.value.find((g) => g.id === a.groupId)?.order ?? 0
        const gb =
          activeGroups.value.find((g) => g.id === b.groupId)?.order ?? 0
        if (ga !== gb) return ga - gb
        return a.order - b.order
      })
  })

  const groupCounts = computed<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const g of activeGroups.value) m[g.id] = 0
    for (const e of activeLorebook.value.entries) {
      if (e.groupId in m) m[e.groupId]++
    }
    return m
  })

  const selectedEntry = computed(() => {
    if (!selectedEntryId.value) return null
    return (
      activeLorebook.value.entries.find((e) => e.id === selectedEntryId.value) ??
      null
    )
  })

  function scheduleSave() {
    if (!loaded.value) return
    if (saveTimer) clearTimeout(saveTimer)
    pendingSave = true
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, 600)
  }

  async function flushSave(): Promise<void> {
    if (!pendingSave) return
    pendingSave = false
    saving.value = true
    lastError.value = null
    try {
      const res = await fetch('/api/lorebooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lorebooks: lorebooks.value }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`PUT /api/lorebooks ${res.status}: ${txt.slice(0, 200)}`)
      }
      const j = (await res.json()) as { savedAt?: string }
      if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      pendingSave = true
    } finally {
      saving.value = false
    }
  }

  async function loadFromServer(): Promise<void> {
    if (loading.value || loaded.value) return
    loading.value = true
    lastError.value = null
    try {
      const res = await fetch('/api/lorebooks')
      if (!res.ok) throw new Error(`GET /api/lorebooks ${res.status}`)
      const raw: unknown = await res.json()
      const fromServer = raw === null ? null : normalizeServerDoc(raw)
      if (fromServer) {
        lorebooks.value = fromServer.lorebooks
        activeLorebookId.value = fromServer.activeLorebookId
        if (
          activeGroupId.value &&
          !activeLorebook.value.groups.some((g) => g.id === activeGroupId.value)
        ) {
          activeGroupId.value = activeLorebook.value.groups[0]?.id ?? null
        }
        if (!activeGroupId.value) {
          activeGroupId.value =
            activeLorebook.value.groups[0]?.id ?? null
        }
        loaded.value = true
        return
      }
      if (!activeGroupId.value) {
        activeGroupId.value =
          activeLorebook.value.groups[0]?.id ?? null
      }
      loaded.value = true
      pendingSave = true
      await flushSave()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function patchActiveLorebook(patch: (lb: Lorebook) => Lorebook) {
    const id = activeLorebookId.value
    const i = lorebooks.value.findIndex((x) => x.id === id)
    if (i < 0) return
    const next = normalizeLorebook(patch({ ...lorebooks.value[i] }))
    lorebooks.value[i] = { ...next, updatedAt: nowIso() }
    scheduleSave()
  }

  function createLorebook(name: string): Lorebook {
    const t = nowIso()
    const id = `lore-${Date.now().toString(36)}`
    const lb: Lorebook = {
      id,
      name: name.trim() || '新资料库',
      groups: [{ id: makeId('group'), name: '默认分组', order: 0 }],
      entries: [],
      createdAt: t,
      updatedAt: t,
    }
    lorebooks.value.unshift(lb)
    activeLorebookId.value = id
    activeGroupId.value = lb.groups[0].id
    selectedEntryId.value = null
    scheduleSave()
    return lb
  }

  function deleteLorebook(id: string) {
    if (lorebooks.value.length <= 1) return
    lorebooks.value = lorebooks.value.filter((x) => x.id !== id)
    if (activeLorebookId.value === id) {
      activeLorebookId.value = lorebooks.value[0].id
    }
    activeGroupId.value = activeLorebook.value.groups[0]?.id ?? null
    selectedEntryId.value = null
    scheduleSave()
  }

  function renameLorebook(id: string, name: string) {
    const i = lorebooks.value.findIndex((x) => x.id === id)
    if (i < 0) return
    lorebooks.value[i] = {
      ...lorebooks.value[i],
      name: name.trim() || lorebooks.value[i].name,
      updatedAt: nowIso(),
    }
    scheduleSave()
  }

  function selectLorebook(id: string) {
    activeLorebookId.value = id
    const lb = lorebooks.value.find((x) => x.id === id)
    activeGroupId.value =
      lb?.groups.slice().sort((a, b) => a.order - b.order)[0]?.id ?? null
    selectedEntryId.value = null
  }

  function selectGroup(id: string | null) {
    activeGroupId.value = id
    const cur = selectedEntryId.value
      ? activeLorebook.value.entries.find((e) => e.id === cur)
      : null
    if (!cur || cur.groupId !== id) selectedEntryId.value = null
  }

  function selectEntry(id: string) {
    selectedEntryId.value = id
  }

  function addGroup(name: string): LorebookGroup | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    let created: LorebookGroup | null = null
    patchActiveLorebook((lb) => {
      const order =
        lb.groups.length > 0
          ? Math.max(...lb.groups.map((g) => g.order)) + 1
          : 0
      const g: LorebookGroup = {
        id: makeId('group'),
        name: trimmed,
        order,
      }
      created = g
      return { ...lb, groups: [...lb.groups, g] }
    })
    if (created) activeGroupId.value = created.id
    return created
  }

  function renameGroup(groupId: string, name: string) {
    patchActiveLorebook((lb) => ({
      ...lb,
      groups: lb.groups.map((g) =>
        g.id === groupId ? { ...g, name: name.trim() || g.name } : g,
      ),
    }))
  }

  function deleteGroup(groupId: string): boolean {
    patchActiveLorebook((lb) => ({
      ...lb,
      groups: lb.groups.filter((g) => g.id !== groupId),
      entries: lb.entries.filter((e) => e.groupId !== groupId),
    }))
    if (activeGroupId.value === groupId) {
      activeGroupId.value =
        activeLorebook.value.groups[0]?.id ?? null
    }
    return true
  }

  function reorderGroup(groupId: string, targetIndex: number) {
    const sorted = activeGroups.value.slice()
    const fromIdx = sorted.findIndex((g) => g.id === groupId)
    if (fromIdx === -1) return
    const [moved] = sorted.splice(fromIdx, 1)
    const clamped = Math.max(0, Math.min(targetIndex, sorted.length))
    sorted.splice(clamped, 0, moved)
    const reordered = sorted.map((g, i) => ({ ...g, order: i }))
    patchActiveLorebook((lb) => ({ ...lb, groups: reordered }))
  }

  function reorderEntry(entryId: string, targetIndex: number) {
    const gid = activeGroupId.value
    if (!gid) return
    const inGroup = activeLorebook.value.entries
      .filter((e) => e.groupId === gid)
      .slice()
      .sort((a, b) => a.order - b.order)
    const fromIdx = inGroup.findIndex((e) => e.id === entryId)
    if (fromIdx === -1) return
    const [moved] = inGroup.splice(fromIdx, 1)
    const clamped = Math.max(0, Math.min(targetIndex, inGroup.length))
    inGroup.splice(clamped, 0, moved)
    const orderMap = new Map(inGroup.map((e, i) => [e.id, i]))
    patchActiveLorebook((lb) => ({
      ...lb,
      entries: lb.entries.map((e) =>
        e.groupId === gid && orderMap.has(e.id)
          ? { ...e, order: orderMap.get(e.id)! }
          : e,
      ),
    }))
  }

  function setSearchText(s: string) {
    searchText.value = s
  }

  function duplicateLorebook(id: string): Lorebook | null {
    const src = lorebooks.value.find((x) => x.id === id)
    if (!src) return null
    const t = nowIso()
    const newId = `lore-${Date.now().toString(36)}`
    const groupIdMap = new Map<string, string>()
    const groups = src.groups.map((g) => {
      const nid = makeId('group')
      groupIdMap.set(g.id, nid)
      return { ...g, id: nid }
    })
    const entries = src.entries.map((e) => ({
      ...e,
      id: makeId('entry'),
      groupId: groupIdMap.get(e.groupId) ?? e.groupId,
      createdAt: t,
      updatedAt: t,
    }))
    const copy: Lorebook = {
      ...src,
      id: newId,
      name: `${src.name} (副本)`,
      groups,
      entries,
      createdAt: t,
      updatedAt: t,
    }
    lorebooks.value.unshift(copy)
    activeLorebookId.value = newId
    activeGroupId.value = groups[0]?.id ?? null
    selectedEntryId.value = null
    scheduleSave()
    return copy
  }

  function createEntry(groupId: string) {
    const t = nowIso()
    const entry: LorebookEntry = {
      id: makeId('entry'),
      groupId,
      title: '',
      content: '',
      enabled: true,
      order: activeLorebook.value.entries.filter((e) => e.groupId === groupId)
        .length,
      keys: [],
      constant: true,
      priority: 0,
      createdAt: t,
      updatedAt: t,
    }
    patchActiveLorebook((lb) => ({
      ...lb,
      entries: [...lb.entries, entry],
    }))
    selectedEntryId.value = entry.id
    scheduleSave()
    return entry
  }

  function duplicateEntry(entryId: string) {
    const src = activeLorebook.value.entries.find((e) => e.id === entryId)
    if (!src) return
    const t = nowIso()
    const sameGroup = activeLorebook.value.entries.filter(
      (e) => e.groupId === src.groupId,
    )
    const maxOrder = sameGroup.reduce((m, e) => Math.max(m, e.order), -1)
    const entry: LorebookEntry = {
      ...src,
      id: makeId('entry'),
      title: src.title ? `${src.title} (副本)` : '',
      order: maxOrder + 1,
      createdAt: t,
      updatedAt: t,
    }
    patchActiveLorebook((lb) => ({ ...lb, entries: [...lb.entries, entry] }))
    selectedEntryId.value = entry.id
  }

  function updateEntry(entryId: string, patch: Partial<LorebookEntry>) {
    patchActiveLorebook((lb) => ({
      ...lb,
      entries: lb.entries.map((e) =>
        e.id === entryId ? { ...e, ...patch, updatedAt: nowIso() } : e,
      ),
    }))
  }

  function deleteEntry(entryId: string) {
    patchActiveLorebook((lb) => ({
      ...lb,
      entries: lb.entries.filter((e) => e.id !== entryId),
    }))
    if (selectedEntryId.value === entryId) selectedEntryId.value = null
  }

  watch(activeLorebookId, (id) => {
    const lb = lorebooks.value.find((x) => x.id === id)
    if (!lb) return
    if (
      !activeGroupId.value ||
      !lb.groups.some((g) => g.id === activeGroupId.value)
    ) {
      activeGroupId.value =
        lb.groups.slice().sort((a, b) => a.order - b.order)[0]?.id ?? null
    }
    selectedEntryId.value = null
  })

  return {
    lorebooks,
    activeLorebookId,
    activeGroupId,
    selectedEntryId,
    searchText,
    activeLorebook,
    activeGroups,
    activeEntries,
    visibleEntries,
    groupCounts,
    selectedEntry,
    loaded,
    loading,
    saving,
    lastSavedAt,
    lastError,
    loadFromServer,
    flushSave,
    createLorebook,
    deleteLorebook,
    renameLorebook,
    duplicateLorebook,
    addGroup,
    renameGroup,
    deleteGroup,
    reorderGroup,
    selectGroup,
    createEntry,
    updateEntry,
    deleteEntry,
    duplicateEntry,
    reorderEntry,
    selectEntry,
    setSearchText,
  }
})
