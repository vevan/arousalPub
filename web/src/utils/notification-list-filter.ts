import type { NotificationRecord } from './notification-storage.js'

export type NotificationListQuery = {
  unreadOnly?: boolean
  level?: NotificationRecord['level']
  source?: NotificationRecord['source']
  searchQuery?: string
  limit?: number
}

export function notificationMatchesSearch(
  record: NotificationRecord,
  searchQuery?: string,
): boolean {
  const q = searchQuery?.trim().toLowerCase()
  if (!q) return true
  const hay = `${record.title}\n${record.body ?? ''}`.toLowerCase()
  return hay.includes(q)
}

export function filterNotificationRecords(
  items: NotificationRecord[],
  filter?: NotificationListQuery,
): NotificationRecord[] {
  let result = items
  if (filter?.unreadOnly) {
    result = result.filter((item) => !item.readAt)
  }
  if (filter?.level) {
    result = result.filter((item) => item.level === filter.level)
  }
  if (filter?.source?.kind) {
    result = result.filter((item) => item.source?.kind === filter.source?.kind)
  }
  if (filter?.source?.pluginId) {
    result = result.filter(
      (item) => item.source?.pluginId === filter.source?.pluginId,
    )
  }
  if (filter?.searchQuery?.trim()) {
    const q = filter.searchQuery
    result = result.filter((item) => notificationMatchesSearch(item, q))
  }
  if (typeof filter?.limit === 'number' && filter.limit > 0) {
    result = result.slice(0, filter.limit)
  }
  return result
}

export function collectPluginIds(items: NotificationRecord[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    const pluginId = item.source?.pluginId?.trim()
    if (item.source?.kind === 'plugin' && pluginId) {
      ids.add(pluginId)
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}
