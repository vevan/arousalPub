import { allocateShortId, generateShortId } from '@/utils/short-id'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

/** ============== Types ============== */

export type GroupKind =
  | 'normal'
  | 'character'
  | 'world'
  | 'history'
  | 'userInput'
export type PromptRole = 'system' | 'user' | 'assistant'
export type InjectionPosition = 'relative' | 'chat'
export type PromptTrigger = 'normal' | 'continue' | 'swipe' | 'regenerate'

/** 会话绑定角色卡槽位：正文由聊天侧注入，条目仅排序与启用 */
export type PromptBindingSlot =
  | 'boundCharacterSystem'
  | 'boundWorld'
  | 'boundCharacterPostHistory'
  | 'boundUserInput'

export interface PromptGroup {
  id: string
  name: string
  kind: GroupKind
  order: number
  description?: string
  /** false = 组装时跳过组内无 bindingSlot 的自定义条目 */
  enabled?: boolean
}

export interface PromptEntry {
  id: string
  groupId: string
  title: string
  content: string
  description: string
  tags: string[]
  enabled: boolean
  role: PromptRole
  injectionPosition: InjectionPosition
  injectionDepth: number
  injectionOrder: number
  /** 触发器：空数组表示任何时候都启用 */
  triggers: PromptTrigger[]
  /** 同分组内上下顺序，从 0 开始 */
  order: number
  isSeed?: boolean
  /** 若为绑定槽位，组装时使用会话角色卡字段而非 content */
  bindingSlot?: PromptBindingSlot
  /**
   * @deprecated 角色组已改为仅用 `order` 与绑定槽混排；加载预设时由 normalize 剥离。
   */
  characterBundlePosition?: 'before' | 'after'
  createdAt: string
  updatedAt: string
}

/** 仅用于 normalize：旧版「卡前 / 槽 / 卡后」分区 → 展平为单一 order */
function characterBundleListPartitionLegacy(e: PromptEntry): number {
  if (e.bindingSlot === 'boundCharacterSystem') return 1
  if (e.characterBundlePosition === 'after') return 2
  return 0
}

function migrateCharacterGroupToFlatOrder(
  prompts: PromptEntry[],
  charGroupId: string,
): PromptEntry[] {
  const inGroup = prompts.filter((e) => e.groupId === charGroupId)
  if (inGroup.length === 0) return prompts
  const sorted = inGroup.slice().sort((a, b) => {
    const pa = characterBundleListPartitionLegacy(a)
    const pb = characterBundleListPartitionLegacy(b)
    if (pa !== pb) return pa - pb
    return a.order - b.order
  })
  const idOrder = new Map(sorted.map((e, i) => [e.id, i]))
  return prompts.map((e) => {
    if (e.groupId !== charGroupId) return e
    const { characterBundlePosition: _drop, ...rest } = e
    return { ...rest, order: idOrder.get(e.id)! }
  })
}

export interface PromptPreset {
  id: string
  name: string
  groups: PromptGroup[]
  prompts: PromptEntry[]
  createdAt: string
  updatedAt: string
}

/** GET /api/prompts 索引项（不含条目正文） */
export interface PromptPresetIndexEntry {
  id: string
  name: string
  updatedAt: string
}

/** 可在提示词页维护条目列表的分组（其余为纯占位注入） */
export function groupAllowsPromptEntries(kind: GroupKind): boolean {
  return (
    kind === 'normal' ||
    kind === 'character' ||
    kind === 'world' ||
    kind === 'history' ||
    kind === 'userInput'
  )
}

/** ============== Constants & helpers ============== */

export const DEFAULT_GROUP_IDS = {
  pre: 'group-pre',
  character: 'group-character',
  world: 'group-world',
  history: 'group-history',
  userInput: 'group-user-input',
  post: 'group-post',
} as const

function nowIso(): string {
  return new Date().toISOString()
}

function collectAllPromptIds(bodies: Record<string, PromptPreset>): Set<string> {
  const used = new Set<string>()
  for (const p of Object.values(bodies)) {
    used.add(p.id)
    for (const g of p.groups) used.add(g.id)
    for (const e of p.prompts) used.add(e.id)
  }
  return used
}

function makeId(bodies: Record<string, PromptPreset>): string {
  return allocateShortId(collectAllPromptIds(bodies))
}

function stubPresetFromIndex(e: PromptPresetIndexEntry): PromptPreset {
  return {
    id: e.id,
    name: e.name,
    groups: [],
    prompts: [],
    createdAt: e.updatedAt,
    updatedAt: e.updatedAt,
  }
}

function buildDefaultGroups(): PromptGroup[] {
  return [
    { id: DEFAULT_GROUP_IDS.pre, name: 'Pre', kind: 'normal', order: 0, enabled: true },
    { id: DEFAULT_GROUP_IDS.character, name: 'Character', kind: 'character', order: 1, enabled: true },
    { id: DEFAULT_GROUP_IDS.world, name: 'World', kind: 'world', order: 2, enabled: true },
    { id: DEFAULT_GROUP_IDS.history, name: 'History', kind: 'history', order: 3, enabled: true },
    { id: DEFAULT_GROUP_IDS.userInput, name: 'User input', kind: 'userInput', order: 4, enabled: true },
    { id: DEFAULT_GROUP_IDS.post, name: 'Post', kind: 'normal', order: 5, enabled: true },
  ]
}

