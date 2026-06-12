import type { LorebookGroup } from '@/stores/lorebooks'
import type { PromptEntry, PromptGroup } from '@/stores/prompts'
import { groupAllowsPromptEntries } from '@/stores/prompts'

/** 提示词条目是否可迁入目标分组 */
export function promptEntryAllowedInGroup(
  entry: Pick<PromptEntry, 'bindingSlot'>,
  group: Pick<PromptGroup, 'kind'>,
): boolean {
  if (!groupAllowsPromptEntries(group.kind)) return false
  const slot = entry.bindingSlot
  if (!slot) return true
  if (slot === 'boundCharacterSystem') return group.kind === 'character'
  if (slot === 'boundUserPersona') return group.kind === 'character'
  if (slot === 'boundCharacterPostHistory') return group.kind === 'history'
  if (slot === 'boundWorld') return group.kind === 'world'
  if (slot === 'boundUserInput') return group.kind === 'userInput'
  return false
}

export interface GroupPickerItem {
  id: string
  name: string
  count: number
  disabled?: boolean
}

export function lorebookGroupPickerItems(
  groups: LorebookGroup[],
  counts: Record<string, number>,
): GroupPickerItem[] {
  return groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      id: g.id,
      name: g.name,
      count: counts[g.id] ?? 0,
    }))
}

export function promptGroupPickerItems(
  groups: PromptGroup[],
  counts: Record<string, number>,
  entry: Pick<PromptEntry, 'bindingSlot'> | null,
): GroupPickerItem[] {
  return groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      id: g.id,
      name: g.name,
      count: counts[g.id] ?? 0,
      disabled: entry
        ? !promptEntryAllowedInGroup(entry, g)
        : !groupAllowsPromptEntries(g.kind),
    }))
}
