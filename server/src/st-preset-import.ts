/**
 * SillyTavern OpenAI preset JSON → arousalPub PromptPreset（仅 prompt 层）。
 *
 * 导入策略（长期演进方向）：
 * - 按 ST prompt_order 线性扫描，保留条目顺序与 enabled 开关
 * - 结构组（pre / world / character / history）顺序 = 源 prompt_order 中 marker 首次出现顺序
 * - 相邻结构组之间若有相对注入自定义条目，动态插入 gap container（id 不固定）
 */

import { allocateShortId } from './short-id.js'
import {
  ST_ANCHOR_BINDING_SLOT,
  ST_ANCHOR_CONTENT_FROM_PROMPT,
  finalizeCharacterGroupBindings,
  isSystemBindingSlot,
} from './system-binding-slots.js'
import type {
  GroupKind,
  InjectionPosition,
  PromptBindingSlot,
  PromptEntry,
  PromptGroup,
  PromptPreset,
  PromptRole,
  PromptTrigger,
} from './assemble-prompts.js'

const GROUP = {
  pre: 'group-pre',
  character: 'group-character',
  world: 'group-world',
  history: 'group-history',
  userInput: 'group-user-input',
  post: 'group-post',
} as const

/** 纯 marker、无独立子块的 ST 项（仅推进扫描） */
const SKIP_MARKERS = new Set<string>()

type ImportSection = 'pre' | 'world' | 'user' | 'character' | 'history' | 'post'

export interface StPromptOrderItem {
  identifier: string
  enabled?: boolean
}

export interface StPrompt {
  identifier: string
  name?: string
  role?: string
  content?: string
  marker?: boolean
  system_prompt?: boolean
  forbid_overrides?: boolean
  injection_position?: number
  injection_depth?: number
  injection_order?: number
  injection_trigger?: string[]
}

export interface StPresetJson {
  prompts?: StPrompt[]
  prompt_order?: Array<{
    character_id?: number
    order?: StPromptOrderItem[]
  }>
  name?: string
}

export interface ConvertStPresetOptions {
  /** ST prompt_order.character_id，Stabs 完整栈为 100001 */
  characterOrderId?: number
  presetId?: string
  /** 覆盖预设名（Web 导入常用文件名） */
  presetName?: string
}

function sectionGroupId(section: ImportSection): string {
  switch (section) {
    case 'pre':
      return GROUP.pre
    case 'world':
      return GROUP.world
    case 'user':
    case 'character':
      return GROUP.character
    case 'history':
      return GROUP.history
    case 'post':
      return GROUP.post
    default:
      return GROUP.pre
  }
}

function mapRole(raw: string | undefined): PromptRole {
  if (raw === 'user' || raw === 'assistant') return raw
  return 'system'
}

function mapTriggers(raw: string[] | undefined): PromptTrigger[] {
  if (!raw?.length) return []
  const out: PromptTrigger[] = []
  for (const t of raw) {
    if (
      t === 'normal' ||
      t === 'continue' ||
      t === 'swipe' ||
      t === 'regenerate'
    ) {
      out.push(t)
    }
  }
  return out
}

function orderItemEnabled(item: StPromptOrderItem): boolean {
  return item.enabled !== false
}

function anchorIndex(
  orderList: StPromptOrderItem[],
  id: string,
): number {
  const i = orderList.findIndex((o) => o.identifier === id)
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER
}

const ST_CHARACTER_ROOT_ANCHORS = [
  'charDescription',
  'charPersonality',
  'scenario',
  'enhanceDefinitions',
  'dialogueExamples',
  'nsfw',
] as const

const GAP_ID_PREFIX = 'group-st-gap-'
const GAP_CONTAINER_NAME = 'gap container'

type StructuralBucket = 'pre' | 'world' | 'character' | 'history'

const BUCKET_ANCHOR_IDS: Record<StructuralBucket, readonly string[]> = {
  pre: ['main'],
  world: ['worldInfoBefore', 'worldInfoAfter'],
  character: ['personaDescription', ...ST_CHARACTER_ROOT_ANCHORS],
  history: ['chatHistory'],
}

