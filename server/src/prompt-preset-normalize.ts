import type {
  PromptBindingSlot,
  PromptEntry,
  PromptGroup,
  PromptPreset,
} from './assemble-prompts.js'
import {
  DEFAULT_CHARACTER_SYSTEM_SLOTS,
  DEFAULT_HISTORY_SYSTEM_SLOTS,
  DEFAULT_WORLD_SYSTEM_SLOTS,
  finalizeCharacterGroupBindings,
  isSystemBindingSlot,
  migrateBindingSlotAliases,
  presetUsesSystemSubBlocks,
} from './system-binding-slots.js'

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

function makeBindingSlotEntry(
  groupId: string,
  slot: PromptBindingSlot,
  order: number,
  id: string,
  enabled = true,
): PromptEntry {
  const t = new Date().toISOString()
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

function ensureSystemSubBlocks(
  prompts: PromptEntry[],
  group: PromptGroup,
  slots: PromptBindingSlot[],
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
      makeBindingSlotEntry(group.id, slot, order, `${idPrefix}-${slot}`),
    ]
    order += 1
  }
  return next
}

/**
 * 组装前补全绑定槽（与 Web `normalizePreset` 对齐，避免旧预设缺槽只显示占位符）。
 */
export function normalizePresetForAssemble(p: PromptPreset): PromptPreset {
  const charG = p.groups.find((g) => g.kind === 'character')
  const worldG = p.groups.find((g) => g.kind === 'world')
  const histG = p.groups.find((g) => g.kind === 'history')
  const userInputG = p.groups.find((g) => g.kind === 'userInput')

  let prompts = migrateBindingSlotAliases(p.prompts).map((e) => ({
    ...e,
    enabled: bindingSlotIsRequired(e.bindingSlot) ? true : e.enabled,
  }))

  const hasLegacyChar = prompts.some(
    (e) => e.bindingSlot === 'boundCharacterSystem',
  )
  const hasSystemSub = presetUsesSystemSubBlocks({ ...p, prompts })

  if (charG && !hasLegacyChar && !hasSystemSub) {
    prompts = ensureSystemSubBlocks(
      prompts,
      charG,
      DEFAULT_CHARACTER_SYSTEM_SLOTS,
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
      makeBindingSlotEntry(
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
      DEFAULT_HISTORY_SYSTEM_SLOTS,
      'binding-slot',
    )
  } else if (
    histG &&
    !prompts.some((e) => e.bindingSlot === 'boundCharacterPostHistory')
  ) {
    const maxO = prompts
      .filter((e) => e.groupId === histG.id)
      .reduce((m, e) => Math.max(m, e.order), -1)
    prompts.push(
      makeBindingSlotEntry(
        histG.id,
        'boundCharacterPostHistory',
        maxO + 1,
        'binding-slot-character-post-history',
      ),
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
        DEFAULT_WORLD_SYSTEM_SLOTS,
        'binding-slot',
      )
    } else {
      prompts = prompts.map((e) =>
        e.groupId === worldG.id ? { ...e, order: e.order + 1 } : e,
      )
      prompts.push(
        makeBindingSlotEntry(worldG.id, 'boundWorld', 0, 'binding-slot-world'),
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
      makeBindingSlotEntry(
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
    const rawLegacy = p as PromptPreset & {
      useBoundCharacterSystemPrompt?: boolean
    }
    prompts = finalizeCharacterGroupBindings(
      prompts,
      charG.id,
      (slot, order, id, enabled = true) =>
        makeBindingSlotEntry(charG.id, slot, order, id, enabled),
      {
        legacySystemPromptEnabled:
          rawLegacy.useBoundCharacterSystemPrompt !== false,
      },
    )
  }

  return { ...p, groups: normalizeGroups(p.groups), prompts }
}
