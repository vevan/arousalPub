import {
  NOTIFICATION_MAX_ITEMS,
  readNotificationEnvelope,
  writeNotificationEnvelope,
  type NotificationRecord,
  type NotificationSnackbarAction,
} from '../utils/notification-storage'
import { filterNotificationRecords } from '../utils/notification-list-filter'
import { maybeShowDesktopNotification } from '../utils/desktop-notification'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type SnackbarDismissReason = 'close' | 'timeout' | 'action'

export type SnackbarQueueItem = {
  notificationId: string
  text: string
  color: string
  timeout: number
  multiLine?: boolean
  snackbarActions?: NotificationSnackbarAction[]
}

export type NotificationNotifyInput = {
  title: string
  body?: string
  level?: NotificationRecord['level']
  source?: NotificationRecord['source']
  action?: NotificationRecord['action']
  snackbarActions?: NotificationRecord['snackbarActions']
  dedupeKey?: string
  expiresAt?: string
  /** 默认 true */
  snackbar?: boolean
  timeout?: number
}

export type NotificationListFilter = {
  unreadOnly?: boolean
  level?: NotificationRecord['level']
  source?: NotificationRecord['source']
  searchQuery?: string
  limit?: number
}

type SnackbarHooks = {
  wrapQueueItem?: (item: SnackbarQueueItem) => SnackbarQueueItem & Record<string, unknown>
}

