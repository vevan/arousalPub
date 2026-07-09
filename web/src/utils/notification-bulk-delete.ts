export type NotificationBulkDeletePlan =
  | { scope: 'all' }
  | { scope: 'ids'; ids: string[] }

/** 列表截断时只删当前可见条目，避免一次清空未展示的 51+ 条。 */
export function planNotificationBulkDelete(opts: {
  displayItemIds: string[]
  filteredItemIds: string[]
  listTruncated: boolean
  hasActiveFilter: boolean
}): NotificationBulkDeletePlan {
  const { displayItemIds, filteredItemIds, listTruncated, hasActiveFilter } = opts
  if (listTruncated) {
    return { scope: 'ids', ids: displayItemIds }
  }
  if (hasActiveFilter) {
    return { scope: 'ids', ids: filteredItemIds }
  }
  return { scope: 'all' }
}
