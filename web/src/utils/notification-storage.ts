export const NOTIFICATION_STORAGE_PREFIX = 'arousal-notifications'
export const NOTIFICATION_MAX_ITEMS = 200
export const NOTIFICATION_SCHEMA_VERSION = 1

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export type NotificationAction = {
  type: 'route' | 'conversation' | 'settings-tab' | 'external'
  href?: string
  conversationId?: string
  settingsTab?: string
}

export type NotificationSnackbarAction = {
  label: string
  action?: NotificationAction
}

export type NotificationRecord = {
  id: string
  createdAt: string
  readAt?: string | null
  title: string
  body?: string
  level?: NotificationLevel
  source?: {
    kind: 'core' | 'plugin'
    pluginId?: string
  }
  action?: NotificationAction
  snackbarActions?: NotificationSnackbarAction[]
  dedupeKey?: string
  expiresAt?: string
}

export type NotificationEnvelope = {
  schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION
  unreadCount: number
  items: NotificationRecord[]
}

export function notificationStorageKey(userId?: string | null): string {
  const uid = typeof userId === 'string' && userId.trim() ? userId.trim() : 'anonymous'
  return `${NOTIFICATION_STORAGE_PREFIX}-${uid}`
}

function emptyEnvelope(): NotificationEnvelope {
  return {
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    unreadCount: 0,
    items: [],
  }
}

function computeUnreadCount(items: NotificationRecord[]): number {
  return items.filter((item) => !item.readAt).length
}

function normalizeRecord(raw: unknown): NotificationRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<NotificationRecord>
  if (typeof r.id !== 'string' || !r.id.trim()) return null
  if (typeof r.title !== 'string') return null
  if (typeof r.createdAt !== 'string' || !r.createdAt.trim()) return null
  return {
    id: r.id.trim(),
    createdAt: r.createdAt.trim(),
    readAt: r.readAt ?? null,
    title: r.title,
    body: typeof r.body === 'string' ? r.body : undefined,
    level: r.level,
    source: r.source,
    action: r.action,
    snackbarActions: Array.isArray(r.snackbarActions) ? r.snackbarActions : undefined,
    dedupeKey: typeof r.dedupeKey === 'string' ? r.dedupeKey : undefined,
    expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : undefined,
  }
}

function normalizeEnvelope(raw: unknown): NotificationEnvelope {
  if (!raw || typeof raw !== 'object') return emptyEnvelope()
  const doc = raw as Partial<NotificationEnvelope>
  if (doc.schemaVersion !== NOTIFICATION_SCHEMA_VERSION) return emptyEnvelope()
  const items = Array.isArray(doc.items)
    ? doc.items
        .map(normalizeRecord)
        .filter((item): item is NotificationRecord => item != null)
        .slice(0, NOTIFICATION_MAX_ITEMS)
    : []
  const unreadCount =
    typeof doc.unreadCount === 'number' && Number.isFinite(doc.unreadCount)
      ? Math.max(0, Math.min(items.length, Math.floor(doc.unreadCount)))
      : computeUnreadCount(items)
  return {
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    unreadCount,
    items,
  }
}

export function readNotificationEnvelope(
  userId?: string | null,
): NotificationEnvelope {
  try {
    const raw = localStorage.getItem(notificationStorageKey(userId))
    if (!raw) return emptyEnvelope()
    return normalizeEnvelope(JSON.parse(raw))
  } catch {
    return emptyEnvelope()
  }
}

export function writeNotificationEnvelope(
  userId: string | null | undefined,
  envelope: NotificationEnvelope,
): void {
  const items = envelope.items.slice(0, NOTIFICATION_MAX_ITEMS)
  const normalized: NotificationEnvelope = {
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    unreadCount: computeUnreadCount(items),
    items,
  }
  try {
    localStorage.setItem(
      notificationStorageKey(userId),
      JSON.stringify(normalized),
    )
  } catch {
    /* quota / private mode */
  }
}
