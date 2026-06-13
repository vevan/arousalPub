/**
 * 提示词预设 normalize 共享核心（Web / Server 同源）。
 * 由 scripts/sync-prompt-preset-shared.mjs 同步至 server/src 与 web/src/shared。
 */

export type GroupKind =
  | 'normal'
  | 'character'
  | 'world'
  | 'history'
  | 'userInput'

export type PromptBindingSlot = string

export interface PromptGroup {
  id: string
  name: string
  kind: GroupKind
  order: number
  description?: string
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
  role: 'system' | 'user' | 'assistant'
  injectionPosition: 'relative' | 'chat'
  injectionDepth: number
  injectionOrder: number
  triggers: Array<'normal' | 'continue' | 'swipe' | 'regenerate'>
  order: number
  isSeed?: boolean
  bindingSlot?: PromptBindingSlot
  characterBundlePosition?: 'before' | 'after'
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

export interface NormalizePresetOptions {
  /** 从 legacy `useBoundCharacterSystemPrompt` 预设级开关继承 */
  legacySystemPromptEnabled?: boolean
}

export interface NormalizePresetDeps {
  migrateBindingSlotAliases: (prompts: PromptEntry[]) => PromptEntry[]
  presetUsesSystemSubBlocks: (preset: PromptPreset) => boolean
  pinPostHistoryAfterChatHistory: (
    prompts: PromptEntry[],
    histGroupId: string,
    makeEntry: (
      slot: PromptBindingSlot,
      order: number,
      id: string,
      enabled?: boolean,
    ) => PromptEntry,
    opts?: { existing?: PromptEntry; enabled?: boolean },
  ) => PromptEntry[]
  migrateCharacterGroupToFlatOrder: (
    prompts: PromptEntry[],
    charGroupId: string,
  ) => PromptEntry[]
  finalizeCharacterGroupBindings: (
    prompts: PromptEntry[],
    charGroupId: string,
    makeEntry: (
      slot: PromptBindingSlot,
      order: number,
      id: string,
      enabled?: boolean,
    ) => PromptEntry,
    opts?: { legacySystemPromptEnabled?: boolean },
  ) => PromptEntry[]
  DEFAULT_CHARACTER_SYSTEM_SLOTS: PromptBindingSlot[]
  DEFAULT_HISTORY_SYSTEM_SLOTS: PromptBindingSlot[]
  DEFAULT_WORLD_SYSTEM_SLOTS: PromptBindingSlot[]
  makeBindingSlotEntry: (
    groupId: string,
    slot: PromptBindingSlot,
    order: number,
    id: string,
    enabled?: boolean,
  ) => PromptEntry
}

function normalizeGroups(groups: PromptGroup[]): PromptGroup[] {
  return groups.map((g) => ({
    ...g,
    description: g.description ?? '',
    enabled: g.enabled !== false,
  }))
}

function bindingSlotIsRequired(slot: PromptBindingSlot | undefined): boolean {
  return (
    slot === 'boundWorld' ||
    slot === 'boundWorldBefore' ||
    slot === 'boundUserInput' ||
    slot === 'boundUserPersona'
  )
}

function ensureSystemSubBlocks(
  prompts: PromptEntry[],
  group: PromptGroup,
  slots: PromptBindingSlot[],
  deps: NormalizePresetDeps,
  idPrefix: string,
): PromptEntry[] {
  let next = prompts
  let order =
    next
      .filter((e) => e.groupId === group.id)
      .reduce((m, e) => Math.max(m, e.order), -1) + 1
  for (const slot of slots) {
    if (next.some((e) => e.bindingSlot === slot)) continue
    next = [
      ...next,
      deps.makeBindingSlotEntry(group.id, slot, order, `${idPrefix}-${slot}`),
    ]
    order += 1
  }
  return next
}

/**
 * 加载/组装前补全绑定槽、迁移 legacy 分区与槽位别名。
 * Server 组装与 Web 提示词库 UI 共用同一算法。
 */
export function normalizePresetCore(
  p: PromptPreset,
  deps: NormalizePresetDeps,
  opts: NormalizePresetOptions = {},
): PromptPreset {
  const charG = p.groups.find((g) => g.kind === 'character')
  const worldG = p.groups.find((g) => g.kind === 'world')
  const histG = p.groups.find((g) => g.kind === 'history')
  const userInputG = p.groups.find((g) => g.kind === 'userInput')

  let prompts = deps.migrateBindingSlotAliases(p.prompts).map((e) => ({
    ...e,
    enabled: bindingSlotIsRequired(e.bindingSlot) ? true : e.enabled,
  }))

  const hasLegacyChar = prompts.some(
    (e) => e.bindingSlot === 'boundCharacterSystem',
  )
  const hasSystemSub = deps.presetUsesSystemSubBlocks({ ...p, prompts })

  if (charG && !hasLegacyChar && !hasSystemSub) {
    prompts = ensureSystemSubBlocks(
      prompts,
      charG,
      deps.DEFAULT_CHARACTER_SYSTEM_SLOTS,
      deps,
      'binding-slot',
    )
  }

  if (
    charG &&
    !prompts.some((e) => e.bindingSlot === 'boundUserPersona') &&
    (hasLegacyChar || hasSystemSub)
  ) {
    const anchor = prompts.find(
      (e) =>
        e.groupId === charG.id &&
        (e.bindingSlot === 'boundCharacterSystem' ||
          e.bindingSlot === 'boundCharSystemPrompt'),
    )
    const insertAfter =
      anchor?.order ??
      prompts
        .filter((e) => e.groupId === charG.id)
        .reduce((m, e) => Math.max(m, e.order), -1)
    prompts = prompts.map((e) =>
      e.groupId === charG.id && e.order > insertAfter
        ? { ...e, order: e.order + 1 }
        : e,
    )
    prompts.push(
      deps.makeBindingSlotEntry(
        charG.id,
        'boundUserPersona',
        insertAfter + 1,
        'binding-slot-user-persona',
      ),
    )
  }

  if (histG && !hasSystemSub && !hasLegacyChar) {
    prompts = ensureSystemSubBlocks(
      prompts,
      histG,
      deps.DEFAULT_HISTORY_SYSTEM_SLOTS,
      deps,
      'binding-slot',
    )
  } else if (
    histG &&
    !prompts.some((e) => e.bindingSlot === 'boundCharacterPostHistory')
  ) {
    prompts = deps.pinPostHistoryAfterChatHistory(
      prompts,
      histG.id,
      (slot, order, id, enabled = true) =>
        deps.makeBindingSlotEntry(histG.id, slot, order, id, enabled),
    )
  }

  if (
    worldG &&
    !prompts.some((e) => e.bindingSlot === 'boundWorld') &&
    !prompts.some(
      (e) =>
        e.bindingSlot === 'boundWorldBefore' ||
        e.bindingSlot === 'boundWorldAfter',
    )
  ) {
    if (hasSystemSub || !hasLegacyChar) {
      prompts = ensureSystemSubBlocks(
        prompts,
        worldG,
        deps.DEFAULT_WORLD_SYSTEM_SLOTS,
        deps,
        'binding-slot',
      )
    } else {
      prompts = prompts.map((e) =>
        e.groupId === worldG.id ? { ...e, order: e.order + 1 } : e,
      )
      prompts.push(
        deps.makeBindingSlotEntry(worldG.id, 'boundWorld', 0, 'binding-slot-world'),
      )
    }
  }

  if (
    userInputG &&
    !prompts.some((e) => e.bindingSlot === 'boundUserInput')
  ) {
    prompts = prompts.map((e) =>
      e.groupId === userInputG.id ? { ...e, order: e.order + 1 } : e,
    )
    prompts.push(
      deps.makeBindingSlotEntry(
        userInputG.id,
        'boundUserInput',
        0,
        'binding-slot-user-input',
      ),
    )
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

  if (charG) {
    prompts = deps.migrateCharacterGroupToFlatOrder(prompts, charG.id)
    prompts = deps.finalizeCharacterGroupBindings(
      prompts,
      charG.id,
      (slot, order, id, enabled = true) =>
        deps.makeBindingSlotEntry(charG.id, slot, order, id, enabled),
      {
        legacySystemPromptEnabled: opts.legacySystemPromptEnabled,
      },
    )
  }

  return { ...p, groups: normalizeGroups(p.groups), prompts }
}