function normalizeGroups(groups: PromptGroup[]): PromptGroup[] {
  return groups.map((g) => ({
    ...g,
    description: g.description ?? '',
    enabled: g.enabled !== false,
  }))
}

function makeBindingSlotEntry(
  groupId: string,
  slot: PromptBindingSlot,
  order: number,
  opts?: { enabled?: boolean; id?: string },
): PromptEntry {
  const t = nowIso()
  const enabled = opts?.enabled !== false
  return {
    id: opts?.id ?? generateShortId(),
    groupId,
    title: '',
    content: '',
    description: '',
    tags: [],
    enabled,
    role: 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    order,
    bindingSlot: slot,
    createdAt: t,
    updatedAt: t,
  }
}

function bindingSlotIsRequired(slot: PromptBindingSlot | undefined): boolean {
  return slot === 'boundWorld' || slot === 'boundUserInput'
}

/**
 * 去掉旧版预设级开关、补全绑定槽位条目（并继承旧开关为条目的 enabled）。
 */
export function normalizePreset(p: PromptPreset): PromptPreset {
  const charG = p.groups.find((g) => g.kind === 'character')
  const worldG = p.groups.find((g) => g.kind === 'world')
  const histG = p.groups.find((g) => g.kind === 'history')
  const userInputG = p.groups.find((g) => g.kind === 'userInput')
  const raw = p as PromptPreset & {
    useBoundCharacterSystemPrompt?: boolean
    useBoundCharacterPostHistory?: boolean
  }
  const sysOn = raw.useBoundCharacterSystemPrompt !== false
  const postOn = raw.useBoundCharacterPostHistory !== false

  const {
    useBoundCharacterSystemPrompt: _a,
    useBoundCharacterPostHistory: _b,
    ...rest
  } = raw

  let prompts = p.prompts.map((e) => ({
    ...e,
    enabled: bindingSlotIsRequired(e.bindingSlot) ? true : e.enabled,
  }))

  if (charG && !prompts.some((e) => e.bindingSlot === 'boundCharacterSystem')) {
    const maxO = prompts
      .filter((e) => e.groupId === charG.id)
      .reduce((m, e) => Math.max(m, e.order), -1)
    prompts.push(
      makeBindingSlotEntry(charG.id, 'boundCharacterSystem', maxO + 1, {
        enabled: sysOn,
      }),
    )
  }
  if (worldG && !prompts.some((e) => e.bindingSlot === 'boundWorld')) {
    prompts = prompts.map((e) =>
      e.groupId === worldG.id ? { ...e, order: e.order + 1 } : e,
    )
    prompts.push(
      makeBindingSlotEntry(worldG.id, 'boundWorld', 0, {
        id: 'binding-slot-world',
      }),
    )
  }
  if (
    histG &&
    !prompts.some((e) => e.bindingSlot === 'boundCharacterPostHistory')
  ) {
    const maxO = prompts
      .filter((e) => e.groupId === histG.id)
      .reduce((m, e) => Math.max(m, e.order), -1)
    prompts.push(
      makeBindingSlotEntry(histG.id, 'boundCharacterPostHistory', maxO + 1, {
        enabled: postOn,
      }),
    )
  }
  if (
    userInputG &&
    !prompts.some((e) => e.bindingSlot === 'boundUserInput')
  ) {
    prompts = prompts.map((e) =>
      e.groupId === userInputG.id ? { ...e, order: e.order + 1 } : e,
    )
    prompts.push(
      makeBindingSlotEntry(userInputG.id, 'boundUserInput', 0, {
        id: 'binding-slot-user-input',
      }),
    )
  }

  if (charG) {
    prompts = migrateCharacterGroupToFlatOrder(prompts, charG.id)
  }

  if (histG) {
    prompts = prompts.filter(
      (e) =>
        !(
          e.groupId === histG.id &&
          (e.bindingSlot as string | undefined) === 'boundRecentHistory'
        ),
    )
  }

  return {
    ...rest,
    groups: normalizeGroups(p.groups),
    prompts,
  }
}

const EMPTY_PRESET: PromptPreset = {
  id: '',
  name: '',
  groups: [],
  prompts: [],
  createdAt: '',
  updatedAt: '',
}

/** ============== Storage ============== */

interface PromptsIndexResponse {
  version?: number
  savedAt?: string
  activePresetId?: string
  presets?: unknown
}

function normalizeIndexResponse(
  doc: PromptsIndexResponse | null,
): { activePresetId: string; presets: PromptPresetIndexEntry[] } | null {
  if (!doc || typeof doc !== 'object') return null
  if (!Array.isArray(doc.presets) || doc.presets.length === 0) return null
  const presets: PromptPresetIndexEntry[] = []
  for (const item of doc.presets) {
    if (!item || typeof item !== 'object') continue
    const o = item as Partial<PromptPresetIndexEntry>
    if (typeof o.id !== 'string' || !o.id) continue
    presets.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      updatedAt:
        typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
    })
  }
  if (presets.length === 0) return null
  const activeId =
    typeof doc.activePresetId === 'string' &&
    presets.some((p) => p.id === doc.activePresetId)
      ? doc.activePresetId
      : presets[0].id
  return { activePresetId: activeId, presets }
}

