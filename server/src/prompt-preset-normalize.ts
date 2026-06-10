import type {
  PromptBindingSlot,
  PromptEntry,
  PromptGroup,
  PromptPreset,
} from './assemble-prompts.js'

function normalizeGroups(groups: PromptGroup[]): PromptGroup[] {
  return groups.map((g) => ({
    ...g,
    description: g.description ?? '',
    enabled: g.enabled !== false,
  }))
}

function bindingSlotIsRequired(slot: PromptBindingSlot | undefined): boolean {
  return slot === 'boundWorld' || slot === 'boundUserInput'
}

function makeBindingSlotEntry(
  groupId: string,
  slot: PromptBindingSlot,
  order: number,
  id: string,
): PromptEntry {
  const t = new Date().toISOString()
  return {
    id,
    groupId,
    title: '',
    content: '',
    description: '',
    tags: [],
    enabled: true,
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

/**
 * 组装前补全 boundWorld / boundUserInput 等绑定槽（与 Web `normalizePreset` 对齐，避免旧预设缺槽只显示占位符）。
 */
export function normalizePresetForAssemble(p: PromptPreset): PromptPreset {
  const worldG = p.groups.find((g) => g.kind === 'world')
  const userInputG = p.groups.find((g) => g.kind === 'userInput')

  let prompts = p.prompts.map((e) => ({
    ...e,
    enabled: bindingSlotIsRequired(e.bindingSlot) ? true : e.enabled,
  }))

  if (worldG && !prompts.some((e) => e.bindingSlot === 'boundWorld')) {
    prompts = prompts.map((e) =>
      e.groupId === worldG.id ? { ...e, order: e.order + 1 } : e,
    )
    prompts.push(
      makeBindingSlotEntry(worldG.id, 'boundWorld', 0, 'binding-slot-world'),
    )
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

  return { ...p, groups: normalizeGroups(p.groups), prompts }
}