function anchorIdToBucket(id: string): StructuralBucket | null {
  if (id === 'main') return 'pre'
  if (id === 'worldInfoBefore' || id === 'worldInfoAfter') return 'world'
  if (id === 'personaDescription') return 'character'
  if ((ST_CHARACTER_ROOT_ANCHORS as readonly string[]).includes(id)) {
    return 'character'
  }
  if (id === 'chatHistory') return 'history'
  return null
}

/** 按源 prompt_order 线性扫描，记录各结构桶 marker 的首次出现顺序 */
function computeStructuralGroupSequence(
  orderList: StPromptOrderItem[],
): StructuralBucket[] {
  const sequence: StructuralBucket[] = []
  const seen = new Set<StructuralBucket>()
  for (const item of orderList) {
    const bucket = anchorIdToBucket(item.identifier)
    if (bucket && !seen.has(bucket)) {
      seen.add(bucket)
      sequence.push(bucket)
    }
  }
  return sequence
}

interface GapPlan {
  id: string
  name: string
  afterGroupId: string
  fromExclusive: number
  toExclusive: number
}

function isPlaceableCustom(id: string, st: StPrompt): boolean {
  if (ST_ANCHOR_BINDING_SLOT[id]) return false
  if (SKIP_MARKERS.has(id) || (st.marker && !ST_ANCHOR_BINDING_SLOT[id])) {
    return false
  }
  if (st.injection_position === 1) return false
  return true
}

function hasPlaceableCustomBetween(
  orderList: StPromptOrderItem[],
  promptsById: Map<string, StPrompt>,
  fromExclusive: number,
  toExclusive: number,
): boolean {
  for (let i = fromExclusive + 1; i < toExclusive; i++) {
    const id = orderList[i]!.identifier
    const st = promptsById.get(id)
    if (!st) continue
    if (isPlaceableCustom(id, st)) return true
  }
  return false
}

function bucketForStructuralGroup(g: PromptGroup): StructuralBucket | null {
  if (g.id === GROUP.pre) return 'pre'
  if (g.kind === 'world') return 'world'
  if (g.kind === 'character') return 'character'
  if (g.kind === 'history') return 'history'
  return null
}

function firstBucketAnchorIndex(
  orderList: StPromptOrderItem[],
  bucket: StructuralBucket,
): number {
  let min = Number.MAX_SAFE_INTEGER
  for (const id of BUCKET_ANCHOR_IDS[bucket]) {
    min = Math.min(min, anchorIndex(orderList, id))
  }
  return min
}

function lastBucketAnchorIndexBefore(
  orderList: StPromptOrderItem[],
  bucket: StructuralBucket,
  beforeIdx: number,
): number {
  let max = -1
  for (let i = 0; i < beforeIdx && i < orderList.length; i++) {
    const id = orderList[i]!.identifier
    if ((BUCKET_ANCHOR_IDS[bucket] as readonly string[]).includes(id)) {
      max = i
    }
  }
  return max
}

function allocateGapGroupId(usedIds: Set<string>): string {
  return `${GAP_ID_PREFIX}${allocateShortId(usedIds)}`
}

/** 相邻结构组之间若有相对注入自定义条目，则插入 gap container */
function computeGapPlans(
  orderList: StPromptOrderItem[],
  promptsById: Map<string, StPrompt>,
  baseGroups: PromptGroup[],
  usedIds: Set<string>,
): GapPlan[] {
  const structural = baseGroups.filter(
    (g) => bucketForStructuralGroup(g) != null,
  )
  const plans: GapPlan[] = []
  for (let i = 0; i < structural.length - 1; i++) {
    const left = structural[i]!
    const right = structural[i + 1]!
    const leftBucket = bucketForStructuralGroup(left)!
    const rightBucket = bucketForStructuralGroup(right)!
    if (leftBucket === rightBucket) continue

    const rightFirst = firstBucketAnchorIndex(orderList, rightBucket)
    if (rightFirst >= Number.MAX_SAFE_INTEGER) continue
    const leftLast = lastBucketAnchorIndexBefore(
      orderList,
      leftBucket,
      rightFirst,
    )
    if (leftLast < 0) continue
    if (
      !hasPlaceableCustomBetween(
        orderList,
        promptsById,
        leftLast,
        rightFirst,
      )
    ) {
      continue
    }
    plans.push({
      id: allocateGapGroupId(usedIds),
      name: GAP_CONTAINER_NAME,
      afterGroupId: left.id,
      fromExclusive: leftLast,
      toExclusive: rightFirst,
    })
  }
  return plans
}