function sortByCreatedDesc(items: NotificationRecord[]): NotificationRecord[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function levelToSnackbarColor(level?: NotificationRecord['level']): string {
  switch (level) {
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    default:
      return 'surface-variant'
  }
}

function formatNotifyText(title: string, body?: string): string {
  const t = title.trim()
  const b = body?.trim()
  return b ? `${t}\n${b}` : t
}

function purgeExpiredItems(records: NotificationRecord[]): NotificationRecord[] {
  const now = Date.now()
  return records.filter((item) => {
    if (!item.expiresAt) return true
    const expiresMs = Date.parse(item.expiresAt)
    return !Number.isFinite(expiresMs) || expiresMs > now
  })
}

function recomputeUnread(records: NotificationRecord[]): number {
  return records.filter((item) => !item.readAt).length
}

export const useNotificationCenterStore = defineStore('notificationCenter', () => {
  const userId = ref<string | null>(null)
  const items = ref<NotificationRecord[]>([])
  const unreadCount = ref(0)
  const snackbarQueue = ref<SnackbarQueueItem[]>([])
  let snackbarHooks: SnackbarHooks = {}

  const hasUnread = computed(() => unreadCount.value > 0)

  function applyEnvelope(envelope: ReturnType<typeof readNotificationEnvelope>): void {
    const purged = purgeExpiredItems(envelope.items)
    items.value = sortByCreatedDesc(purged)
    unreadCount.value = recomputeUnread(items.value)
  }

  function flushToStorage(): void {
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

  function clearTransient(): void {
    snackbarQueue.value = []
  }

  function bindUser(uid: string | null | undefined): void {
    const next = typeof uid === 'string' && uid.trim() ? uid.trim() : null
    if (next === userId.value) return
    userId.value = next
    clearTransient()
    if (!next) {
      items.value = []
      unreadCount.value = 0
      return
    }
    syncFromStorage()
  }

  function clearSession(): void {
    userId.value = null
    items.value = []
    unreadCount.value = 0
    clearTransient()
  }

  function registerSnackbarHooks(hooks: SnackbarHooks): void {
    snackbarHooks = hooks
  }

  function commitRecord(record: NotificationRecord): void {
    const withoutDup = items.value.filter((item) => item.id !== record.id)
    const next = purgeExpiredItems(
      sortByCreatedDesc([record, ...withoutDup]),
    ).slice(0, NOTIFICATION_MAX_ITEMS)
    items.value = next
    unreadCount.value = recomputeUnread(next)
    flushToStorage()
  }

  function replaceCommittedByDedupeKey(
    dedupeKey: string,
    record: NotificationRecord,
  ): boolean {
    const index = items.value.findIndex((item) => item.dedupeKey === dedupeKey)
    if (index < 0) return false
    const without = items.value.filter((item) => item.id !== record.id)
    const next = purgeExpiredItems(
      sortByCreatedDesc([record, ...without.filter((item) => item.dedupeKey !== dedupeKey)]),
    ).slice(0, NOTIFICATION_MAX_ITEMS)
    items.value = next
    unreadCount.value = recomputeUnread(next)
    flushToStorage()
    return true
  }

  function findCommittedIdByDedupeKey(dedupeKey: string): string | null {
    const existing = items.value.find((item) => item.dedupeKey === dedupeKey)
    return existing?.id ?? null
  }

  function removeSnackbarForNotification(id: string): void {
    snackbarQueue.value = snackbarQueue.value.filter(
      (item) => item.notificationId !== id,
    )
  }

  function buildRecord(input: NotificationNotifyInput, id: string): NotificationRecord {
    const now = new Date().toISOString()
    return {
      id,
      createdAt: now,
      readAt: null,
      title: input.title,
      body: input.body?.trim() || undefined,
      level: input.level,
      source: input.source,
      action: input.action,
      snackbarActions: input.snackbarActions,
      dedupeKey: input.dedupeKey,
      expiresAt: input.expiresAt,
    }
  }

  function enqueueSnackbar(record: NotificationRecord, timeout?: number): void {
    const item: SnackbarQueueItem = {
      notificationId: record.id,
      text: formatNotifyText(record.title, record.body),
      color: levelToSnackbarColor(record.level),
      timeout: timeout ?? 4000,
      multiLine: true,
      snackbarActions: record.snackbarActions,
    }
    const wrapped = snackbarHooks.wrapQueueItem?.(item) ?? item
    snackbarQueue.value = [...snackbarQueue.value, wrapped as SnackbarQueueItem]
  }

  function notify(input: NotificationNotifyInput): string {
    const dedupeKey = input.dedupeKey?.trim() || undefined
    let id: string = crypto.randomUUID()

    if (dedupeKey) {
      const existingId = findCommittedIdByDedupeKey(dedupeKey)
      if (existingId) {
        id = existingId
      }
    }

    const record: NotificationRecord = {
      ...buildRecord(input, id),
      readAt: null,
    }

    const showSnackbar = input.snackbar !== false

    if (dedupeKey && replaceCommittedByDedupeKey(dedupeKey, record)) {
      // merged into existing list row
    } else {
      commitRecord(record)
    }

    if (showSnackbar) {
      removeSnackbarForNotification(id)
      enqueueSnackbar(record, input.timeout)
    }

    maybeShowDesktopNotification(record)

    return id
  }

  function dismissSnackbar(id: string, reason: SnackbarDismissReason): void {
    snackbarQueue.value = snackbarQueue.value.filter(
      (item) => item.notificationId !== id,
    )

    if (reason === 'close' || reason === 'action') {
      deleteNotifications(id)
    }
  }

  function replaceSnackbarQueue(next: SnackbarQueueItem[]): void {
    snackbarQueue.value = next
  }

  function list(filter?: NotificationListFilter): NotificationRecord[] {
    return filterNotificationRecords(items.value, filter)
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
    unreadCount.value = recomputeUnread(items.value)
    flushToStorage()
  }

  function deleteNotifications(id: string | string[]): void {
    const ids = new Set(Array.isArray(id) ? id : [id])
    const next = items.value.filter((item) => !ids.has(item.id))
    if (next.length === items.value.length) return
    items.value = next
    unreadCount.value = recomputeUnread(next)
    flushToStorage()
  }

  function purgeExpired(): void {
    const next = purgeExpiredItems(items.value)
    if (next.length === items.value.length) return
    items.value = next
    unreadCount.value = recomputeUnread(next)
    flushToStorage()
  }

  function deleteAll(): void {
    if (items.value.length === 0) return
    items.value = []
    unreadCount.value = 0
    flushToStorage()
  }

  return {
    userId,
    items,
    unreadCount,
    snackbarQueue,
    hasUnread,
    bindUser,
    clearSession,
    syncFromStorage,
    registerSnackbarHooks,
    notify,
    dismissSnackbar,
    replaceSnackbarQueue,
    list,
    markRead,
    delete: deleteNotifications,
    deleteAll,
    purgeExpired,
  }
})
