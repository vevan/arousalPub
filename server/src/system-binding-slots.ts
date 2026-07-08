import type { PromptBindingSlot, PromptEntry, PromptPreset } from './assemble-prompts.js'

/** 与 SillyTavern marker 对齐的系统子块（原生预设与 ST 导入共用） */
export const SYSTEM_BINDING_SLOTS = [
  'boundMain',
  'boundWorldBefore',
  'boundWorldAfter',
  'boundUserPersona',
  'boundCharSystemPrompt',
  'boundCharDescription',
  'boundCharPersonality',
  'boundScenario',
  'boundEnhanceDefinitions',
  'boundDialogueExamples',
  'boundChatHistory',
  'boundCharacterPostHistory',
  'boundUserInput',
  'boundMemory',
] as const satisfies readonly PromptBindingSlot[]

const SYSTEM_SET = new Set<string>(SYSTEM_BINDING_SLOTS)

export function isSystemBindingSlot(
  slot: PromptBindingSlot | undefined,
): boolean {
  return slot != null && SYSTEM_SET.has(slot)
}

export function isKnownBindingSlot(
  slot: PromptBindingSlot | undefined,
): boolean {
  return isSystemBindingSlot(slot)
}

export function presetUsesSystemSubBlocks(preset: PromptPreset): boolean {
  return preset.prompts.some((e) => isSystemBindingSlot(e.bindingSlot))
}

/** ST prompt_order identifier → 统一系统绑槽 */
export const ST_ANCHOR_BINDING_SLOT: Record<string, PromptBindingSlot> = {
  main: 'boundMain',
  worldInfoBefore: 'boundWorldBefore',
  worldInfoAfter: 'boundWorldAfter',
  personaDescription: 'boundUserPersona',
  charDescription: 'boundCharDescription',
  charPersonality: 'boundCharPersonality',
  scenario: 'boundScenario',
  enhanceDefinitions: 'boundEnhanceDefinitions',
  dialogueExamples: 'boundDialogueExamples',
  chatHistory: 'boundChatHistory',
}

/** 锚点正文来自 ST prompts[].content（非角色卡字段） */
export const ST_ANCHOR_CONTENT_FROM_PROMPT = new Set([
  'main',
  'enhanceDefinitions',
])

export function isStAnchorIdentifier(id: string): boolean {
  return id in ST_ANCHOR_BINDING_SLOT
}

/** Default 种子 / 新预设的 Character 组系统子块（顺序） */
export const DEFAULT_CHARACTER_SYSTEM_SLOTS: PromptBindingSlot[] = [
  'boundUserPersona',
  'boundCharSystemPrompt',
  'boundCharDescription',
  'boundCharPersonality',
  'boundScenario',
]

export const DEFAULT_WORLD_SYSTEM_SLOTS: PromptBindingSlot[] = [
  'boundWorldBefore',
]

export const DEFAULT_HISTORY_SYSTEM_SLOTS: PromptBindingSlot[] = [
  'boundChatHistory',
  'boundCharacterPostHistory',
]

/** CCv2 角色卡字段子块（不含 persona / system_prompt） */
export const GRANULAR_CHARACTER_FIELD_SLOTS: PromptBindingSlot[] = [
  'boundCharDescription',
  'boundCharPersonality',
  'boundScenario',
  'boundEnhanceDefinitions',
  'boundDialogueExamples',
]

export function presetHasGranularCharacterFields(
  prompts: PromptEntry[],
  charGroupId?: string,
): boolean {
  return prompts.some(
    (e) =>
      GRANULAR_CHARACTER_FIELD_SLOTS.includes(
        e.bindingSlot as PromptBindingSlot,
      ) &&
      (charGroupId == null || e.groupId === charGroupId),
  )
}

/**
 * 在 charDescription 的源 order 处插入 system（紧邻其前），不重排其它条目相对顺序。
 * ST 导入应在 walk 到 charDescription 时调用 placeBinding(system)，此处仅补缺失或修正错位。
 */
