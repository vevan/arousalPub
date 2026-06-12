import type { PromptBindingSlot, PromptEntry } from '@/stores/prompts'

/** CCv2 角色卡字段子块（不含 persona / system_prompt / description） */
export const GRANULAR_CHARACTER_FIELD_SLOTS: PromptBindingSlot[] = [
  'boundCharPersonality',
  'boundScenario',
  'boundEnhanceDefinitions',
  'boundDialogueExamples',
]

/** 列表/拖曳锚点：charDescription（与 ST 源序一致） */
export const CHAR_CORE_BUNDLE_LIST_ANCHOR: PromptBindingSlot =
  'boundCharDescription'
/** 列表内层子行：system_prompt（可关） */
export const CHAR_CORE_BUNDLE_INNER: PromptBindingSlot = 'boundCharSystemPrompt'

/** 列表/拖曳锚点：chatHistory（与 ST 源序一致） */
export const HISTORY_BUNDLE_LIST_ANCHOR: PromptBindingSlot = 'boundChatHistory'
/** 列表内层子行：post_history（可关） */
export const HISTORY_BUNDLE_INNER: PromptBindingSlot = 'boundCharacterPostHistory'

/** 组装顺序：system_prompt 在 description 之前 */
export const CHAR_CORE_ASSEMBLY_FIRST: PromptBindingSlot =
  'boundCharSystemPrompt'
export const CHAR_CORE_ASSEMBLY_SECOND: PromptBindingSlot =
  'boundCharDescription'

/** @deprecated 用 CHAR_CORE_BUNDLE_LIST_ANCHOR / CHAR_CORE_BUNDLE_INNER */
export const CHAR_CORE_BUNDLE_ANCHOR = CHAR_CORE_BUNDLE_INNER
/** @deprecated 用 CHAR_CORE_BUNDLE_LIST_ANCHOR */
export const CHAR_CORE_BUNDLE_FOLLOWER = CHAR_CORE_BUNDLE_LIST_ANCHOR

export function isCharCoreListAnchor(entry: PromptEntry): boolean {
  return entry.bindingSlot === CHAR_CORE_BUNDLE_LIST_ANCHOR
}

export function isCharCoreListBundle(
  entry: PromptEntry,
  groupPrompts: PromptEntry[],
): boolean {
  if (!isCharCoreListAnchor(entry)) return false
  return groupPrompts.some((e) => e.bindingSlot === CHAR_CORE_BUNDLE_INNER)
}

/** system_prompt 与 description 成对时不单独占列表行 */
export function shouldHideCharSystemPromptInList(
  entry: PromptEntry,
  groupPrompts: PromptEntry[],
): boolean {
  if (entry.bindingSlot !== CHAR_CORE_BUNDLE_INNER) return false
  return groupPrompts.some(
    (e) => e.bindingSlot === CHAR_CORE_BUNDLE_LIST_ANCHOR,
  )
}

/** @deprecated 用 shouldHideCharSystemPromptInList */
export function shouldHideCharDescriptionInList(
  entry: PromptEntry,
  groupPrompts: PromptEntry[],
): boolean {
  return shouldHideCharSystemPromptInList(entry, groupPrompts)
}

export function findCharCoreBundlePartner(
  entry: PromptEntry,
  prompts: PromptEntry[],
): PromptEntry | undefined {
  const inGroup = prompts.filter((e) => e.groupId === entry.groupId)
  if (entry.bindingSlot === CHAR_CORE_BUNDLE_LIST_ANCHOR) {
    return inGroup.find((e) => e.bindingSlot === CHAR_CORE_BUNDLE_INNER)
  }
  if (entry.bindingSlot === CHAR_CORE_BUNDLE_INNER) {
    return inGroup.find((e) => e.bindingSlot === CHAR_CORE_BUNDLE_LIST_ANCHOR)
  }
  return undefined
}

