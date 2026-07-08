import {
  NOTIFICATION_MAX_ITEMS,
  notificationStorageKey,
  readNotificationEnvelope,
  writeNotificationEnvelope,
  type NotificationRecord,
} from '@/utils/notification-storage'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type NotificationSendInput = {
  title: string
  body?: string
  level?: NotificationRecord['level']
  source?: NotificationRecord['source']
  action?: NotificationRecord['action']
  snackbarActions?: NotificationRecord['snackbarActions']
  dedupeKey?: string
  expiresAt?: string
}

export type NotificationListFilter = {
  unreadOnly?: boolean
  source?: NotificationRecord['source']
  limit?: number
}

function sortByCreatedDesc(items: NotificationRecord[]): NotificationRecord[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const useNotificationCenterStore = defineStore('notificationCenter', () => {
  const userId = ref<string | null>(null)
  const items = ref<NotificationRecord[]>([])
  const unreadCount = ref(0)
  let storageListener: ((e: StorageEvent) => void) | null = null

  const hasUnread = computed(() => unreadCount.value > 0)

  function applyEnvelope(envelope: ReturnType<typeof readNotificationEnvelope>): void {
    items.value = sortByCreatedDesc(envelope.items)
    unreadCount.value = envelope.unreadCount
  }

  function persist(): void {
    if (!userId.value) return
    writeNotificationEnvelope(userId.value, {
      schemaVersion: 1,
      unreadCount: unreadCount.value,
      items: items.value,
    })
  }

  function syncFromStorage(): void {
    if (!userId.value) return
    applyEnvelope(readNotificationEnvelope(userId.value))
  }

  function teardownStorageListener(): void {
    if (storageListener && typeof window !== 'undefined') {
      window.removeEventListener('storage', storageListener)
    }
    storageListener = null
  }

  function bindUser(uid: string | null | undefined): void {
    const next = typeof uid === 'string' && uid.trim() ? uid.trim() : null
    if (next === userId.value) return
    teardownStorageListener()
    userId.value = next
    if (!next) {
      items.value = []
      unreadCount.value = 0
      return
    }
    syncFromStorage()
    if (typeof window === 'undefined') return
    const boundKey = notificationStorageKey(next)
    storageListener = (e: StorageEvent) => {
      if (!userId.value) return
      if (e.key !== boundKey) return
      syncFromStorage()
    }
    window.addEventListener('storage', storageListener)
  }

  function clearSession(): void {
    teardownStorageListener()
    userId.value = null
    items.value = []
    unreadCount.value = 0
  }

  function send(input: NotificationSendInput): NotificationRecord {
    const now = new Date().toISOString()
    const record: NotificationRecord = {
      id: crypto.randomUUID(),
      createdAt: now,
      readAt: null,
      title: input.title,
      body: input.body,
      level: input.level,
      source: input.source,
      action: input.action,
      snackbarActions: input.snackbarActions,
      dedupeKey: input.dedupeKey,
      expiresAt: input.expiresAt,
    }
    const next = [record, ...items.value].slice(0, NOTIFICATION_MAX_ITEMS)
    items.value = next
    unreadCount.value = next.filter((item) => !item.readAt).length
    persist()
    return record
  }

  function list(filter?: NotificationListFilter): NotificationRecord[] {
    let result = items.value
    if (filter?.unreadOnly) {
      result = result.filter((item) => !item.readAt)
    }
    if (filter?.source?.kind) {
      result = result.filter((item) => item.source?.kind === filter.source?.kind)
    }
    if (filter?.source?.pluginId) {
      result = result.filter(
        (item) => item.source?.pluginId === filter.source?.pluginId,
      )
    }
    if (typeof filter?.limit === 'number' && filter.limit > 0) {
      result = result.slice(0, filter.limit)
    }
    return result
  }

  function markRead(id: string | string[] | 'all'): void {
    const now = new Date().toISOString()
    const ids =
      id === 'all'
        ? null
        : new Set(Array.isArray(id) ? id : [id])
    let changed = false
    items.value = items.value.map((item) => {
      if (id !== 'all' && !ids?.has(item.id)) return item
      if (item.readAt) return item
      changed = true
      return { ...item, readAt: now }
    })
    if (!changed) return
    unreadCount.value = items.value.filter((item) => !item.readAt).length
    persist()
  }

  function deleteNotifications(id: string | string[]): void {
    const ids = new Set(Array.isArray(id) ? id : [id])
    const next = items.value.filter((item) => !ids.has(item.id))
    if (next.length === items.value.length) return
    items.value = next
    unreadCount.value = next.filter((item) => !item.readAt).length
    persist()
  }

  function deleteAll(): void {
    if (items.value.length === 0) return
    items.value = []
    unreadCount.value = 0
    persist()
  }

  return {
    userId,
    items,
    unreadCount,
    hasUnread,
    bindUser,
    clearSession,
    syncFromStorage,
    send,
    list,
    markRead,
    delete: deleteNotifications,
    deleteAll,
  }
})
