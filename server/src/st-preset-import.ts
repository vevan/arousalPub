/**
 * SillyTavern OpenAI preset JSON → arousalPub PromptPreset（仅 prompt 层）。
 *
 * 导入策略（长期演进方向）：
 * - 按 ST prompt_order 线性扫描，保留条目顺序与 enabled 开关
 * - 结构组（pre / world / character / history）顺序 = 源 prompt_order 中 marker 首次出现顺序
 * - 夹在两个结构组之间的相对注入自定义条目归入前一个结构组末尾
 */

import { allocateShortId } from './short-id.js'
import { assertStPresetWithinLimits } from './st-preset-limits.js'
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

/** 旧版 ST 导入动态插入的夹缝组 id 前缀（现策略不再产生） */
export const LEGACY_ST_GAP_GROUP_ID_PREFIX = 'group-st-gap-'

export function isLegacyStGapGroupId(id: string): boolean {
  return id.startsWith(LEGACY_ST_GAP_GROUP_ID_PREFIX)
}

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

const ST_CHARACTER_ROOT_ANCHORS = [
  'charDescription',
  'charPersonality',
  'scenario',
  'enhanceDefinitions',
  'dialogueExamples',
] as const

type StructuralBucket = 'pre' | 'world' | 'character' | 'history'

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
  assertStPresetWithinLimits(raw)
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
    throw new Error(
      `ST preset missing prompt_order for character_id ${characterOrderId}`,
    )
  }

  const structuralSequence = computeStructuralGroupSequence(orderList)
  let groups = buildBaseGroups(structuralSequence)

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

  function targetGroupIdForCustom(
    injectionPosition: InjectionPosition,
  ): string {
    if (injectionPosition === 'chat') return GROUP.post
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
        id === 'dialogueExamples'
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
      }
      placeStAnchor(id, st, section, enabled)
      continue
    }

    if (SKIP_MARKERS.has(id) || (st.marker && !ST_ANCHOR_BINDING_SLOT[id])) {
      continue
    }

    const injectionPosition: InjectionPosition =
      st.injection_position === 1 ? 'chat' : 'relative'
    const groupId = targetGroupIdForCustom(injectionPosition)

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