export function charCoreListInnerEntry(
  listAnchor: PromptEntry,
  prompts: PromptEntry[],
): PromptEntry | undefined {
  if (!isCharCoreListAnchor(listAnchor)) return undefined
  return findCharCoreBundlePartner(listAnchor, prompts)
}

export function isHistoryListAnchor(entry: PromptEntry): boolean {
  return entry.bindingSlot === HISTORY_BUNDLE_LIST_ANCHOR
}

export function isHistoryListBundle(
  entry: PromptEntry,
  groupPrompts: PromptEntry[],
): boolean {
  if (!isHistoryListAnchor(entry)) return false
  return groupPrompts.some((e) => e.bindingSlot === HISTORY_BUNDLE_INNER)
}

/** post_history 与 chatHistory 成对时不单独占列表行 */
export function shouldHideHistoryPostHistoryInList(
  entry: PromptEntry,
  groupPrompts: PromptEntry[],
): boolean {
  if (entry.bindingSlot !== HISTORY_BUNDLE_INNER) return false
  return groupPrompts.some(
    (e) => e.bindingSlot === HISTORY_BUNDLE_LIST_ANCHOR,
  )
}

export function findHistoryBundlePartner(
  entry: PromptEntry,
  prompts: PromptEntry[],
): PromptEntry | undefined {
  const inGroup = prompts.filter((e) => e.groupId === entry.groupId)
  if (entry.bindingSlot === HISTORY_BUNDLE_LIST_ANCHOR) {
    return inGroup.find((e) => e.bindingSlot === HISTORY_BUNDLE_INNER)
  }
  if (entry.bindingSlot === HISTORY_BUNDLE_INNER) {
    return inGroup.find((e) => e.bindingSlot === HISTORY_BUNDLE_LIST_ANCHOR)
  }
  return undefined
}

export function historyListInnerEntry(
  listAnchor: PromptEntry,
  prompts: PromptEntry[],
): PromptEntry | undefined {
  if (!isHistoryListAnchor(listAnchor)) return undefined
  return findHistoryBundlePartner(listAnchor, prompts)
}

export function findBundleDragPartner(
  entry: PromptEntry,
  prompts: PromptEntry[],
): PromptEntry | undefined {
  return (
    findCharCoreBundlePartner(entry, prompts) ??
    findHistoryBundlePartner(entry, prompts)
  )
}

/**
 * 在 charDescription 的源 order 处插入 system（紧邻其前），不重排其它条目相对顺序。
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
      e.groupId === charGroupId && e.bindingSlot === CHAR_CORE_ASSEMBLY_SECOND,
  )
  if (!description) {
    const inChar = prompts.filter((e) => e.groupId === charGroupId)
    const maxOrder = inChar.reduce((m, e) => Math.max(m, e.order), -1)
    const enabled = opts.enabled !== false
    return [
      ...prompts,
      makeEntry(
        CHAR_CORE_ASSEMBLY_FIRST,
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
        e.bindingSlot === CHAR_CORE_ASSEMBLY_FIRST,
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
          CHAR_CORE_ASSEMBLY_FIRST,
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
      e.groupId === charGroupId && e.bindingSlot === CHAR_CORE_ASSEMBLY_FIRST,
  )
  const description = prompts.find(
    (e) =>
      e.groupId === charGroupId && e.bindingSlot === CHAR_CORE_ASSEMBLY_SECOND,
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
  legacySystemPromptEnabled?: boolean
}

/** CCv2：Character 组必须含 boundCharSystemPrompt；有 granular 时移除 legacy boundCharacterSystem */
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

