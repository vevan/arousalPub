import type {
  PromptBindingSlot,
  PromptEntry,
  PromptPreset,
} from './assemble-prompts.js'
import type {
  PromptPreset as SharedPromptPreset,
  NormalizePresetDeps,
} from './shared/prompt-preset-normalize.js'
import { normalizePresetCore } from './shared/prompt-preset-normalize.js'
import {
  DEFAULT_CHARACTER_SYSTEM_SLOTS,
  DEFAULT_HISTORY_SYSTEM_SLOTS,
  DEFAULT_WORLD_SYSTEM_SLOTS,
  finalizeCharacterGroupBindings,
  migrateCharacterGroupToFlatOrder,
  pinPostHistoryAfterChatHistory,
  presetUsesSystemSubBlocks,
} from './system-binding-slots.js'

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

const NORMALIZE_DEPS = {
  presetUsesSystemSubBlocks,
  pinPostHistoryAfterChatHistory,
  migrateCharacterGroupToFlatOrder,
  finalizeCharacterGroupBindings,
  DEFAULT_CHARACTER_SYSTEM_SLOTS,
  DEFAULT_HISTORY_SYSTEM_SLOTS,
  DEFAULT_WORLD_SYSTEM_SLOTS,
  makeBindingSlotEntry,
}

/** 组装前补全绑定槽（与 Web `normalizePreset` 共用 `shared/prompt-preset-normalize`）。 */
export function normalizePresetForAssemble(p: PromptPreset): PromptPreset {
  return normalizePresetCore(
    p as unknown as SharedPromptPreset,
    NORMALIZE_DEPS as unknown as NormalizePresetDeps,
  ) as PromptPreset
}