function insertGapGroups(
  baseGroups: PromptGroup[],
  plans: GapPlan[],
): PromptGroup[] {
  const sequence = baseGroups.slice()
  const sorted = plans.slice().sort((a, b) => {
    const ai = sequence.findIndex((g) => g.id === a.afterGroupId)
    const bi = sequence.findIndex((g) => g.id === b.afterGroupId)
    return bi - ai
  })
  for (const plan of sorted) {
    const at = sequence.findIndex((g) => g.id === plan.afterGroupId)
    if (at < 0) continue
    sequence.splice(at + 1, 0, {
      id: plan.id,
      name: plan.name,
      kind: 'normal',
      order: 0,
      enabled: true,
    })
  }
  return sequence.map((g, i) => ({ ...g, order: i }))
}

function dropEmptyGapGroups(
  groups: PromptGroup[],
  prompts: PromptEntry[],
): PromptGroup[] {
  const usedGroupIds = new Set(prompts.map((p) => p.groupId))
  const filtered = groups.filter((g) => {
    if (!g.id.startsWith(GAP_ID_PREFIX)) return true
    return usedGroupIds.has(g.id)
  })
  return filtered.map((g, i) => ({ ...g, order: i }))
}

function buildBaseGroups(
  structuralSequence: StructuralBucket[],
): PromptGroup[] {
  const bucketMeta: Record<
    StructuralBucket,
    { id: string; name: string; kind: GroupKind }
  > = {
    pre: { id: GROUP.pre, name: 'Pre', kind: 'normal' },
    world: { id: GROUP.world, name: 'World', kind: 'world' },
    character: { id: GROUP.character, name: 'Character', kind: 'character' },
    history: { id: GROUP.history, name: 'History', kind: 'history' },
  }

  const sequence: PromptGroup[] = []
  let order = 0
  for (const bucket of structuralSequence) {
    const m = bucketMeta[bucket]
    sequence.push({ ...m, order: order++, enabled: true })
  }
  sequence.push({
    id: GROUP.userInput,
    name: 'User input',
    kind: 'userInput',
    order: order++,
    enabled: true,
  })
  sequence.push({
    id: GROUP.post,
    name: 'Post',
    kind: 'normal',
    order: order++,
    enabled: true,
  })
  return sequence
}

function ensureStructuralGroupsForBindings(
  groups: PromptGroup[],
  kinds: Array<'world' | 'character' | 'history'>,
): PromptGroup[] {
  const bucketMeta = {
    world: { id: GROUP.world, name: 'World', kind: 'world' as const },
    character: {
      id: GROUP.character,
      name: 'Character',
      kind: 'character' as const,
    },
    history: { id: GROUP.history, name: 'History', kind: 'history' as const },
  }
  const next = groups.slice()
  const insertAt = Math.max(
    0,
    next.findIndex((g) => g.id === GROUP.userInput),
  )
  for (const kind of kinds) {
    if (next.some((g) => g.kind === kind)) continue
    next.splice(insertAt, 0, { ...bucketMeta[kind], order: 0, enabled: true })
  }
  return next.map((g, i) => ({ ...g, order: i }))
}

