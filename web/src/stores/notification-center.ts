import {
  NOTIFICATION_MAX_ITEMS,
  notificationStorageKey,
  readNotificationEnvelope,
  writeNotificationEnvelope,
  type NotificationRecord,
  type NotificationSnackbarAction,
} from '../utils/notification-storage'
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
  /** 立即写入通知列表（未读） */
  persist?: boolean
  timeout?: number
}

export type NotificationListFilter = {
  unreadOnly?: boolean
  source?: NotificationRecord['source']
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

export const useNotificationCenterStore = defineStore('notificationCenter', () => {
  const userId = ref<string | null>(null)
  const items = ref<NotificationRecord[]>([])
  const unreadCount = ref(0)
  const snackbarQueue = ref<SnackbarQueueItem[]>([])
  const pendingById = ref(new Map<string, NotificationRecord>())
  let storageListener: ((e: StorageEvent) => void) | null = null
  let snackbarHooks: SnackbarHooks = {}

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

  function clearTransient(): void {
    snackbarQueue.value = []
    pendingById.value = new Map()
  }

  function bindUser(uid: string | null | undefined): void {
    const next = typeof uid === 'string' && uid.trim() ? uid.trim() : null
    if (next === userId.value) return
    teardownStorageListener()
    userId.value = next
    clearTransient()
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
    clearTransient()
  }

  function registerSnackbarHooks(hooks: SnackbarHooks): void {
    snackbarHooks = hooks
  }

  function commitRecord(record: NotificationRecord): void {
    const next = [record, ...items.value].slice(0, NOTIFICATION_MAX_ITEMS)
    items.value = next
    unreadCount.value = next.filter((item) => !item.readAt).length
    persist()
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
    const id = crypto.randomUUID()
    const record = buildRecord(input, id)
    const showSnackbar = input.snackbar !== false
    const persistNow = input.persist === true || input.snackbar === false

    if (persistNow) {
      commitRecord(record)
    } else {
      const pending = new Map(pendingById.value)
      pending.set(id, record)
      pendingById.value = pending
    }

    if (showSnackbar) {
      enqueueSnackbar(record, input.timeout)
    }

    return id
  }

  /** @deprecated 使用 notify；等价于 persist: true */
  function send(input: NotificationNotifyInput): NotificationRecord {
    const id = notify({ ...input, persist: true })
    return items.value.find((item) => item.id === id) ?? buildRecord(input, id)
  }

  function dismissSnackbar(id: string, reason: SnackbarDismissReason): void {
    snackbarQueue.value = snackbarQueue.value.filter(
      (item) => item.notificationId !== id,
    )

    const pending = pendingById.value.get(id)
    if (!pending) return

    const nextPending = new Map(pendingById.value)
    nextPending.delete(id)
    pendingById.value = nextPending

    if (reason === 'timeout' || reason === 'action') {
      commitRecord(pending)
    }
  }

  function replaceSnackbarQueue(next: SnackbarQueueItem[]): void {
    snackbarQueue.value = next
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
    snackbarQueue,
    hasUnread,
    bindUser,
    clearSession,
    syncFromStorage,
    registerSnackbarHooks,
    notify,
    send,
    dismissSnackbar,
    replaceSnackbarQueue,
    list,
    markRead,
    delete: deleteNotifications,
    deleteAll,
  }
})