/** 使用扁平子块 UI（非 legacy bundle） */
export function bindingSlotUsesFlatSubBlockUi(
  slot: PromptBindingSlot | undefined,
  groupKind?: import('@/stores/prompts').GroupKind,
  groupPrompts?: PromptEntry[],
): boolean {
  if (!slot) return false
  if (
    slot === CHAR_CORE_BUNDLE_LIST_ANCHOR &&
    groupKind === 'character' &&
    groupPrompts &&
    isCharCoreListBundle(
      { bindingSlot: slot } as PromptEntry,
      groupPrompts,
    )
  ) {
    return false
  }
  if (
    slot === HISTORY_BUNDLE_LIST_ANCHOR &&
    groupKind === 'history' &&
    groupPrompts &&
    isHistoryListBundle(
      { bindingSlot: slot } as PromptEntry,
      groupPrompts,
    )
  ) {
    return false
  }
  if (slot === CHAR_CORE_BUNDLE_INNER) return false
  if (slot === HISTORY_BUNDLE_INNER) return false
  if (slot === 'boundCharacterSystem') return false
  if (slot === 'boundWorld') return false
  if (slot === 'boundUserInput') return false
  return (
    GRANULAR_CHARACTER_FIELD_SLOTS.includes(slot) ||
    slot === 'boundUserPersona' ||
    slot === 'boundMain' ||
    slot === 'boundWorldBefore' ||
    slot === 'boundWorldAfter' ||
    slot === 'boundMemory' ||
    slot === 'boundChatHistory' ||
    slot === 'boundCharDescription'
  )
}

export function bindingSlotUsesLegacyBundle(
  slot: PromptBindingSlot | undefined,
  kind: import('@/stores/prompts').GroupKind | undefined,
  groupPrompts?: PromptEntry[],
): boolean {
  if (!slot || bindingSlotUsesFlatSubBlockUi(slot, kind, groupPrompts)) {
    return false
  }
  if (
    slot === CHAR_CORE_BUNDLE_LIST_ANCHOR &&
    kind === 'character' &&
    groupPrompts &&
    isCharCoreListBundle(
      { bindingSlot: slot } as PromptEntry,
      groupPrompts,
    )
  ) {
    return true
  }
  if (
    slot === HISTORY_BUNDLE_LIST_ANCHOR &&
    kind === 'history' &&
    groupPrompts &&
    isHistoryListBundle(
      { bindingSlot: slot } as PromptEntry,
      groupPrompts,
    )
  ) {
    return true
  }
  if (slot === 'boundCharacterSystem') return kind === 'character'
  if (slot === 'boundWorld') return kind === 'world'
  if (slot === 'boundUserInput') return kind === 'userInput'
  return false
}

export function legacyBundleTitleKey(
  slot: PromptBindingSlot | undefined,
  groupKind: import('@/stores/prompts').GroupKind | undefined,
): string {
  if (
    slot === CHAR_CORE_BUNDLE_LIST_ANCHOR &&
    groupKind === 'character'
  ) {
    return 'prompts.groupBoundTitleCharCore'
  }
  if (
    slot === HISTORY_BUNDLE_LIST_ANCHOR &&
    groupKind === 'history'
  ) {
    return 'prompts.groupBoundTitleHistory'
  }
  switch (groupKind) {
    case 'character':
      return 'prompts.groupBoundTitleCharacter'
    case 'world':
      return 'prompts.groupBoundTitleWorld'
    case 'history':
      return 'prompts.groupBoundTitleHistory'
    case 'userInput':
      return 'prompts.groupBoundTitleUserInput'
    default:
      return 'prompts.groupBoundFromChat'
  }
}

export function legacyBundleDescKey(
  slot: PromptBindingSlot | undefined,
  groupKind: import('@/stores/prompts').GroupKind | undefined,
): string {
  if (
    slot === CHAR_CORE_BUNDLE_LIST_ANCHOR &&
    groupKind === 'character'
  ) {
    return 'prompts.groupBoundDescCharCore'
  }
  if (
    slot === HISTORY_BUNDLE_LIST_ANCHOR &&
    groupKind === 'history'
  ) {
    return 'prompts.groupBoundDescHistory'
  }
  switch (groupKind) {
    case 'character':
      return 'prompts.groupBoundDescCharacter'
    case 'world':
      return 'prompts.groupBoundDescWorld'
    case 'history':
      return 'prompts.groupBoundDescHistory'
    case 'userInput':
      return 'prompts.groupBoundDescUserInput'
    default:
      return ''
  }
}
