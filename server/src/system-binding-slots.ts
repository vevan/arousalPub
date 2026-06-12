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
  'boundNsfw',
  'boundChatHistory',
  'boundCharacterPostHistory',
  'boundUserInput',
  'boundMemory',
] as const satisfies readonly PromptBindingSlot[]

/** 已废弃的粗粒度槽；组装仍兼容，normalize 可迁移 */
export const LEGACY_BINDING_SLOTS = [
  'boundCharacterSystem',
  'boundWorld',
  'boundRecentHistory',
] as const satisfies readonly PromptBindingSlot[]

const SYSTEM_SET = new Set<string>(SYSTEM_BINDING_SLOTS)
const LEGACY_SET = new Set<string>(LEGACY_BINDING_SLOTS)

/** 历史 boundSt* 导入名 → 统一系统槽 */
export const DEPRECATED_ST_SLOT_ALIASES: Record<string, PromptBindingSlot> = {
  boundStMain: 'boundMain',
  boundStWorldBefore: 'boundWorldBefore',
  boundStWorldAfter: 'boundWorldAfter',
  boundStCharDescription: 'boundCharDescription',
  boundStCharPersonality: 'boundCharPersonality',
  boundStScenario: 'boundScenario',
  boundStEnhanceDefinitions: 'boundEnhanceDefinitions',
  boundStDialogueExamples: 'boundDialogueExamples',
  boundStNsfw: 'boundNsfw',
  boundStChatHistory: 'boundChatHistory',
}

export function isSystemBindingSlot(
  slot: PromptBindingSlot | undefined,
): boolean {
  return slot != null && SYSTEM_SET.has(slot)
}

export function isLegacyBindingSlot(
  slot: PromptBindingSlot | undefined,
): boolean {
  return slot != null && LEGACY_SET.has(slot)
}

export function isKnownBindingSlot(
  slot: PromptBindingSlot | undefined,
): boolean {
  return (
    slot != null &&
    (SYSTEM_SET.has(slot) || LEGACY_SET.has(slot))
  )
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
  nsfw: 'boundNsfw',
  chatHistory: 'boundChatHistory',
  jailbreak: 'boundCharacterPostHistory',
}

/** 锚点正文来自 ST prompts[].content（非角色卡字段） */
export const ST_ANCHOR_CONTENT_FROM_PROMPT = new Set([
  'main',
  'enhanceDefinitions',
  'nsfw',
])

export function isStAnchorIdentifier(id: string): boolean {
  return id in ST_ANCHOR_BINDING_SLOT
}

/** 将 boundSt* 与旧槽名规范化为统一系统槽（仅改 bindingSlot 字段） */
export function migrateBindingSlotAliases(
  prompts: PromptEntry[],
): PromptEntry[] {
  return prompts.map((e) => {
    if (!e.bindingSlot) return e
    const alias = DEPRECATED_ST_SLOT_ALIASES[e.bindingSlot]
    if (alias) return { ...e, bindingSlot: alias }
    return e
  })
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
  'boundNsfw',
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

export interface FinalizeCharacterBindingsOptions {
  /** 从 legacy boundCharacterSystem 迁移的 system_prompt 开关 */
  legacySystemPromptEnabled?: boolean
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

/** @deprecated 会重算整组 order；finalize 已改用 pinCharSystemPromptBeforeDescription */
export function alignCharCoreAssemblyPair(
  prompts: PromptEntry[],
  charGroupId: string,
): PromptEntry[] {
  const system = prompts.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharSystemPrompt',
  )
  const description = prompts.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharDescription',
  )
  if (!system || !description) return prompts

  const inChar = prompts
    .filter((e) => e.groupId === charGroupId)
    .slice()
    .sort((a, b) => a.order - b.order)
  const sysIdx = inChar.findIndex((e) => e.id === system.id)
  const descIdx = inChar.findIndex((e) => e.id === description.id)
  if (sysIdx >= 0 && descIdx === sysIdx + 1) return prompts

  const reordered = inChar.filter((e) => e.id !== system.id)
  const newDescIdx = reordered.findIndex((e) => e.id === description.id)
  if (newDescIdx < 0) return prompts
  reordered.splice(newDescIdx, 0, system)

  const idToOrder = new Map(reordered.map((e, i) => [e.id, i]))
  return prompts.map((e) => {
    if (e.groupId !== charGroupId) return e
    const o = idToOrder.get(e.id)
    return o !== undefined ? { ...e, order: o } : e
  })
}

/** @deprecated 用 alignCharCoreAssemblyPair */
export function ensureCharCoreBundleOrder(
  prompts: PromptEntry[],
  charGroupId: string,
): PromptEntry[] {
  return alignCharCoreAssemblyPair(prompts, charGroupId)
}

/**
 * CCv2：Character 组必须含 boundCharSystemPrompt（即使卡字段为空）。
 * 有 granular 子块时移除 legacy boundCharacterSystem。
 */
export function finalizeCharacterGroupBindings(
  prompts: PromptEntry[],
  charGroupId: string,
  makeEntry: (
    slot: PromptBindingSlot,
    order: number,
    id: string,
    enabled?: boolean,
  ) => PromptEntry,
  opts: FinalizeCharacterBindingsOptions = {},
): PromptEntry[] {
  let next = prompts
  const legacy = next.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharacterSystem',
  )
  const hasGranular =
    presetHasGranularCharacterFields(next, charGroupId) ||
    next.some(
      (e) =>
        e.groupId === charGroupId &&
        e.bindingSlot === 'boundCharDescription',
    )
  const hasCharSystemPromptInGroup = next.some(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharSystemPrompt',
  )
  let legacySysOn = opts.legacySystemPromptEnabled

  if (legacy && (hasGranular || hasCharSystemPromptInGroup)) {
    if (legacySysOn === undefined) legacySysOn = legacy.enabled !== false
    next = next.filter(
      (e) =>
        !(
          e.groupId === charGroupId &&
          e.bindingSlot === 'boundCharacterSystem'
        ),
    )
  }

  const charDesc = next.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharDescription',
  )
  const charSystem = next.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === 'boundCharSystemPrompt',
  )
  const enabled = legacySysOn !== undefined ? legacySysOn !== false : true

  if (!hasCharSystemPromptInGroup || (charDesc && charSystem && charSystem.order !== charDesc.order - 1)) {
    next = pinCharSystemPromptBeforeDescription(next, charGroupId, makeEntry, {
      existing: charSystem,
      enabled,
    })
  }

  return next
}
