import type { NotificationRecord } from './notification-storage.js'

export const DESKTOP_NOTIFY_ENABLED_KEY = 'arousal-desktop-notify-enabled'

export function readDesktopNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(DESKTOP_NOTIFY_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeDesktopNotifyEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(DESKTOP_NOTIFY_ENABLED_KEY, '1')
    } else {
      localStorage.removeItem(DESKTOP_NOTIFY_ENABLED_KEY)
    }
  } catch {
    /* private mode */
  }
}

export function desktopNotifyPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestDesktopNotifyPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function maybeShowDesktopNotification(record: NotificationRecord): void {
  if (typeof document === 'undefined' || !document.hidden) return
  if (!readDesktopNotifyEnabled()) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return
  }

  try {
    const body = record.body?.trim()
    const notification = new Notification(record.title, {
      body: body || undefined,
      tag: record.dedupeKey ?? record.id,
      silent: false,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    /* quota / blocked */
  }
}