export function pinCharSystemPromptBeforeDescription(
  prompts: PromptEntry[],
  charGroupId: string,
  makeEntry: (
    slot: PromptBindingSlot,
    order: number,
    id: string,
    enabled?: boolean,
  ) => PromptEntry,
  opts: { existing?: PromptEntry; enabled?: boolean } = {},
): PromptEntry[] {
  const description = prompts.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharDescription',
  )
  if (!description) {
    const inChar = prompts.filter((e) => e.groupId === charGroupId)
    const maxOrder = inChar.reduce((m, e) => Math.max(m, e.order), -1)
    const enabled = opts.enabled !== false
    return [
      ...prompts,
      makeEntry(
        'boundCharSystemPrompt',
        maxOrder + 1,
        'binding-slot-char-system-prompt',
        enabled,
      ),
    ]
  }

  const existing =
    opts.existing ??
    prompts.find(
      (e) =>
        e.groupId === charGroupId &&
        e.bindingSlot === 'boundCharSystemPrompt',
    )
  const D = description.order
  if (existing && existing.order === D - 1) return prompts

  let next = existing
    ? prompts.filter((e) => e.id !== existing.id)
    : prompts.slice()
  next = next.map((e) => {
    if (e.groupId !== charGroupId || e.order < D) return e
    return { ...e, order: e.order + 1 }
  })
  const enabled =
    opts.enabled !== undefined
      ? opts.enabled !== false
      : existing
        ? existing.enabled !== false
        : true
  next.push(
    existing
      ? { ...existing, order: D, groupId: charGroupId, enabled }
      : makeEntry(
          'boundCharSystemPrompt',
          D,
          'binding-slot-char-system-prompt',
          enabled,
        ),
  )
  return next
}

/** Character 组内按 order 展平为 0..n-1 */
export function migrateCharacterGroupToFlatOrder(
  prompts: PromptEntry[],
  charGroupId: string,
): PromptEntry[] {
  const inGroup = prompts.filter((e) => e.groupId === charGroupId)
  if (inGroup.length === 0) return prompts
  const sorted = inGroup.slice().sort((a, b) => a.order - b.order)
  const idOrder = new Map(sorted.map((e, i) => [e.id, i]))
  return prompts.map((e) => {
    if (e.groupId !== charGroupId) return e
    return { ...e, order: idOrder.get(e.id)! }
  })
}

/** 在 boundChatHistory 之后紧邻插入 postHistory（不重排其它条目） */
export function pinPostHistoryAfterChatHistory(
  prompts: PromptEntry[],
  histGroupId: string,
  makeEntry: (
    slot: PromptBindingSlot,
    order: number,
    id: string,
    enabled?: boolean,
  ) => PromptEntry,
  opts: { existing?: PromptEntry; enabled?: boolean } = {},
): PromptEntry[] {
  const chatHistory = prompts.find(
    (e) =>
      e.groupId === histGroupId && e.bindingSlot === 'boundChatHistory',
  )
  if (!chatHistory) return prompts

  const existing =
    opts.existing ??
    prompts.find(
      (e) =>
        e.groupId === histGroupId &&
        e.bindingSlot === 'boundCharacterPostHistory',
    )
  const H = chatHistory.order
  if (existing && existing.order === H + 1) return prompts

  let next = existing
    ? prompts.filter((e) => e.id !== existing.id)
    : prompts.slice()
  next = next.map((e) => {
    if (e.groupId !== histGroupId || e.order <= H) return e
    return { ...e, order: e.order + 1 }
  })
  const enabled =
    opts.enabled !== undefined
      ? opts.enabled !== false
      : existing
        ? existing.enabled !== false
        : true
  next.push(
    existing
      ? { ...existing, order: H + 1, groupId: histGroupId, enabled }
      : makeEntry(
          'boundCharacterPostHistory',
          H + 1,
          'binding-slot-character-post-history',
          enabled,
        ),
  )
  return next
}

/** CCv2：Character 组必须含 boundCharSystemPrompt（即使卡字段为空）。 */
export function finalizeCharacterGroupBindings(
  prompts: PromptEntry[],
  charGroupId: string,
  makeEntry: (
    slot: PromptBindingSlot,
    order: number,
    id: string,
    enabled?: boolean,
  ) => PromptEntry,
): PromptEntry[] {
  let next = prompts
  const hasCharSystemPromptInGroup = next.some(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharSystemPrompt',
  )
  const charDesc = next.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharDescription',
  )
  const charSystem = next.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharSystemPrompt',
  )

  if (
    !hasCharSystemPromptInGroup ||
    (charDesc && charSystem && charSystem.order !== charDesc.order - 1)
  ) {
    next = pinCharSystemPromptBeforeDescription(next, charGroupId, makeEntry, {
      existing: charSystem,
      enabled: charSystem?.enabled !== false,
    })
  }

  return next
}
