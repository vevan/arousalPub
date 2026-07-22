import type { GroupPickerItem } from '@/utils/entry-group-transfer'

export type BatchTransferMode = 'copy' | 'move'

export type BatchLibraryItem = {
  id: string
  name: string
}

export type BatchTransferTarget = {
  libraryId: string
  groupId: string
}

/** 在目标组末尾连续分配 order（从 max+1 起） */
export function allocateTrailingOrders(
  existingOrders: number[],
  count: number,
): number[] {
  const max = existingOrders.reduce((m, o) => Math.max(m, o), -1)
  return Array.from({ length: count }, (_, i) => max + 1 + i)
}

export function toggleIdInList(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export function mergeSelectAllVisible(
  selectedIds: string[],
  visibleIds: string[],
): string[] {
  const set = new Set(selectedIds)
  for (const id of visibleIds) set.add(id)
  return [...set]
}

/** move 时：同源同组不可选 */
export function isBatchGroupDisabled(
  mode: BatchTransferMode,
  group: GroupPickerItem,
  opts: {
    currentLibraryId: string
    targetLibraryId: string
    currentGroupId?: string | null
  },
): boolean {
  if (group.disabled) return true
  if (mode !== 'move') return false
  if (opts.targetLibraryId !== opts.currentLibraryId) return false
  return Boolean(opts.currentGroupId && group.id === opts.currentGroupId)
}

/** 批处理：跳过有 bindingSlot 的提示词 id */
export function partitionPromptIdsForBatch<
  T extends { id: string; bindingSlot?: string },
>(entries: T[], ids: string[]): { transferable: T[]; skippedSlots: number } {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const transferable: T[] = []
  let skippedSlots = 0
  for (const id of ids) {
    const e = byId.get(id)
    if (!e) continue
    if (e.bindingSlot) {
      skippedSlots++
      continue
    }
    transferable.push(e)
  }
  return { transferable, skippedSlots }
}

/**
 * 同库批量移动后重建 entries：源组重排 order，目标组末尾追加（保留 selection 顺序）。
 */
export function rebuildEntriesAfterSameLibraryMove<
  T extends { id: string; groupId: string; order: number },
>(
  entries: T[],
  moveIds: Set<string>,
  movedInOrder: T[],
  targetGroupId: string,
  stamp: (e: T, order: number) => T,
): T[] {
  const others = entries.filter((e) => !moveIds.has(e.id))
  const targetRest = others
    .filter((e) => e.groupId === targetGroupId)
    .slice()
    .sort((a, b) => a.order - b.order)
  let nextOrder = targetRest.length
  const moved = movedInOrder.map((e) =>
    stamp({ ...e, groupId: targetGroupId }, nextOrder++),
  )

  const byGroup = new Map<string, T[]>()
  for (const e of others) {
    if (e.groupId === targetGroupId) continue
    let list = byGroup.get(e.groupId)
    if (!list) {
      list = []
      byGroup.set(e.groupId, list)
    }
    list.push(e)
  }
  const rebuilt: T[] = []
  for (const list of byGroup.values()) {
    list
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((e, i) => rebuilt.push(stamp(e, i)))
  }
  targetRest.forEach((e, i) => rebuilt.push(stamp(e, i)))
  rebuilt.push(...moved)
  return rebuilt
}

/** 删除一批条目后，按组重排剩余条目的 order */
export function rebuildEntriesAfterRemoval<
  T extends { id: string; groupId: string; order: number },
>(
  entries: T[],
  removeIds: Set<string>,
  stamp: (e: T, order: number) => T = (e, order) => ({ ...e, order }),
): T[] {
  const remaining = entries.filter((e) => !removeIds.has(e.id))
  const byGroup = new Map<string, T[]>()
  for (const e of remaining) {
    let list = byGroup.get(e.groupId)
    if (!list) {
      list = []
      byGroup.set(e.groupId, list)
    }
    list.push(e)
  }
  const rebuilt: T[] = []
  for (const list of byGroup.values()) {
    list
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((e, i) => rebuilt.push(stamp(e, i)))
  }
  return rebuilt
}
