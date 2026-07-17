import { executeNotificationAction } from './notification-action.js'
import type { NotificationRecord } from './notification-storage.js'

export const DESKTOP_NOTIFY_ENABLED_KEY = 'arousal-desktop-notify-enabled'

/** `renotify` 是标准 Notification API 字段，但 TS lib.dom 类型尚未收录 */
type NotificationOptionsWithRenotify = NotificationOptions & {
  renotify?: boolean
}

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

/** OS 通知 tag 须每次唯一；勿复用 dedupeKey（重复测试会替换旧通知且不弹横幅） */
function desktopNotificationTag(record: NotificationRecord): string {
  return record.id
}

function canShowDesktopNotification(): boolean {
  if (!readDesktopNotifyEnabled()) return false
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false
  }
  return true
}

function warnDesktopFailure(error: unknown, record: NotificationRecord): void {
  if (!import.meta.env.DEV) return
  const msg = error instanceof Error ? error.message : String(error)
  console.warn('[desktop-notification] show failed:', msg, record.title)
}

function showDesktopNotificationNow(record: NotificationRecord): boolean {
  try {
    const body = record.body?.trim()
    const options: NotificationOptionsWithRenotify = {
      body: body || undefined,
      tag: desktopNotificationTag(record),
      renotify: true,
      silent: false,
    }
    const notification = new Notification(record.title, options)
    notification.onclick = () => {
      window.focus()
      if (record.action) {
        void executeNotificationAction(record.action)
      }
      notification.close()
    }
    return true
  } catch (error) {
    warnDesktopFailure(error, record)
    return false
  }
}

export function getDesktopNotificationDebugState(): {
  enabled: boolean
  permission: string
  hidden: boolean
} {
  return {
    enabled: readDesktopNotifyEnabled(),
    permission:
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    hidden: typeof document !== 'undefined' ? document.hidden : false,
  }
}

/** 控制台探测：切到别的 Tab 后执行 `__arousalProbeDesktopNotify()` */
export function probeDesktopNotification(): {
  ok: boolean
  detail: string
  state: ReturnType<typeof getDesktopNotificationDebugState>
} {
  const state = getDesktopNotificationDebugState()
  if (!canShowDesktopNotification()) {
    return {
      ok: false,
      detail: 'disabled or permission not granted',
      state,
    }
  }
  if (!state.hidden) {
    return {
      ok: false,
      detail: 'tab is visible — switch away first',
      state,
    }
  }
  try {
    const tag = `probe-${Date.now()}`
    const probeOptions: NotificationOptionsWithRenotify = {
      body: 'Tab 在后台',
      tag,
      renotify: true,
    }
    const n = new Notification('Arousal 通知探测', probeOptions)
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return { ok: true, detail: `created tag=${tag}`, state }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      state,
    }
  }
}

/** 单测占位 */
export function resetDesktopNotificationStateForTests(): void {}

/**
 * 仅当 notify 触发时 Tab 已在后台才弹系统通知。
 * 前台触发的通知只走浮层/铃铛，切后台时不补弹。
 */
export function maybeShowDesktopNotification(record: NotificationRecord): void {
  if (typeof document === 'undefined' || !document.hidden) return
  if (!canShowDesktopNotification()) return
  showDesktopNotificationNow(record)
}

if (typeof window !== 'undefined') {
  const w = window as Window & {
    __arousalProbeDesktopNotify?: typeof probeDesktopNotification
    __arousalDesktopNotifyState?: typeof getDesktopNotificationDebugState
  }
  w.__arousalProbeDesktopNotify = probeDesktopNotification
  w.__arousalDesktopNotifyState = getDesktopNotificationDebugState
}
