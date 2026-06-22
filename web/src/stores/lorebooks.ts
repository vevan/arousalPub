import {
  buildLorebookExportDocument,
  downloadLorebookExport,
  parseLorebookImport,
} from '@/utils/lorebooks-package'
import { allocateShortId } from '@/utils/short-id'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export interface LorebookGroup {
  id: string
  name: string
  order: number
  description?: string
}

export type LorebookTriggerMode = 'keyword' | 'constant' | 'vector'

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
  triggerMode?: LorebookTriggerMode
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

function collectAllLorebookIds(lorebooks: Lorebook[]): Set<string> {
  const used = new Set<string>()
  for (const lb of lorebooks) {
    used.add(lb.id)
    for (const g of lb.groups) used.add(g.id)
    for (const e of lb.entries) used.add(e.id)
  }
  return used
}

function firstGroupIdOf(lb: Lorebook): string | null {
  return (
    lb.groups
      .slice()
      .sort((a, b) => a.order - b.order)[0]?.id ?? null
  )
}

const EMPTY_LOREBOOK: Lorebook = {
  id: '',
  name: '',
  groups: [],
  entries: [],
  createdAt: '',
  updatedAt: '',
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
  const lorebooks = ref<Lorebook[]>([])
  const activeLorebookId = ref('')
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
  let loadPromise: Promise<void> | null = null
  /** 与上次成功 PUT 一致的快照，用于跳过无变更保存 */
  let lastPersistedSnapshot = ''
  /** 对齐服务端 LOREBOOKS_BULK_PUT_MIN_INTERVAL_MS（2s） */
  const SAVE_MIN_INTERVAL_MS = 2100
  /** 失焦等明确提交：短防抖合并 Tab 连跳多个字段 */
  const SAVE_BATCH_MS = 150
  let lastPutCompletedAt = 0

  function lorebooksSnapshot(): string {
    return JSON.stringify(lorebooks.value)
  }

  type SaveTiming = 'immediate' | 'debounced'

  function scheduleSave(timing: SaveTiming = 'immediate') {
    if (!loaded.value || lorebooks.value.length === 0) return
    if (saveTimer) clearTimeout(saveTimer)
    pendingSave = true

    let delay =
      timing === 'debounced' ? SAVE_MIN_INTERVAL_MS : SAVE_BATCH_MS
    const sinceLastPut = Date.now() - lastPutCompletedAt
    if (lastPutCompletedAt > 0 && sinceLastPut < SAVE_MIN_INTERVAL_MS) {
      delay = Math.max(delay, SAVE_MIN_INTERVAL_MS - sinceLastPut)
    }

    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, delay)
  }

  function scheduleSaveRetry(rateLimited = false): void {
    if (!pendingSave) return
    if (saveTimer) clearTimeout(saveTimer)
    let delay = rateLimited ? SAVE_MIN_INTERVAL_MS : SAVE_BATCH_MS
    const sinceLastPut = Date.now() - lastPutCompletedAt
    if (lastPutCompletedAt > 0 && sinceLastPut < SAVE_MIN_INTERVAL_MS) {
      delay = Math.max(delay, SAVE_MIN_INTERVAL_MS - sinceLastPut)
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, delay)
  }

  const activeLorebook = computed<Lorebook>(() => {
    if (lorebooks.value.length === 0) return EMPTY_LOREBOOK
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


  async function flushSave(): Promise<void> {
    if (!pendingSave) return
    if (lorebooks.value.length === 0) {
      pendingSave = false
      return
    }
    const snapshot = lorebooksSnapshot()
    if (snapshot === lastPersistedSnapshot) {
      pendingSave = false
      return
    }
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
      lastPersistedSnapshot = snapshot
      lastPutCompletedAt = Date.now()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      pendingSave = true
      const rateLimited =
        lastError.value.includes('429') ||
        lastError.value.includes('lorebooks_bulk_put_rate_limited')
      scheduleSaveRetry(rateLimited)
    } finally {
      saving.value = false
    }
  }

  async function loadFromServer(): Promise<void> {
    if (loaded.value) return
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      loading.value = true
      lastError.value = null
      try {
        const res = await fetch('/api/lorebooks')
        if (!res.ok) throw new Error(`GET /api/lorebooks ${res.status}`)
        const raw: unknown = await res.json()
        if (raw && typeof raw === 'object') {
          const doc = raw as LorebooksServerDocument
          if (Array.isArray(doc.lorebooks) && doc.lorebooks.length === 0) {
            lorebooks.value = []
            activeLorebookId.value = ''
            activeGroupId.value = null
            selectedEntryId.value = null
            loaded.value = true
            return
          }
        }
        const fromServer = raw === null ? null : normalizeServerDoc(raw)
        if (fromServer) {
          lorebooks.value = fromServer.lorebooks
          activeLorebookId.value = fromServer.activeLorebookId
          lastPersistedSnapshot = lorebooksSnapshot()
          const lb = activeLorebook.value
          if (
            activeGroupId.value &&
            !lb.groups.some((g) => g.id === activeGroupId.value)
          ) {
            activeGroupId.value = firstGroupIdOf(lb)
          }
          if (!activeGroupId.value) {
            activeGroupId.value = firstGroupIdOf(lb)
          }
          loaded.value = true
          return
        }
        lorebooks.value = []
        activeLorebookId.value = ''
        activeGroupId.value = null
        selectedEntryId.value = null
        loaded.value = true
        lastError.value = 'lorebooks_not_initialized'
      } catch (e) {
        lastError.value = e instanceof Error ? e.message : String(e)
      } finally {
        loading.value = false
      }
    })()
    try {
      await loadPromise
    } finally {
      loadPromise = null
    }
  }

  function patchActiveLorebook(
    patch: (lb: Lorebook) => Lorebook,
    options?: { save?: SaveTiming | false },
  ) {
    const id = activeLorebookId.value
    const i = lorebooks.value.findIndex((x) => x.id === id)
    if (i < 0) return
    const next = normalizeLorebook(patch({ ...lorebooks.value[i] }))
    lorebooks.value[i] = { ...next, updatedAt: nowIso() }
    const save = options?.save ?? 'immediate'
    if (save !== false) scheduleSave(save)
  }

  /** 插件经 API 写入条目后同步本地缓存（不触发 PUT 回写） */
  function upsertEntryFromPlugin(
    lorebookId: string,
    entry: LorebookEntry,
    mode: 'create' | 'patch',
  ): void {
    if (!loaded.value) return
    const i = lorebooks.value.findIndex((x) => x.id === lorebookId)
    if (i < 0) return
    const lb = lorebooks.value[i]
    const t = entry.updatedAt || nowIso()
    if (mode === 'create') {
      const exists = lb.entries.some((e) => e.id === entry.id)
      const entries = exists
        ? lb.entries.map((e) => (e.id === entry.id ? { ...e, ...entry } : e))
        : [...lb.entries, entry]
      lorebooks.value[i] = normalizeLorebook({ ...lb, entries, updatedAt: t })
    } else {
      let entries = lb.entries.map((e) =>
        e.id === entry.id ? { ...e, ...entry, updatedAt: t } : e,
      )
      if (!entries.some((e) => e.id === entry.id)) {
        entries = [...entries, entry]
      }
      lorebooks.value[i] = normalizeLorebook({ ...lb, entries, updatedAt: t })
    }
    if (activeLorebookId.value === lorebookId) {
      selectedEntryId.value = entry.id
    }
  }

  /** 插件 ensure 新建资料库后同步本地缓存（不触发 PUT 回写） */
  function upsertLorebookFromPlugin(lb: Lorebook): void {
    if (!loaded.value) return
    const normalized = normalizeLorebook(lb)
    const i = lorebooks.value.findIndex((x) => x.id === normalized.id)
    if (i >= 0) {
      lorebooks.value[i] = normalized
    } else {
      lorebooks.value.unshift(normalized)
    }
  }

  function allocateLorebookId(): string {
    return allocateShortId(collectAllLorebookIds(lorebooks.value))
  }

  function createLorebook(name: string): Lorebook {
    const t = nowIso()
    const used = collectAllLorebookIds(lorebooks.value)
    const id = allocateShortId(used)
    const lb: Lorebook = {
      id,
      name: name.trim() || 'New lorebook',
      groups: [{ id: allocateShortId(used), name: 'Default group', order: 0 }],
      entries: [],
      createdAt: t,
      updatedAt: t,
    }
    lorebooks.value.unshift(lb)
    activeLorebookId.value = id
    activeGroupId.value = lb.groups[0].id
    selectedEntryId.value = null
    loaded.value = true
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
    activeGroupId.value = lb ? firstGroupIdOf(lb) : null
    selectedEntryId.value = null
  }

  /** 选中指定资料库及其第一个分组；不存在则 false */
  function focusLorebookById(lorebookId: string | null | undefined): boolean {
    const id = lorebookId?.trim()
    if (!id) return false
    const lb = lorebooks.value.find((x) => x.id === id)
    if (!lb) return false
    activeLorebookId.value = lb.id
    activeGroupId.value = firstGroupIdOf(lb)
    selectedEntryId.value = null
    searchText.value = ''
    return true
  }

  /**
   * 优先选中 conversation 绑定列表中的第一本资料库 + 第一分组；
   * 若无匹配则回退到库中第一本。
   */
  function focusConversationLorebooks(
    ids: string[],
    preferredId?: string | null,
  ): void {
    const candidates: string[] = []
    if (preferredId?.trim()) candidates.push(preferredId.trim())
    for (const id of ids) {
      const t = id.trim()
      if (t && !candidates.includes(t)) candidates.push(t)
    }
    for (const id of candidates) {
      if (focusLorebookById(id)) return
    }
    const fallback = lorebooks.value[0]
    if (fallback) {
      activeLorebookId.value = fallback.id
      activeGroupId.value = firstGroupIdOf(fallback)
      selectedEntryId.value = null
      searchText.value = ''
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await loadFromServer()
  }

  async function applyOpenFocus(
    conversationIds: string[],
    preferredId?: string | null,
  ): Promise<void> {
    await ensureLoaded()
    focusConversationLorebooks(conversationIds, preferredId)
  }

  function selectGroup(id: string | null) {
    activeGroupId.value = id
    const entryId = selectedEntryId.value
    const cur = entryId
      ? activeLorebook.value.entries.find((e) => e.id === entryId)
      : null
    if (!cur || cur.groupId !== id) selectedEntryId.value = null
  }

  function selectEntry(id: string) {
    selectedEntryId.value = id
  }

  function addGroup(name: string): LorebookGroup | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const lb = activeLorebook.value
    const order =
      lb.groups.length > 0
        ? Math.max(...lb.groups.map((g) => g.order)) + 1
        : 0
    const g: LorebookGroup = {
      id: allocateShortId(collectAllLorebookIds(lorebooks.value)),
      name: trimmed,
      order,
    }
    patchActiveLorebook((book) => ({
      ...book,
      groups: [...book.groups, g],
    }))
    activeGroupId.value = g.id
    return g
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
    const used = collectAllLorebookIds(lorebooks.value)
    const newId = allocateShortId(used)
    const groupIdMap = new Map<string, string>()
    const groups = src.groups.map((g) => {
      const nid = allocateShortId(used)
      groupIdMap.set(g.id, nid)
      return { ...g, id: nid }
    })
    const entries = src.entries.map((e) => ({
      ...e,
      id: allocateShortId(used),
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
      id: allocateShortId(collectAllLorebookIds(lorebooks.value)),
      groupId,
      title: '',
      content: '',
      enabled: true,
      order: activeLorebook.value.entries.filter((e) => e.groupId === groupId)
        .length,
      keys: [],
      constant: false,
      triggerMode: 'keyword',
      priority: 100,
      createdAt: t,
      updatedAt: t,
    }
    patchActiveLorebook((lb) => ({
      ...lb,
      entries: [...lb.entries, entry],
    }))
    selectedEntryId.value = entry.id
    return entry
  }

  function duplicateEntry(entryId: string, targetGroupId?: string) {
    const src = activeLorebook.value.entries.find((e) => e.id === entryId)
    if (!src) return null
    const gid = targetGroupId?.trim() || src.groupId
    if (!activeLorebook.value.groups.some((g) => g.id === gid)) return null

    const t = nowIso()
    const inTarget = activeLorebook.value.entries.filter((e) => e.groupId === gid)
    const maxOrder = inTarget.reduce((m, e) => Math.max(m, e.order), -1)
    const entry: LorebookEntry = {
      ...src,
      id: allocateShortId(collectAllLorebookIds(lorebooks.value)),
      groupId: gid,
      title: src.title ? `${src.title} (副本)` : '',
      order: maxOrder + 1,
      createdAt: t,
      updatedAt: t,
    }
    patchActiveLorebook((lb) => ({ ...lb, entries: [...lb.entries, entry] }))
    activeGroupId.value = gid
    selectedEntryId.value = entry.id
    return entry
  }

  function moveEntryToGroup(entryId: string, targetGroupId: string): boolean {
    const gid = targetGroupId.trim()
    if (!activeLorebook.value.groups.some((g) => g.id === gid)) return false

    const lb = activeLorebook.value
    const moved = lb.entries.find((e) => e.id === entryId)
    if (!moved) return false

    const fromGroupId = moved.groupId
    if (fromGroupId === gid) {
      const inGroup = lb.entries
        .filter((e) => e.groupId === gid)
        .slice()
        .sort((a, b) => a.order - b.order)
      const fromIdx = inGroup.findIndex((e) => e.id === entryId)
      if (fromIdx < 0) return false
      const [item] = inGroup.splice(fromIdx, 1)
      inGroup.push(item)
      const orderMap = new Map(inGroup.map((e, i) => [e.id, i]))
      patchActiveLorebook((book) => ({
        ...book,
        entries: book.entries.map((e) =>
          e.groupId === gid && orderMap.has(e.id)
            ? { ...e, order: orderMap.get(e.id)! }
            : e,
        ),
      }))
      activeGroupId.value = gid
      selectedEntryId.value = entryId
      return true
    }

    const targetList = lb.entries
      .filter((e) => e.groupId === gid)
      .slice()
      .sort((a, b) => a.order - b.order)
    const newOrder = targetList.length

    const fromList = lb.entries
      .filter((e) => e.groupId === fromGroupId && e.id !== entryId)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((e, i) => ({ ...e, order: i }))

    const targetWithMoved = [
      ...targetList,
      { ...moved, groupId: gid, order: newOrder, updatedAt: nowIso() },
    ]

    patchActiveLorebook((book) => ({
      ...book,
      entries: book.entries
        .filter((e) => e.groupId !== fromGroupId && e.groupId !== gid)
        .concat(fromList, targetWithMoved),
    }))
    activeGroupId.value = gid
    selectedEntryId.value = entryId
    return true
  }

  function updateEntry(
    entryId: string,
    patch: Partial<LorebookEntry>,
    options?: { save?: SaveTiming },
  ) {
    patchActiveLorebook(
      (lb) => ({
        ...lb,
        entries: lb.entries.map((e) =>
          e.id === entryId ? { ...e, ...patch, updatedAt: nowIso() } : e,
        ),
      }),
      { save: options?.save ?? 'immediate' },
    )
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

  function uniqueImportedLorebookName(name: string): string {
    const base = name.trim() || 'Imported lorebook'
    if (!lorebooks.value.some((x) => x.name === base)) return base
    const candidate = `${base} (imported)`
    if (!lorebooks.value.some((x) => x.name === candidate)) return candidate
    let i = 2
    while (lorebooks.value.some((x) => x.name === `${base} (imported ${i})`)) {
      i += 1
    }
    return `${base} (imported ${i})`
  }

  function exportActiveLorebook(): void {
    const doc = buildLorebookExportDocument(activeLorebook.value)
    downloadLorebookExport(doc)
  }

  async function importLorebookFromJson(text: string): Promise<Lorebook> {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(
        `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
      )
    }
    const t = nowIso()
    let src = normalizeLorebook(parseLorebookImport(parsed))
    const idTaken = lorebooks.value.some((x) => x.id === src.id)
    const nameTaken = lorebooks.value.some((x) => x.name === src.name.trim())
    const lb: Lorebook = {
      ...src,
      id: idTaken ? allocateLorebookId() : src.id,
      name: nameTaken ? uniqueImportedLorebookName(src.name) : src.name.trim(),
      createdAt: t,
      updatedAt: t,
    }
    lorebooks.value.unshift(lb)
    activeLorebookId.value = lb.id
    activeGroupId.value =
      lb.groups.slice().sort((a, b) => a.order - b.order)[0]?.id ?? null
    selectedEntryId.value = null
    loaded.value = true
    pendingSave = true
    await flushSave()
    if (lastError.value) {
      throw new Error(lastError.value)
    }
    return lb
  }

  function clearSessionData(): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    pendingSave = false
    loadPromise = null
    lorebooks.value = []
    activeLorebookId.value = ''
    activeGroupId.value = null
    selectedEntryId.value = null
    searchText.value = ''
    loaded.value = false
    loading.value = false
    saving.value = false
    lastSavedAt.value = null
    lastError.value = null
    lastPersistedSnapshot = ''
    lastPutCompletedAt = 0
  }

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
    clearSessionData,
    upsertEntryFromPlugin,
    upsertLorebookFromPlugin,
    ensureLoaded,
    applyOpenFocus,
    focusLorebookById,
    focusConversationLorebooks,
    flushSave,
    exportActiveLorebook,
    importLorebookFromJson,
    createLorebook,
    deleteLorebook,
    renameLorebook,
    selectLorebook,
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
    moveEntryToGroup,
    reorderEntry,
    selectEntry,
    setSearchText,
  }
})
