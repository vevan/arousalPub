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

function collectAllPromptIds(presets: PromptPreset[]): Set<string> {
  const used = new Set<string>()
  for (const p of presets) {
    used.add(p.id)
    for (const g of p.groups) used.add(g.id)
    for (const e of p.prompts) used.add(e.id)
  }
  return used
}

function makeId(presets: PromptPreset[]): string {
  return allocateShortId(collectAllPromptIds(presets))
}

function buildDefaultGroups(): PromptGroup[] {
  return [
    { id: DEFAULT_GROUP_IDS.pre, name: 'Pre', kind: 'normal', order: 0 },
    { id: DEFAULT_GROUP_IDS.character, name: 'Character', kind: 'character', order: 1 },
    { id: DEFAULT_GROUP_IDS.world, name: 'World', kind: 'world', order: 2 },
    { id: DEFAULT_GROUP_IDS.history, name: 'History', kind: 'history', order: 3 },
    { id: DEFAULT_GROUP_IDS.userInput, name: 'User input', kind: 'userInput', order: 4 },
    { id: DEFAULT_GROUP_IDS.post, name: 'Post', kind: 'normal', order: 5 },
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

  return {
    ...rest,
    prompts,
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
    makeBindingSlotEntry(
      DEFAULT_GROUP_IDS.character,
      'boundCharacterSystem',
      0,
      { id: 'binding-slot-character-system' },
    ),
    makeBindingSlotEntry(
      DEFAULT_GROUP_IDS.world,
      'boundWorld',
      0,
      { id: 'binding-slot-world' },
    ),
    makeBindingSlotEntry(
      DEFAULT_GROUP_IDS.history,
      'boundCharacterPostHistory',
      0,
      { id: 'binding-slot-character-post-history' },
    ),
    makeBindingSlotEntry(
      DEFAULT_GROUP_IDS.userInput,
      'boundUserInput',
      0,
      { id: 'binding-slot-user-input' },
    ),
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

  let loadInflight: Promise<void> | null = null

  async function loadFromServer(): Promise<void> {
    if (loaded.value) return
    if (loadInflight) return loadInflight
    loadInflight = (async () => {
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
            : normalizeServerDoc(raw as PromptsServerDocument)
        if (fromServer) {
          presets.value = fromServer.presets.map(normalizePreset)
          activePresetId.value = fromServer.activePresetId
          loaded.value = true
          return
        }
        loaded.value = true
        pendingSave = true
        await flushSave()
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
    const preset = normalizePreset({
      id: makeId(presets.value),
      name: name.trim() || 'Untitled preset',
      groups: buildDefaultGroups(),
      prompts: [],
      createdAt: t,
      updatedAt: t,
    })
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
    const copy = normalizePreset({
      ...src,
      id: makeId(presets.value),
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
    const fresh: PromptPreset[] = candidates.map((src) =>
      normalizePreset({
        id: makeId(presets.value),
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
    presets.value = [...presets.value, ...fresh]
    activePresetId.value = fresh[0].id
    selectedPromptId.value = null
    activeGroupId.value = null
    return fresh.map((p) => p.id)
  }

  /** 追加一条提示词预设的深拷贝（新 id），不改变当前全局激活的提示词预设；供 API 预设导入等使用 */
  function appendPromptPresetCopy(src: PromptPreset): string {
    const t = nowIso()
    const copy = normalizePreset({
      id: makeId(presets.value),
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
    presets.value = [...presets.value, copy]
    return copy.id
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
      id: makeId(presets.value),
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
      id: makeId(presets.value),
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

  function duplicatePrompt(id: string): PromptEntry | null {
    const src = activePreset.value.prompts.find((e) => e.id === id)
    if (!src || src.bindingSlot) return null
    const t = nowIso()
    const sameGroup = activePreset.value.prompts.filter(
      (p) => p.groupId === src.groupId,
    )
    const maxOrder = sameGroup.reduce((m, p) => Math.max(m, p.order), -1)
    const copy: PromptEntry = {
      ...src,
      id: makeId(presets.value),
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
          (q.includes('system') || q.includes('绑定') || q.includes('角色'))
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