function makeBindingSlotEntry(
  groupId: string,
  slot: PromptBindingSlot,
  order: number,
  id: string,
  t: string,
  enabled = true,
  content = '',
): PromptEntry {
  return {
    id,
    groupId,
    title: '',
    content,
    description: '',
    tags: ['st-import'],
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

export function convertStPresetToArousalPub(
  raw: StPresetJson,
  opts: ConvertStPresetOptions = {},
): PromptPreset {
  const characterOrderId = opts.characterOrderId ?? 100001
  const presetId = opts.presetId ?? 'preset-st-import'
  const t = new Date().toISOString()
  const usedIds = new Set<string>([
    presetId,
    ...Object.values(GROUP),
  ])
  const promptsById = new Map(
    (raw.prompts ?? []).map((p) => [p.identifier, p]),
  )
  const orderDoc = (raw.prompt_order ?? []).find(
    (o) => o.character_id === characterOrderId,
  )
  const orderList = orderDoc?.order ?? []
  if (orderList.length === 0) {
    throw new Error('ST preset missing prompt_order for selected character_id')
  }

  const structuralSequence = computeStructuralGroupSequence(orderList)
  const baseGroups = buildBaseGroups(structuralSequence)
  const gapPlans = computeGapPlans(
    orderList,
    promptsById,
    baseGroups,
    usedIds,
  )
  let groups = insertGapGroups(baseGroups, gapPlans)

  let prompts: PromptEntry[] = []
  const nextOrder = new Map<string, number>()
  const bindingPlaced = new Set<PromptBindingSlot>()

  function bumpOrder(groupId: string): number {
    const n = nextOrder.get(groupId) ?? 0
    nextOrder.set(groupId, n + 1)
    return n
  }

  function placeBinding(
    section: ImportSection,
    slot: PromptBindingSlot,
    id: string,
    enabled = true,
  ) {
    if (bindingPlaced.has(slot)) return
    const groupId = sectionGroupId(section)
    prompts.push(
      makeBindingSlotEntry(groupId, slot, bumpOrder(groupId), id, t, enabled),
    )
    bindingPlaced.add(slot)
  }

  function placeStAnchor(
    anchorId: string,
    st: StPrompt,
    section: ImportSection,
    enabled: boolean,
  ) {
    const slot = ST_ANCHOR_BINDING_SLOT[anchorId]
    if (!slot) return
    if (bindingPlaced.has(slot)) return
    const groupId = sectionGroupId(section)
    const content = ST_ANCHOR_CONTENT_FROM_PROMPT.has(anchorId)
      ? (st.content ?? '')
      : ''
    prompts.push(
      makeBindingSlotEntry(
        groupId,
        slot,
        bumpOrder(groupId),
        `binding-slot-st-${anchorId}`,
        t,
        enabled,
        content,
      ),
    )
    bindingPlaced.add(slot)
  }

  let section: ImportSection = 'pre'

  function gapIdForOrderIndex(orderIdx: number): string | null {
    for (const plan of gapPlans) {
      if (orderIdx > plan.fromExclusive && orderIdx < plan.toExclusive) {
        return plan.id
      }
    }
    return null
  }

  function targetGroupIdForCustom(
    injectionPosition: InjectionPosition,
    orderIdx: number,
  ): string {
    if (injectionPosition === 'chat') return GROUP.post
    const gapId = gapIdForOrderIndex(orderIdx)
    if (gapId) return gapId
    return sectionGroupId(section)
  }

  for (let orderIdx = 0; orderIdx < orderList.length; orderIdx++) {
    const item = orderList[orderIdx]!
    const st = promptsById.get(item.identifier)
    if (!st) continue

    const id = item.identifier
    const enabled = orderItemEnabled(item)

    if (ST_ANCHOR_BINDING_SLOT[id]) {
      if (id === 'main') {
        section = 'pre'
      } else if (id === 'worldInfoBefore' || id === 'worldInfoAfter') {
        section = 'world'
      } else if (id === 'personaDescription') {
        section = 'user'
      } else if (
        id === 'charDescription' ||
        id === 'charPersonality' ||
        id === 'scenario' ||
        id === 'enhanceDefinitions' ||
        id === 'dialogueExamples' ||
        id === 'nsfw'
      ) {
        section = 'character'
        if (id === 'charDescription') {
          placeBinding(
            'character',
            'boundCharSystemPrompt',
            'binding-slot-char-system-prompt',
            enabled,
          )
        }
      } else if (id === 'chatHistory') {
        section = 'history'
      } else if (id === 'jailbreak') {
        placeStAnchor(id, st, 'history', enabled)
        section = 'post'
        continue
      }
      placeStAnchor(id, st, section, enabled)
      continue
    }

    if (SKIP_MARKERS.has(id) || (st.marker && !ST_ANCHOR_BINDING_SLOT[id])) {
      continue
    }

    const injectionPosition: InjectionPosition =
      st.injection_position === 1 ? 'chat' : 'relative'
    const groupId = targetGroupIdForCustom(injectionPosition, orderIdx)

    prompts.push({
      id: allocateShortId(usedIds),
      groupId,
      title: st.name?.trim() || id,
      content: st.content ?? '',
      description: '',
      tags: ['st-import'],
      enabled,
      role: mapRole(st.role),
      injectionPosition,
      injectionDepth: Math.max(0, Math.floor(st.injection_depth ?? 0)),
      injectionOrder: Number.isFinite(st.injection_order)
        ? Number(st.injection_order)
        : 100,
      triggers: mapTriggers(st.injection_trigger),
      order: bumpOrder(groupId),
      createdAt: t,
      updatedAt: t,
    })
  }

  const usesSystemSubBlocks = [...bindingPlaced].some((s) =>
    isSystemBindingSlot(s),
  )
  if (!usesSystemSubBlocks) {
    groups = ensureStructuralGroupsForBindings(groups, [
      'world',
      'character',
      'history',
    ])
    if (!groups.some((g) => g.id === GROUP.pre)) {
      const insertAt = Math.max(
        0,
        groups.findIndex((g) => g.id === GROUP.userInput),
      )
      groups.splice(insertAt, 0, {
        id: GROUP.pre,
        name: 'Pre',
        kind: 'normal',
        order: 0,
        enabled: true,
      })
      groups = groups.map((g, i) => ({ ...g, order: i }))
    }
    placeBinding('world', 'boundWorldBefore', 'binding-slot-world-before')
    placeBinding(
      'character',
      'boundUserPersona',
      'binding-slot-user-persona',
    )
    placeBinding(
      'character',
      'boundCharSystemPrompt',
      'binding-slot-char-system-prompt',
    )
    placeBinding(
      'character',
      'boundCharDescription',
      'binding-slot-char-description',
    )
    placeBinding(
      'character',
      'boundCharPersonality',
      'binding-slot-char-personality',
    )
    placeBinding('character', 'boundScenario', 'binding-slot-scenario')
    placeBinding(
      'history',
      'boundChatHistory',
      'binding-slot-chat-history',
    )
    placeBinding(
      'history',
      'boundCharacterPostHistory',
      'binding-slot-character-post-history',
    )
  }
  if (!bindingPlaced.has('boundUserInput')) {
    prompts.push(
      makeBindingSlotEntry(
        GROUP.userInput,
        'boundUserInput',
        bumpOrder(GROUP.userInput),
        'binding-slot-user-input',
        t,
      ),
    )
    bindingPlaced.add('boundUserInput')
  }

  const charGroup = groups.find((g) => g.kind === 'character')
  if (charGroup) {
    prompts = finalizeCharacterGroupBindings(
      prompts,
      charGroup.id,
      (slot, order, id, enabled = true) =>
        makeBindingSlotEntry(charGroup.id, slot, order, id, t, enabled),
    )
  }

  groups = dropEmptyGapGroups(groups, prompts)

  const presetName =
    opts.presetName?.trim() ||
    raw.name?.trim() ||
    'ST Import'

  return {
    id: presetId,
    name: presetName,
    groups,
    prompts,
    createdAt: t,
    updatedAt: t,
  }
}
