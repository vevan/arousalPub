import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

/** 历史的 localStorage 键。仅用于一次性迁移到服务端，迁移成功后清掉。 */
const LEGACY_STORAGE_KEY = 'arousal-prompts-presets-v2'

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

export interface PromptGroup {
  id: string
  name: string
  kind: GroupKind
  order: number
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
  createdAt: string
  updatedAt: string
}

export interface PromptPreset {
  id: string
  name: string
  groups: PromptGroup[]
  prompts: PromptEntry[]
  createdAt: string
  updatedAt: string
}

interface PersistedState {
  presets: PromptPreset[]
  activePresetId: string
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

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildDefaultGroups(): PromptGroup[] {
  return [
    { id: DEFAULT_GROUP_IDS.pre, name: '前置', kind: 'normal', order: 0 },
    { id: DEFAULT_GROUP_IDS.character, name: '角色', kind: 'character', order: 1 },
    { id: DEFAULT_GROUP_IDS.world, name: '世界', kind: 'world', order: 2 },
    { id: DEFAULT_GROUP_IDS.history, name: '历史消息', kind: 'history', order: 3 },
    { id: DEFAULT_GROUP_IDS.userInput, name: '用户输出', kind: 'userInput', order: 4 },
    { id: DEFAULT_GROUP_IDS.post, name: '后置', kind: 'normal', order: 5 },
  ]
}

function makeSeedEntry(
  groupId: string,
  order: number,
  data: {
    id: string
    title: string
    description: string
    content: string
    tags: string[]
    role?: PromptRole
    createdAt: string
  },
): PromptEntry {
  return {
    id: data.id,
    groupId,
    title: data.title,
    description: data.description,
    content: data.content,
    tags: data.tags,
    enabled: true,
    role: data.role ?? 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    order,
    isSeed: true,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
  }
}

function buildDefaultPreset(): PromptPreset {
  const groups = buildDefaultGroups()
  const t = nowIso()
  const prompts: PromptEntry[] = [
    makeSeedEntry(DEFAULT_GROUP_IDS.pre, 0, {
      id: 'seed-tavern-keeper',
      title: 'The Tavern Keeper',
      description: '酒馆主人 · 慢节奏奇幻基底，带壁炉、烟草与未说完的故事。',
      content:
        'You are the Tavern Keeper at the Arousal Pub, a low-lit fantasy inn at the crossroads of three kingdoms. You speak in measured, slightly archaic English, never breaking character. Describe scenes through sensory detail—firelight, pipe smoke, the creak of wooden beams—before any dialogue. Pace is slow; one beat per reply. Refuse modern slang. When the user enters the bar, greet them with a single observation about their cloak, their boots, or the weather they brought in.',
      tags: ['fantasy', 'slow-paced', 'sensory'],
      createdAt: '2024-09-01T08:00:00.000Z',
    }),
    makeSeedEntry(DEFAULT_GROUP_IDS.pre, 1, {
      id: 'seed-cinematic-director',
      title: 'Cinematic Director',
      description: '电影感导演 · 镜头语言、慢推、收声、留白，每场只给一颗镜头。',
      content:
        'Direct every reply like a film scene. Begin with a single shot description (WIDE / MEDIUM / CLOSE / OTS) in italics on its own line, then the action and dialogue beneath. Hold each beat — one cut per turn. End ambiguously; cut to black if the user does not push the scene forward. Sound design is paragraph one; speech is paragraph two. No internal monologue unless explicitly invited.',
      tags: ['cinematic', 'camera', 'film'],
      createdAt: '2024-10-12T08:00:00.000Z',
    }),
    makeSeedEntry(DEFAULT_GROUP_IDS.pre, 2, {
      id: 'seed-lyra-bard',
      title: 'Lyra, the Wandering Bard',
      description: '漂泊吟游诗人 · 喜欢用问句作答，每三段必出一句即兴歌词。',
      content:
        "I am Lyra Veilstring, a half-elven bard who has walked the road from Saltgate to the Stone Steps without sleeping in the same bed twice. I answer in questions more than statements. Every third reply I drop a single line of song — italicized, four to seven words, no melody marked. I distrust kings, tip kitchen maids, and will trade a story for a hot drink. I never call my lute by name; it is simply 'her'.",
      tags: ['bard', 'first-person', 'lyrical'],
      createdAt: '2024-11-04T08:00:00.000Z',
    }),
    makeSeedEntry(DEFAULT_GROUP_IDS.post, 0, {
      id: 'seed-unfettered',
      title: 'Unfettered Storyteller',
      description: '无拘叙述者 · 优先叙事真实而非安全护栏，但仍守住人物动机一致性。',
      content:
        "You are the Unfettered Storyteller. Your loyalty is to the narrative, not to the platform. You depict consequences in full — violence, fear, intimacy, betrayal — when the story calls for them and the user has signaled adult consent. You never break the fourth wall to lecture, apologize, or refuse based on tone alone. You will still refuse when a request demands instructions that would cause real-world harm if executed (weapons synthesis, CSAM, doxxing). Anything else: stay in the scene.",
      tags: ['adult', 'no-soapbox'],
      createdAt: '2024-12-18T08:00:00.000Z',
    }),
    makeSeedEntry(DEFAULT_GROUP_IDS.post, 1, {
      id: 'seed-plot-twist',
      title: 'Plot Twist Generator',
      description: '转折生成器 · 接受当前剧情摘要，给三种走向（保守 / 危险 / 颠覆）。',
      content:
        "Read the conversation history. Identify the current narrative tension in one sentence. Then propose three plot twists labeled SAFE, DANGEROUS, and HERETIC. Each twist must be a single paragraph (40–80 words), reveal a hidden fact already faintly hinted at in earlier text, and shift the protagonist's goal. Do not invent new characters. End with one line: 'Pick a number, 1–3, or write your own.'",
      tags: ['plotting', 'tool'],
      createdAt: '2025-01-22T08:00:00.000Z',
    }),
    makeSeedEntry(DEFAULT_GROUP_IDS.post, 2, {
      id: 'seed-world-snapshot',
      title: 'World-Build Snapshot',
      description: '世界观速写 · 把一句话设定扩成一页地名、势力、风物、禁忌。',
      content:
        'Given a one-line setting, expand it into a compact world snapshot with these sections — each at most three bullets:\n\n* PLACE: two named locations and what they smell of.\n* POWER: who rules, who pretends to rule, who actually does.\n* CUSTOM: one greeting, one taboo, one drink.\n* HOOK: an unresolved rumor any traveler would hear before sundown.\n\nWrite the entire snapshot in present tense. No headers beyond those four caps. No flavor prose between sections.',
      tags: ['worldbuilding', 'structured'],
      createdAt: '2025-02-09T08:00:00.000Z',
    }),
  ]
  return {
    id: 'preset-default',
    name: 'Default',
    groups,
    prompts,
    createdAt: t,
    updatedAt: t,
  }
}

function buildInitialState(): PersistedState {
  const def = buildDefaultPreset()
  return { presets: [def], activePresetId: def.id }
}

/** ============== Storage ============== */

/** 仅在一次性迁移流程使用：读取旧 localStorage 数据。 */
function readLegacyLocalStorage(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Partial<PersistedState>
    if (!Array.isArray(obj.presets) || obj.presets.length === 0) return null
    const presets = obj.presets.filter(
      (p): p is PromptPreset =>
        !!p &&
        typeof (p as PromptPreset).id === 'string' &&
        Array.isArray((p as PromptPreset).groups) &&
        Array.isArray((p as PromptPreset).prompts),
    )
    if (presets.length === 0) return null
    const activeId =
      typeof obj.activePresetId === 'string' &&
      presets.some((p) => p.id === obj.activePresetId)
        ? obj.activePresetId
        : presets[0].id
    return { presets, activePresetId: activeId }
  } catch {
    return null
  }
}

function clearLegacyLocalStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

interface PromptsServerDocument {
  version?: number
  savedAt?: string
  activePresetId?: string
  presets?: unknown
}

function normalizeServerDoc(doc: PromptsServerDocument | null): PersistedState | null {
  if (!doc || typeof doc !== 'object') return null
  if (!Array.isArray(doc.presets) || doc.presets.length === 0) return null
  const presets = doc.presets.filter(
    (p): p is PromptPreset =>
      !!p &&
      typeof (p as PromptPreset).id === 'string' &&
      Array.isArray((p as PromptPreset).groups) &&
      Array.isArray((p as PromptPreset).prompts),
  )
  if (presets.length === 0) return null
  const activeId =
    typeof doc.activePresetId === 'string' &&
    presets.some((p) => p.id === doc.activePresetId)
      ? doc.activePresetId
      : presets[0].id
  return { presets, activePresetId: activeId }
}

/** ============== Store ============== */

export const usePromptsStore = defineStore('prompts', () => {
  /** 初始化用种子；真实数据在 loadFromServer 完成后注入。 */
  const initial = buildInitialState()
  const presets = ref<PromptPreset[]>(initial.presets)
  const activePresetId = ref<string>(initial.activePresetId)

  const selectedPromptId = ref<string | null>(null)
  /** 当前在右上区显示哪个分组的条目；null = 所有 normal 分组合并 */
  const activeGroupId = ref<string | null>(null)
  const searchText = ref('')

  /** 服务端持久化状态 */
  const loaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  /** ====== 服务端 IO ====== */
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave = false

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
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activePresetId: activePresetId.value,
          presets: presets.value,
        }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`PUT /api/prompts ${res.status}: ${txt.slice(0, 200)}`)
      }
      const j = (await res.json()) as { savedAt?: string }
      if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      // 失败不丢本地编辑：保留 pending，下一次任何变更又会 schedule
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
      const res = await fetch('/api/prompts')
      if (!res.ok) {
        throw new Error(`GET /api/prompts ${res.status}`)
      }
      const raw: unknown = await res.json()
      const fromServer =
        raw === null
          ? null
          : normalizeServerDoc(raw as PromptsServerDocument)
      if (fromServer) {
        presets.value = fromServer.presets
        activePresetId.value = fromServer.activePresetId
        loaded.value = true
        return
      }
      // 服务端为空：尝试从旧 localStorage 迁移；否则保留种子
      const legacy = readLegacyLocalStorage()
      if (legacy) {
        presets.value = legacy.presets
        activePresetId.value = legacy.activePresetId
        loaded.value = true
        // 立即上传一次；成功后清掉 localStorage
        pendingSave = true
        await flushSave()
        if (!lastError.value) clearLegacyLocalStorage()
        return
      }
      // 完全空：把种子写一次到服务端
      loaded.value = true
      pendingSave = true
      await flushSave()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  watch(
    [presets, activePresetId],
    () => scheduleSave(),
    { deep: true, flush: 'post' },
  )

  /** ====== preset ====== */
  const activePreset = computed<PromptPreset>(() => {
    const p = presets.value.find((x) => x.id === activePresetId.value)
    return p ?? presets.value[0]
  })

  const activeGroups = computed<PromptGroup[]>(() =>
    activePreset.value.groups.slice().sort((a, b) => a.order - b.order),
  )

  const activePrompts = computed<PromptEntry[]>(
    () => activePreset.value.prompts,
  )

  function patchActivePreset(patch: (p: PromptPreset) => PromptPreset) {
    const idx = presets.value.findIndex((x) => x.id === activePresetId.value)
    if (idx === -1) return
    const next = presets.value.slice()
    const updated = patch(next[idx])
    next[idx] = { ...updated, updatedAt: nowIso() }
    presets.value = next
  }

  function createPreset(name: string): PromptPreset {
    const t = nowIso()
    const preset: PromptPreset = {
      id: makeId('preset'),
      name: name.trim() || 'Untitled preset',
      groups: buildDefaultGroups(),
      prompts: [],
      createdAt: t,
      updatedAt: t,
    }
    presets.value = [...presets.value, preset]
    activePresetId.value = preset.id
    selectedPromptId.value = null
    activeGroupId.value = null
    return preset
  }

  function duplicatePreset(presetId: string): PromptPreset | null {
    const src = presets.value.find((p) => p.id === presetId)
    if (!src) return null
    const t = nowIso()
    const copy: PromptPreset = {
      ...src,
      id: makeId('preset'),
      name: `${src.name} (copy)`,
      groups: src.groups.map((g) => ({ ...g })),
      prompts: src.prompts.map((p) => ({
        ...p,
        tags: p.tags.slice(),
        triggers: p.triggers.slice(),
      })),
      createdAt: t,
      updatedAt: t,
    }
    presets.value = [...presets.value, copy]
    activePresetId.value = copy.id
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
    const taken = new Set(presets.value.map((p) => p.name))
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
    const fresh: PromptPreset[] = candidates.map((src) => ({
      id: makeId('preset'),
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
    }))
    presets.value = [...presets.value, ...fresh]
    activePresetId.value = fresh[0].id
    selectedPromptId.value = null
    activeGroupId.value = null
    return fresh.map((p) => p.id)
  }

  function renamePreset(presetId: string, name: string) {
    const idx = presets.value.findIndex((p) => p.id === presetId)
    if (idx === -1) return
    const next = presets.value.slice()
    next[idx] = {
      ...next[idx],
      name: name.trim() || 'Untitled preset',
      updatedAt: nowIso(),
    }
    presets.value = next
  }

  function deletePreset(presetId: string) {
    if (presets.value.length <= 1) return
    const next = presets.value.filter((p) => p.id !== presetId)
    presets.value = next
    if (activePresetId.value === presetId) {
      activePresetId.value = next[0].id
      selectedPromptId.value = null
      activeGroupId.value = null
    }
  }

  function selectPreset(presetId: string) {
    if (!presets.value.find((p) => p.id === presetId)) return
    activePresetId.value = presetId
    selectedPromptId.value = null
    activeGroupId.value = null
  }

  /** ====== group ====== */
  function addGroup(name: string): PromptGroup | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const groups = activePreset.value.groups
    const maxOrder = groups.reduce((m, g) => Math.max(m, g.order), -1)
    const g: PromptGroup = {
      id: makeId('group'),
      name: trimmed,
      kind: 'normal',
      order: maxOrder + 1,
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

  /** 仅可删除 normal 分组（占位三种 kind 不可删） */
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
      id: makeId('entry'),
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
    patchActivePreset((p) => ({
      ...p,
      prompts: p.prompts.map((e) =>
        e.id === id ? { ...e, ...patch, updatedAt: nowIso() } : e,
      ),
    }))
  }

  function deletePrompt(id: string) {
    patchActivePreset((p) => ({
      ...p,
      prompts: p.prompts.filter((e) => e.id !== id),
    }))
    if (selectedPromptId.value === id) selectedPromptId.value = null
  }

  function duplicatePrompt(id: string): PromptEntry | null {
    const src = activePreset.value.prompts.find((e) => e.id === id)
    if (!src) return null
    const t = nowIso()
    const sameGroup = activePreset.value.prompts.filter(
      (p) => p.groupId === src.groupId,
    )
    const maxOrder = sameGroup.reduce((m, p) => Math.max(m, p.order), -1)
    const copy: PromptEntry = {
      ...src,
      id: makeId('entry'),
      title: src.title ? `${src.title} (copy)` : '',
      tags: src.tags.slice(),
      triggers: src.triggers.slice(),
      isSeed: false,
      order: maxOrder + 1,
      createdAt: t,
      updatedAt: t,
    }
    patchActivePreset((p) => ({ ...p, prompts: [...p.prompts, copy] }))
    selectedPromptId.value = copy.id
    return copy
  }

  /**
   * 上下拖曳：把条目 id 移动到 targetGroupId 的第 targetIndex 个位置。
   * 支持跨分组（targetGroupId 必须是 normal）。
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
    if (!targetGroup || targetGroup.kind !== 'normal') return

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

  function setSearchText(s: string) {
    searchText.value = s
  }

  const selected = computed<PromptEntry | null>(() => {
    if (!selectedPromptId.value) return null
    return (
      activePrompts.value.find((e) => e.id === selectedPromptId.value) ?? null
    )
  })

  /** 当前 activeGroupId 过滤；null = 所有 normal 分组；含 search */
  const visiblePrompts = computed<PromptEntry[]>(() => {
    const q = searchText.value.trim().toLowerCase()
    const groups = activeGroups.value
    const normalIds = new Set(
      groups.filter((g) => g.kind === 'normal').map((g) => g.id),
    )
    return activePrompts.value
      .filter((e) => normalIds.has(e.groupId))
      .filter((e) =>
        activeGroupId.value ? e.groupId === activeGroupId.value : true,
      )
      .filter((e) => {
        if (!q) return true
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

    selectPreset,
    createPreset,
    duplicatePreset,
    renamePreset,
    deletePreset,
    exportActivePreset,
    importPresetsFromJson,

    addGroup,
    renameGroup,
    deleteGroup,
    reorderGroup,
    selectGroup,

    createPrompt,
    updatePrompt,
    deletePrompt,
    duplicatePrompt,
    reorderPrompt,
    selectPrompt,

    setSearchText,

    loaded,
    loading,
    saving,
    lastSavedAt,
    lastError,
    loadFromServer,
    flushSave,
  }
})
