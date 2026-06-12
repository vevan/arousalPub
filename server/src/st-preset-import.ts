/**
 * SillyTavern OpenAI preset JSON → arousalPub PromptPreset（仅 prompt 层）。
 *
 * 导入策略（长期演进方向）：
 * - 按 ST prompt_order 线性扫描，保留条目顺序与 enabled 开关
 * - 根锚点（world / 角色卡字段 / history / post）决定组顺序与绑槽
 * - personaDescription → boundUserPersona（用户块），不视为 character 根锚点
 * - 两锚点之间的自定义条目进入夹缝 normal 组（保组装顺序，UI 可后调）
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
  gapWorldPersona: 'group-st-gap-world-persona',
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

function firstCharacterRootAnchorIndex(
  orderList: StPromptOrderItem[],
): number {
  let min = Number.MAX_SAFE_INTEGER
  for (const id of ST_CHARACTER_ROOT_ANCHORS) {
    min = Math.min(min, anchorIndex(orderList, id))
  }
  return min
}

/** 按 ST order 中根锚点首次出现顺序排列 world / character / history */
function computeRootKindSequence(
  orderList: StPromptOrderItem[],
): Array<'world' | 'character' | 'history'> {
  const entries: { kind: 'world' | 'character' | 'history'; i: number }[] = []
  const world = anchorIndex(orderList, 'worldInfoBefore')
  const character = firstCharacterRootAnchorIndex(orderList)
  const persona = anchorIndex(orderList, 'personaDescription')
  const history = anchorIndex(orderList, 'chatHistory')

  if (world < Number.MAX_SAFE_INTEGER) {
    entries.push({ kind: 'world', i: world })
  }
  const charRoot =
    character < Number.MAX_SAFE_INTEGER ? character : persona
  if (charRoot < Number.MAX_SAFE_INTEGER) {
    entries.push({ kind: 'character', i: charRoot })
  }
  if (history < Number.MAX_SAFE_INTEGER) {
    entries.push({ kind: 'history', i: history })
  }
  entries.sort((a, b) => a.i - b.i)
  return entries.map((e) => e.kind)
}

function buildGroups(
  rootSequence: Array<'world' | 'character' | 'history'>,
  useWorldPersonaGap: boolean,
): PromptGroup[] {
  const kindMeta: Record<
    'pre' | 'world' | 'character' | 'history' | 'userInput' | 'post' | 'gap',
    { id: string; name: string; kind: GroupKind }
  > = {
    pre: { id: GROUP.pre, name: 'Pre', kind: 'normal' },
    world: { id: GROUP.world, name: 'World', kind: 'world' },
    character: { id: GROUP.character, name: 'Character', kind: 'character' },
    history: { id: GROUP.history, name: 'History', kind: 'history' },
    userInput: { id: GROUP.userInput, name: 'User input', kind: 'userInput' },
    post: { id: GROUP.post, name: 'Post', kind: 'normal' },
    gap: {
      id: GROUP.gapWorldPersona,
      name: 'gap container',
      kind: 'normal',
    },
  }

  const sequence: PromptGroup[] = []
  let order = 0
  const push = (key: keyof typeof kindMeta) => {
    const m = kindMeta[key]
    sequence.push({ ...m, order: order++, enabled: true })
  }

  push('pre')
  for (const root of rootSequence) {
    if (root === 'world') {
      push('world')
      if (useWorldPersonaGap) push('gap')
    } else if (root === 'character') {
      push('character')
    } else if (root === 'history') {
      push('history')
    }
  }
  if (!rootSequence.includes('world')) push('world')
  if (!rootSequence.includes('character')) push('character')
  if (!rootSequence.includes('history')) push('history')
  push('userInput')
  push('post')

  return sequence
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

  const hasPersona = anchorIndex(orderList, 'personaDescription') < Number.MAX_SAFE_INTEGER
  const hasWorld = anchorIndex(orderList, 'worldInfoBefore') < Number.MAX_SAFE_INTEGER
  const useWorldPersonaGap = hasWorld && hasPersona

  const rootSequence = computeRootKindSequence(orderList)
  const groups = buildGroups(rootSequence, useWorldPersonaGap)

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
  let seenWorld = false
  let seenPersona = false

  function targetGroupIdForCustom(
    injectionPosition: InjectionPosition,
  ): string {
    if (injectionPosition === 'chat') return GROUP.post
    if (useWorldPersonaGap && seenWorld && !seenPersona && section === 'world') {
      return GROUP.gapWorldPersona
    }
    return sectionGroupId(section)
  }

  for (const item of orderList) {
    const st = promptsById.get(item.identifier)
    if (!st) continue

    const id = item.identifier
    const enabled = orderItemEnabled(item)

    if (ST_ANCHOR_BINDING_SLOT[id]) {
      if (id === 'main') {
        section = 'pre'
      } else if (id === 'worldInfoBefore' || id === 'worldInfoAfter') {
        section = 'world'
        if (id === 'worldInfoBefore') seenWorld = true
      } else if (id === 'personaDescription') {
        seenPersona = true
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
