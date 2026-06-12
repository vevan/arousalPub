/**
 * SillyTavern OpenAI preset JSON → arousalPub PromptPreset（仅 prompt 层）。
 */

import { allocateShortId } from './short-id.js'
import type {
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

/** ST 结构 marker：只切段/绑槽，不重复导入为正文条目 */
const SKIP_MARKERS = new Set([
  'main',
  'dialogueExamples',
  'chatHistory',
  'worldInfoAfter',
  'worldInfoBefore',
  'charDescription',
  'charPersonality',
  'scenario',
  'jailbreak',
])

type ImportSection = 'pre' | 'character' | 'world' | 'history' | 'post'

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
}

function sectionGroupId(section: ImportSection): string {
  switch (section) {
    case 'pre':
      return GROUP.pre
    case 'character':
      return GROUP.character
    case 'world':
      return GROUP.world
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

function makeBindingSlotEntry(
  groupId: string,
  slot: PromptBindingSlot,
  order: number,
  id: string,
  t: string,
  enabled = true,
): PromptEntry {
  return {
    id,
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

function buildDefaultGroups(): PromptGroup[] {
  return [
    { id: GROUP.pre, name: 'Pre', kind: 'normal', order: 0, enabled: true },
    {
      id: GROUP.character,
      name: 'Character',
      kind: 'character',
      order: 1,
      enabled: true,
    },
    { id: GROUP.world, name: 'World', kind: 'world', order: 2, enabled: true },
    {
      id: GROUP.history,
      name: 'History',
      kind: 'history',
      order: 3,
      enabled: true,
    },
    {
      id: GROUP.userInput,
      name: 'User input',
      kind: 'userInput',
      order: 4,
      enabled: true,
    },
    { id: GROUP.post, name: 'Post', kind: 'normal', order: 5, enabled: true },
  ]
}

export function convertStPresetToArousalPub(
  raw: StPresetJson,
  opts: ConvertStPresetOptions = {},
): PromptPreset {
  const characterOrderId = opts.characterOrderId ?? 100001
  const presetId = opts.presetId ?? 'preset-st-import'
  const t = new Date().toISOString()
  const usedIds = new Set<string>([presetId, ...Object.values(GROUP)])
  const promptsById = new Map(
    (raw.prompts ?? []).map((p) => [p.identifier, p]),
  )
  const orderDoc = (raw.prompt_order ?? []).find(
    (o) => o.character_id === characterOrderId,
  )
  const orderList = orderDoc?.order ?? []
  const prompts: PromptEntry[] = []
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

  let section: ImportSection = 'pre'

  for (const item of orderList) {
    const st = promptsById.get(item.identifier)
    if (!st) continue

    const id = item.identifier
    const enabled = orderItemEnabled(item)

    if (id === 'charDescription') {
      section = 'character'
      placeBinding(
        'character',
        'boundCharacterSystem',
        'binding-slot-character-system',
        enabled,
      )
      continue
    }
    if (id === 'personaDescription') {
      placeBinding(
        'character',
        'boundUserPersona',
        'binding-slot-user-persona',
        enabled,
      )
      continue
    }
    if (id === 'worldInfoBefore') {
      section = 'world'
      placeBinding('world', 'boundWorld', 'binding-slot-world', enabled)
      continue
    }
    if (id === 'chatHistory') {
      section = 'history'
      continue
    }
    if (id === 'jailbreak') {
      placeBinding(
        'history',
        'boundCharacterPostHistory',
        'binding-slot-character-post-history',
        enabled,
      )
      section = 'post'
      continue
    }

    if (SKIP_MARKERS.has(id) || st.marker) {
      continue
    }

    const injectionPosition: InjectionPosition =
      st.injection_position === 1 ? 'chat' : 'relative'
    const targetSection: ImportSection =
      injectionPosition === 'chat' ? 'post' : section
    const groupId = sectionGroupId(targetSection)

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

  placeBinding('world', 'boundWorld', 'binding-slot-world')
  placeBinding(
    'character',
    'boundCharacterSystem',
    'binding-slot-character-system',
  )
  placeBinding('character', 'boundUserPersona', 'binding-slot-user-persona')
  placeBinding(
    'history',
    'boundCharacterPostHistory',
    'binding-slot-character-post-history',
  )
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

  return {
    id: presetId,
    name: raw.name?.trim() || 'ST Import',
    groups: buildDefaultGroups(),
    prompts,
    createdAt: t,
    updatedAt: t,
  }
}