function normalizePresetPayload(raw: unknown): PromptPreset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Partial<PromptPreset>
  if (typeof p.id !== 'string' || !p.id) return null
  if (!Array.isArray(p.groups) || !Array.isArray(p.prompts)) return null
  return normalizePreset(p as PromptPreset)
}

/** ============== Store ============== */

export const usePromptsStore = defineStore('prompts', () => {
  const indexEntries = ref<PromptPresetIndexEntry[]>([])
  /** 仅缓存已从服务端拉取的正文；不用本地种子占位，避免与磁盘不一致 */
  const presetBodies = ref<Record<string, PromptPreset>>({})
  const activePresetId = ref<string>('')

  const presets = computed(() =>
    indexEntries.value.map(
      (e) => presetBodies.value[e.id] ?? stubPresetFromIndex(e),
    ),
  )

  const selectedPromptId = ref<string | null>(null)
  const activeGroupId = ref<string | null>(null)
  const searchText = ref('')

  /** 索引已加载（bootstrap 仅需此项） */
  const loaded = ref(false)
  const loading = ref(false)
  const presetDetailLoading = ref(false)
  const saving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  const activePresetReady = computed(
    () => Boolean(presetBodies.value[activePresetId.value]),
  )

  function syncIndexEntryFromBody(p: PromptPreset) {
    const idx = indexEntries.value.findIndex((e) => e.id === p.id)
    const entry: PromptPresetIndexEntry = {
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
    }
    if (idx < 0) {
      indexEntries.value = [...indexEntries.value, entry]
    } else {
      const next = indexEntries.value.slice()
      next[idx] = entry
      indexEntries.value = next
    }
  }

  function setPresetBody(p: PromptPreset) {
    syncIndexEntryFromBody(p)
    presetBodies.value = { ...presetBodies.value, [p.id]: p }
  }

  /** ====== 服务端 IO ====== */
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave = false
  let pendingIndexPatch = false

  function scheduleSave() {
    if (!loaded.value || !activePresetReady.value) return
    if (saveTimer) clearTimeout(saveTimer)
    pendingSave = true
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, 600)
  }

  function scheduleIndexPatch() {
    if (!loaded.value || indexEntries.value.length === 0) return
    pendingIndexPatch = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushPending()
    }, 600)
  }

  async function persistActivePresetId(): Promise<void> {
    const res = await fetch('/api/prompts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activePresetId: activePresetId.value }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`PATCH /api/prompts ${res.status}: ${txt.slice(0, 200)}`)
    }
    const j = (await res.json()) as { savedAt?: string }
    if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
  }

  async function persistIndex(): Promise<void> {
    const res = await fetch('/api/prompts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activePresetId: activePresetId.value,
        presets: indexEntries.value,
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`PATCH /api/prompts ${res.status}: ${txt.slice(0, 200)}`)
    }
    const j = (await res.json()) as { savedAt?: string }
    if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
  }

  async function flushSave(): Promise<void> {
    const body = presetBodies.value[activePresetId.value]
    if (!body) return
    const res = await fetch(
      `/api/prompts/${encodeURIComponent(activePresetId.value)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(
        `PUT /api/prompts/${activePresetId.value} ${res.status}: ${txt.slice(0, 200)}`,
      )
    }
    const j = (await res.json()) as { savedAt?: string }
    if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
    syncIndexEntryFromBody(body)
  }

  async function flushPending(): Promise<void> {
    if (!pendingSave && !pendingIndexPatch) return
    const doBody = pendingSave
    const doIndex = pendingIndexPatch
    pendingSave = false
    pendingIndexPatch = false
    saving.value = true
    lastError.value = null
    try {
      if (doBody) await flushSave()
      if (doIndex) await persistIndex()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      if (doBody) pendingSave = true
      if (doIndex) pendingIndexPatch = true
    } finally {
      saving.value = false
    }
  }

  let loadIndexInflight: Promise<void> | null = null
  let loadPresetInflight = new Map<string, Promise<void>>()

  async function loadIndexFromServer(): Promise<void> {
    if (loaded.value) return
    if (loadIndexInflight) return loadIndexInflight
    loadIndexInflight = (async () => {
      if (loaded.value) return
      loading.value = true
      lastError.value = null
      try {
        const res = await fetch('/api/prompts')
        if (!res.ok) {
          throw new Error(`GET /api/prompts ${res.status}`)
        }
        const raw: unknown = await res.json()
        const fromServer =
          raw === null
            ? null
            : normalizeIndexResponse(raw as PromptsIndexResponse)
        if (fromServer) {
          indexEntries.value = fromServer.presets
          activePresetId.value = fromServer.activePresetId
          presetBodies.value = {}
          loaded.value = true
          return
        }
        indexEntries.value = []
        activePresetId.value = ''
        presetBodies.value = {}
        loaded.value = true
        lastError.value = 'prompts_not_initialized'
      } catch (e) {
        lastError.value = e instanceof Error ? e.message : String(e)
      } finally {
        loading.value = false
      }
    })().finally(() => {
      loadIndexInflight = null
    })
    return loadIndexInflight
  }

  async function loadPresetFromServer(
    presetId: string,
    opts?: { force?: boolean },
  ): Promise<void> {
    if (!opts?.force && presetBodies.value[presetId]) return
    const cacheKey = `${presetId}:${opts?.force ? '1' : '0'}`
    let inflight = loadPresetInflight.get(cacheKey)
    if (!inflight) {
      inflight = (async () => {
        if (!opts?.force && presetBodies.value[presetId]) return
        presetDetailLoading.value = true
        try {
          const res = await fetch(
            `/api/prompts/${encodeURIComponent(presetId)}`,
          )
          if (!res.ok) {
            throw new Error(`GET /api/prompts/${presetId} ${res.status}`)
          }
          const raw: unknown = await res.json()
          const p = normalizePresetPayload(raw)
          if (p) setPresetBody(p)
        } finally {
          presetDetailLoading.value = false
          loadPresetInflight.delete(cacheKey)
        }
      })()
      loadPresetInflight.set(cacheKey, inflight)
    }
    return inflight
  }

  async function ensurePresetLoaded(
    presetId: string,
    opts?: { force?: boolean },
  ): Promise<void> {
    await loadPresetFromServer(presetId, opts)
  }

  async function loadFromServer(opts?: { forceActive?: boolean }): Promise<void> {
    await loadIndexFromServer()
    if (!loaded.value || !activePresetId.value) return
    await loadPresetFromServer(activePresetId.value, {
      force: opts?.forceActive,
    })
  }

  let loadInflight: Promise<void> | null = null

  async function loadEditorFromServer(): Promise<void> {
    if (loadInflight) return loadInflight
    loadInflight = loadFromServer({ forceActive: true }).finally(() => {
      loadInflight = null
    })
    return loadInflight
  }

  watch(
    () => presetBodies.value[activePresetId.value],
    () => scheduleSave(),
    { deep: true, flush: 'post' },
  )

  /** ====== preset ====== */
  const activePreset = computed<PromptPreset>(() => {
    const p = presetBodies.value[activePresetId.value]
    if (p) return p
    const e = indexEntries.value.find((x) => x.id === activePresetId.value)
    if (e) return stubPresetFromIndex(e)
    const first = indexEntries.value[0]
    if (first) return stubPresetFromIndex(first)
    return EMPTY_PRESET
  })

  const activeGroups = computed<PromptGroup[]>(() =>
    activePreset.value.groups.slice().sort((a, b) => a.order - b.order),
  )

  const activePrompts = computed<PromptEntry[]>(
    () => activePreset.value.prompts,
  )

  function patchActivePreset(patch: (p: PromptPreset) => PromptPreset) {
    const cur = presetBodies.value[activePresetId.value]
    if (!cur) return
    setPresetBody({ ...patch(cur), updatedAt: nowIso() })
  }

  function createPreset(name: string): PromptPreset {
    const t = nowIso()
    const preset = normalizePreset({
      id: makeId(presetBodies.value),
      name: name.trim() || 'Untitled preset',
      groups: buildDefaultGroups(),
      prompts: [],
      createdAt: t,
      updatedAt: t,
    })
    setPresetBody(preset)
    activePresetId.value = preset.id
    selectedPromptId.value = null
    activeGroupId.value = null
    scheduleIndexPatch()
    pendingSave = true
    void flushPending()
    return preset
  }

  async function duplicatePreset(presetId: string): Promise<PromptPreset | null> {
    await ensurePresetLoaded(presetId)
    const src = presetBodies.value[presetId]
    if (!src) return null
    const t = nowIso()
    const copy = normalizePreset({
      ...src,
      id: makeId(presetBodies.value),
      name: `${src.name} (copy)`,
      groups: src.groups.map((g) => ({ ...g })),
      prompts: src.prompts.map((p) => ({
        ...p,
        tags: p.tags.slice(),
        triggers: p.triggers.slice(),
      })),
      createdAt: t,
      updatedAt: t,
    })
    setPresetBody(copy)
    activePresetId.value = copy.id
    scheduleIndexPatch()
    pendingSave = true
    void flushPending()
    return copy
  }

  /** ====== 导入/导出 ====== */

  /** 导出文件包装版本号；后续若结构变了递增 */
  const EXPORT_SCHEMA_PRESET = 'arousal-prompts-preset@1'

  interface ExportedSinglePreset {
    schema: typeof EXPORT_SCHEMA_PRESET
    exportedAt: string
    preset: PromptPreset
  }

  /** 导出当前激活预设为可下载的 JSON 文本 */
  function exportActivePreset(): { json: string; filename: string } {
    const p = activePreset.value
    const wrapper: ExportedSinglePreset = {
      schema: EXPORT_SCHEMA_PRESET,
      exportedAt: nowIso(),
      preset: p,
    }
    const safeName =
      (p.name || 'preset').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) ||
      'preset'
    return {
      json: JSON.stringify(wrapper, null, 2),
      filename: `${safeName}.preset.json`,
    }
  }

  function isPromptPresetShape(x: unknown): x is PromptPreset {
    if (!x || typeof x !== 'object') return false
    const o = x as Partial<PromptPreset>
    return (
      typeof o.id === 'string' &&
      Array.isArray(o.groups) &&
      Array.isArray(o.prompts)
    )
  }

  function uniquePresetName(base: string): string {
    const taken = new Set(indexEntries.value.map((p) => p.name))
    if (!taken.has(base)) return base
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base} (${i})`
      if (!taken.has(candidate)) return candidate
    }
    return `${base} (${Date.now()})`
  }

  /**
   * 解析任意支持的导入 JSON：
   * - { schema: 'arousal-prompts-preset@1', preset }
   * - { schema: 'arousal-prompts-bundle@1', presets }
   * - 裸 PromptPreset
   * - 裸 PromptPreset[] 数组
   */
  function extractPresetsFromImport(raw: unknown): PromptPreset[] {
    if (!raw) return []
    if (Array.isArray(raw)) {
      return raw.filter(isPromptPresetShape)
    }
    if (typeof raw !== 'object') return []
    const obj = raw as {
      preset?: unknown
      presets?: unknown
    }
    if (Array.isArray(obj.presets)) {
      return obj.presets.filter(isPromptPresetShape)
    }
    if (isPromptPresetShape(obj.preset)) {
      return [obj.preset]
    }
    if (isPromptPresetShape(raw)) {
      return [raw]
    }
    return []
  }

  /**
   * 导入文本（JSON）。
   * - 给每个导入的预设重新生成 id（避免与现有冲突）
   * - name 冲突时自动加 " (imported)" 或 " (N)"
   * - 导入后切到第一个新预设
   * 返回新预设 id 列表；任何错误抛 Error。
   */
  function importPresetsFromJson(text: string): string[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(
        `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
      )
    }
    const candidates = extractPresetsFromImport(parsed)
    if (candidates.length === 0) {
      throw new Error('文件中未找到有效的提示词预设')
    }
    const t = nowIso()
    const fresh: PromptPreset[] = []
    for (const src of candidates) {
      fresh.push(
        normalizePreset({
          id: makeId(presetBodies.value),
          name: uniquePresetName(
            (typeof src.name === 'string' && src.name.trim()
              ? src.name.trim()
              : 'Imported preset') + ' (imported)',
          ),
          groups: src.groups.map((g) => ({ ...g })),
          prompts: src.prompts.map((p) => ({
            ...p,
            tags: Array.isArray(p.tags) ? p.tags.slice() : [],
            triggers: Array.isArray(p.triggers) ? p.triggers.slice() : [],
          })),
          createdAt: t,
          updatedAt: t,
        }),
      )
    }
    for (const p of fresh) setPresetBody(p)
    activePresetId.value = fresh[0].id
    selectedPromptId.value = null
    activeGroupId.value = null
    scheduleIndexPatch()
    pendingSave = true
    void flushPending()
    return fresh.map((p) => p.id)
  }

  /** 追加一条提示词预设的深拷贝（新 id），不改变当前全局激活的提示词预设；供 API 预设导入等使用 */
  function appendPromptPresetCopy(src: PromptPreset): string {
    const t = nowIso()
    const copy = normalizePreset({
      id: makeId(presetBodies.value),
      name: uniquePresetName(
        (typeof src.name === 'string' && src.name.trim()
          ? src.name.trim()
          : 'Imported preset') + ' (imported)',
      ),
      groups: src.groups.map((g) => ({ ...g })),
      prompts: src.prompts.map((p) => ({
        ...p,
        tags: Array.isArray(p.tags) ? p.tags.slice() : [],
        triggers: Array.isArray(p.triggers) ? p.triggers.slice() : [],
      })),
      createdAt: t,
      updatedAt: t,
    })
    setPresetBody(copy)
    scheduleIndexPatch()
    pendingSave = true
    void flushPending()
    return copy.id
  }

  function renamePreset(presetId: string, name: string) {
    const body = presetBodies.value[presetId]
    if (body) {
      setPresetBody({
        ...body,
        name: name.trim() || 'Untitled preset',
        updatedAt: nowIso(),
      })
      scheduleSave()
      return
    }
    const idx = indexEntries.value.findIndex((p) => p.id === presetId)
    if (idx < 0) return
    const next = indexEntries.value.slice()
    next[idx] = {
      ...next[idx],
      name: name.trim() || 'Untitled preset',
      updatedAt: nowIso(),
    }
    indexEntries.value = next
    scheduleIndexPatch()
  }

  async function deletePreset(presetId: string): Promise<void> {
    if (indexEntries.value.length <= 1) return
    try {
      const res = await fetch(
        `/api/prompts/${encodeURIComponent(presetId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`DELETE /api/prompts/${presetId} ${res.status}: ${txt}`)
      }
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      return
    }
    indexEntries.value = indexEntries.value.filter((p) => p.id !== presetId)
    const { [presetId]: _drop, ...rest } = presetBodies.value
    presetBodies.value = rest
    if (activePresetId.value === presetId) {
      activePresetId.value = indexEntries.value[0]?.id ?? ''
      selectedPromptId.value = null
      activeGroupId.value = null
      if (activePresetId.value) {
        void loadPresetFromServer(activePresetId.value)
      }
    }
  }

  /**
   * 仅切换全局激活 id（供 API 预设关联等）；不拉取预设正文。
   * persist 为 true 时写入服务端 index（组装管线读盘用）。
   */
  async function setActivePresetId(
    presetId: string,
    opts?: { persist?: boolean },
  ): Promise<void> {
    if (!indexEntries.value.some((p) => p.id === presetId)) return
    if (activePresetId.value === presetId) {
      if (opts?.persist && loaded.value) await persistActivePresetId()
      return
    }
    activePresetId.value = presetId
    selectedPromptId.value = null
    activeGroupId.value = null
    if (opts?.persist && loaded.value) {
      try {
        await persistActivePresetId()
      } catch (e) {
        lastError.value = e instanceof Error ? e.message : String(e)
      }
    }
  }

  /** 提示词编辑页：切换预设并强制从服务端加载正文 */
  async function selectPreset(presetId: string): Promise<void> {
    if (!indexEntries.value.some((p) => p.id === presetId)) return
    if (presetId !== activePresetId.value) {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      await flushPending()
    }
    activePresetId.value = presetId
    selectedPromptId.value = null
    activeGroupId.value = null
    await loadPresetFromServer(presetId, { force: true })
    scheduleIndexPatch()
    void flushPending()
  }

  /** ====== group ====== */
  function addGroup(name: string): PromptGroup | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const groups = activePreset.value.groups
    const maxOrder = groups.reduce((m, g) => Math.max(m, g.order), -1)
    const g: PromptGroup = {
      id: makeId(presetBodies.value),
      name: trimmed,
      kind: 'normal',
      order: maxOrder + 1,
      description: '',
      enabled: true,
    }
    patchActivePreset((p) => ({ ...p, groups: [...p.groups, g] }))
    return g
  }

  function renameGroup(groupId: string, name: string) {
    patchActivePreset((p) => ({
      ...p,
      groups: p.groups.map((g) =>
        g.id === groupId ? { ...g, name: name.trim() || g.name } : g,
      ),
    }))
  }

  function updateGroup(
    groupId: string,
    patch: Partial<Pick<PromptGroup, 'name' | 'description' | 'enabled'>>,
  ) {
    patchActivePreset((p) => ({
      ...p,
      groups: p.groups.map((g) => {
        if (g.id !== groupId) return g
        const next = { ...g, ...patch }
        if (patch.name !== undefined) {
          next.name = patch.name.trim() || g.name
        }
        if (patch.description !== undefined) {
          next.description = patch.description
        }
        return next
      }),
    }))
  }

  /** 仅可删除 normal 分组（角色/世界/历史/用户输出等占位 kind 不可删；前置、后置可删） */
  function deleteGroup(groupId: string): boolean {
    const target = activePreset.value.groups.find((g) => g.id === groupId)
    if (!target || target.kind !== 'normal') return false
    patchActivePreset((p) => ({
      ...p,
      groups: p.groups.filter((g) => g.id !== groupId),
      prompts: p.prompts.filter((e) => e.groupId !== groupId),
    }))
    if (activeGroupId.value === groupId) activeGroupId.value = null
    return true
  }

  /** 左右拖曳：把 groupId 移到 targetIndex 位置（针对按 order 排序后的列表） */
  function reorderGroup(groupId: string, targetIndex: number) {
    const sorted = activeGroups.value.slice()
    const fromIdx = sorted.findIndex((g) => g.id === groupId)
    if (fromIdx === -1) return
    const [moved] = sorted.splice(fromIdx, 1)
    const clamped = Math.max(0, Math.min(targetIndex, sorted.length))
    sorted.splice(clamped, 0, moved)
    const reordered = sorted.map((g, i) => ({ ...g, order: i }))
    patchActivePreset((p) => ({ ...p, groups: reordered }))
  }

  /** ====== prompt entry ====== */
  function createPrompt(
    groupId: string,
    partial?: Partial<PromptEntry>,
  ): PromptEntry {
    const t = nowIso()
    const sameGroup = activePreset.value.prompts.filter(
      (p) => p.groupId === groupId,
    )
    const maxOrder = sameGroup.reduce((m, p) => Math.max(m, p.order), -1)
    const entry: PromptEntry = {
      id: makeId(presetBodies.value),
      groupId,
      title: '',
      content: '',
      description: '',
      tags: [],
      enabled: true,
      role: 'system',
      injectionPosition: 'relative',
      injectionDepth: 0,
      injectionOrder: 100,
      triggers: [],
      order: maxOrder + 1,
      isSeed: false,
      createdAt: t,
      updatedAt: t,
      ...partial,
    }
    patchActivePreset((p) => ({ ...p, prompts: [...p.prompts, entry] }))
    selectedPromptId.value = entry.id
    return entry
  }

  function updatePrompt(
    id: string,
    patch: Partial<Omit<PromptEntry, 'id' | 'createdAt' | 'isSeed'>>,
  ) {
    const cur = activePreset.value.prompts.find((e) => e.id === id)
    let nextPatch = patch
    if (cur?.bindingSlot != null) {
      if (bindingSlotIsRequired(cur.bindingSlot)) {
        nextPatch = {}
      } else {
        nextPatch =
          patch.enabled !== undefined ? { enabled: patch.enabled } : {}
      }
    }
    patchActivePreset((p) => ({
      ...p,
      prompts: p.prompts.map((e) =>
        e.id === id ? { ...e, ...nextPatch, updatedAt: nowIso() } : e,
      ),
    }))
  }

  function deletePrompt(id: string) {
    const target = activePreset.value.prompts.find((e) => e.id === id)
    if (target?.bindingSlot) return
    patchActivePreset((p) => ({
      ...p,
      prompts: p.prompts.filter((e) => e.id !== id),
    }))
    if (selectedPromptId.value === id) selectedPromptId.value = null
  }

  function duplicatePrompt(
    id: string,
    targetGroupId?: string,
  ): PromptEntry | null {
    const src = activePreset.value.prompts.find((e) => e.id === id)
    if (!src || src.bindingSlot) return null
    const gid = targetGroupId?.trim() || src.groupId
    const targetGroup = activePreset.value.groups.find((g) => g.id === gid)
    if (!targetGroup || !groupAllowsPromptEntries(targetGroup.kind)) return null

    const t = nowIso()
    const inTarget = activePreset.value.prompts.filter((p) => p.groupId === gid)
    const maxOrder = inTarget.reduce((m, p) => Math.max(m, p.order), -1)
    const copy: PromptEntry = {
      ...src,
      id: makeId(presetBodies.value),
      groupId: gid,
      title: src.title ? `${src.title} (副本)` : '',
      tags: src.tags.slice(),
      triggers: src.triggers.slice(),
      isSeed: false,
      order: maxOrder + 1,
      createdAt: t,
      updatedAt: t,
    }
    patchActivePreset((p) => ({ ...p, prompts: [...p.prompts, copy] }))
    activeGroupId.value = gid
    selectedPromptId.value = copy.id
    return copy
  }

  function movePromptToGroup(id: string, targetGroupId: string): boolean {
    const src = activePreset.value.prompts.find((e) => e.id === id)
    if (!src || src.bindingSlot) return false
    const gid = targetGroupId.trim()
    const targetGroup = activePreset.value.groups.find((g) => g.id === gid)
    if (!targetGroup || !groupAllowsPromptEntries(targetGroup.kind)) return false

    const targetLen = activePreset.value.prompts.filter(
      (p) => p.groupId === gid && p.id !== id,
    ).length
    reorderPrompt(id, gid, targetLen)
    activeGroupId.value = gid
    selectedPromptId.value = id
    return true
  }

  /**
   * 上下拖曳：把条目 id 移动到 targetGroupId 的第 targetIndex 个位置。
   * 支持跨分组（目标分组须为 normal / character / history）。
   */
  function reorderPrompt(
    id: string,
    targetGroupId: string,
    targetIndex: number,
  ) {
    const list = activePreset.value.prompts
    const moved = list.find((e) => e.id === id)
    if (!moved) return
    const targetGroup = activePreset.value.groups.find(
      (g) => g.id === targetGroupId,
    )
    if (!targetGroup || !groupAllowsPromptEntries(targetGroup.kind)) return
    if (
      moved.bindingSlot === 'boundCharacterSystem' &&
      targetGroup.kind !== 'character'
    ) {
      return
    }
    if (
      moved.bindingSlot === 'boundCharacterPostHistory' &&
      targetGroup.kind !== 'history'
    ) {
      return
    }
    if (moved.bindingSlot === 'boundWorld' && targetGroup.kind !== 'world') {
      return
    }
    if (
      moved.bindingSlot === 'boundUserInput' &&
      targetGroup.kind !== 'userInput'
    ) {
      return
    }

    const targetList = list
      .filter((e) => e.groupId === targetGroupId && e.id !== id)
      .slice()
      .sort((a, b) => a.order - b.order)
    const clamped = Math.max(0, Math.min(targetIndex, targetList.length))
    targetList.splice(clamped, 0, { ...moved, groupId: targetGroupId })
    const reorderedTarget = targetList.map((e, i) => ({ ...e, order: i }))

    const fromGroupId = moved.groupId
    let updated = list
    if (fromGroupId !== targetGroupId) {
      const fromList = list
        .filter((e) => e.groupId === fromGroupId && e.id !== id)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((e, i) => ({ ...e, order: i }))
      updated = updated
        .filter(
          (e) => e.groupId !== fromGroupId && e.groupId !== targetGroupId,
        )
        .concat(fromList, reorderedTarget)
    } else {
      updated = updated
        .filter((e) => e.groupId !== targetGroupId)
        .concat(reorderedTarget)
    }
    patchActivePreset((p) => ({ ...p, prompts: updated }))
  }

  /** ====== selectors / search ====== */
  function selectPrompt(id: string | null) {
    selectedPromptId.value = id
    if (id) {
      const e = activePrompts.value.find((p) => p.id === id)
      if (e) activeGroupId.value = e.groupId
    }
  }

  function selectGroup(id: string | null) {
    activeGroupId.value = id
    const cur = selectedPromptId.value
      ? activePrompts.value.find((p) => p.id === selectedPromptId.value)
      : null
    if (!cur || cur.groupId !== id) {
      selectedPromptId.value = null
    }
  }

  function firstNormalGroupId(groups: PromptGroup[]): string | null {
    const sorted = groups.slice().sort((a, b) => a.order - b.order)
    const normal = sorted.find((g) => g.kind === 'normal')
    return normal?.id ?? sorted[0]?.id ?? null
  }

  async function focusPresetById(presetId: string): Promise<boolean> {
    if (!indexEntries.value.some((p) => p.id === presetId)) return false
    await selectPreset(presetId)
    const gid = firstNormalGroupId(activePreset.value.groups)
    selectGroup(gid)
    selectedPromptId.value = null
    searchText.value = ''
    return true
  }

  /**
   * 打开提示词库时：选中对话关联预设（或优先 id），并定位到第一个 normal 分组。
   */
  async function applyOpenFocus(
    conversationPresetId: string | null,
    preferredPresetId?: string | null,
  ): Promise<void> {
    await loadEditorFromServer()
    const candidates: string[] = []
    const add = (raw: string | null | undefined) => {
      const id = typeof raw === 'string' ? raw.trim() : ''
      if (id && !candidates.includes(id)) candidates.push(id)
    }
    add(preferredPresetId)
    add(conversationPresetId)
    add(activePresetId.value)
    for (const e of indexEntries.value) add(e.id)
    for (const id of candidates) {
      if (await focusPresetById(id)) return
    }
  }

  function setSearchText(s: string) {
    searchText.value = s
  }

  const selected = computed<PromptEntry | null>(() => {
    if (!selectedPromptId.value) return null
    return (
      activePrompts.value.find((e) => e.id === selectedPromptId.value) ?? null
    )
  })

  /** 当前 activeGroupId 过滤；null = 所有可编辑条目分组合并；含 search */
  const visiblePrompts = computed<PromptEntry[]>(() => {
    const q = searchText.value.trim().toLowerCase()
    const groups = activeGroups.value
    const entryGroupIds = new Set(
      groups.filter((g) => groupAllowsPromptEntries(g.kind)).map((g) => g.id),
    )
    return activePrompts.value
      .filter((e) => entryGroupIds.has(e.groupId))
      .filter((e) =>
        activeGroupId.value ? e.groupId === activeGroupId.value : true,
      )
      .filter((e) => {
        if (!q) return true
        if (
          e.bindingSlot === 'boundCharacterSystem' &&
          (q.includes('system') ||
            q.includes('绑定') ||
            q.includes('角色') ||
            q.includes('设定'))
        ) {
          return true
        }
        if (
          e.bindingSlot === 'boundWorld' &&
          (q.includes('world') || q.includes('lore') || q.includes('世界'))
        ) {
          return true
        }
        if (
          e.bindingSlot === 'boundCharacterPostHistory' &&
          (q.includes('post') ||
            q.includes('历史') ||
            q.includes('jailbreak') ||
            q.includes('后置'))
        ) {
          return true
        }
        if (
          e.bindingSlot === 'boundUserInput' &&
          (q.includes('user') || q.includes('input') || q.includes('用户'))
        ) {
          return true
        }
        return (
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => {
        const ga = groups.find((g) => g.id === a.groupId)?.order ?? 0
        const gb = groups.find((g) => g.id === b.groupId)?.order ?? 0
        if (ga !== gb) return ga - gb
        return a.order - b.order
      })
  })

  /** 每个分组的条目数（含禁用） */
  const groupCounts = computed<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const g of activeGroups.value) m[g.id] = 0
    for (const e of activePrompts.value) {
      if (e.groupId in m) m[e.groupId]++
    }
    return m
  })

  return {
    presets,
    activePresetId,
    activePreset,
    activeGroups,
    activePrompts,
    selectedPromptId,
    activeGroupId,
    searchText,
    selected,
    visiblePrompts,
    groupCounts,

    setActivePresetId,
    selectPreset,
    createPreset,
    duplicatePreset,
    renamePreset,
    deletePreset,
    exportActivePreset,
    importPresetsFromJson,
    appendPromptPresetCopy,

    addGroup,
    renameGroup,
    updateGroup,
    deleteGroup,
    reorderGroup,
    selectGroup,

    createPrompt,
    updatePrompt,
    deletePrompt,
    duplicatePrompt,
    movePromptToGroup,
    reorderPrompt,
    selectPrompt,

    setSearchText,

    indexEntries,
    presetBodies,
    activePresetReady,
    presetDetailLoading,

    loaded,
    loading,
    saving,
    lastSavedAt,
    lastError,
    loadIndexFromServer,
    loadPresetFromServer,
    ensurePresetLoaded,
    loadFromServer,
    loadEditorFromServer,
    applyOpenFocus,
    flushSave,
  }
})
