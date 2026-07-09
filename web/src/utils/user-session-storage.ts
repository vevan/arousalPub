import { DESKTOP_NOTIFY_ENABLED_KEY } from './desktop-notification.js'

/** 登出后保留的设备级 localStorage（非用户会话缓存） */
const PRESERVED_LOCAL_STORAGE_KEYS = new Set([
  'arousal-auth-token',
  'arousal-auth-refresh',
  'arousal-default-user-id',
  'arousal-locale-pref',
  'arousal-theme',
  'arousal-vuetify-appearance',
  'arousal-theme-oklch-overrides',
  'arousal-home-list-mode-default',
  'arousal-home-character-source-default',
  'arousal-chat-font-size-rem',
  'arousal-composer-enter-mode',
  'arousal-plugin-panel-hidden',
  DESKTOP_NOTIFY_ENABLED_KEY,
])

const USER_SESSION_PREFIX = 'arousal-'

/** 移除用户会话相关的 `arousal-*` localStorage（保留设备 UI / 登录记忆键） */
export function clearUserSessionLocalStorage(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(USER_SESSION_PREFIX)) continue
      if (PRESERVED_LOCAL_STORAGE_KEYS.has(key)) continue
      localStorage.removeItem(key)
    }
  } catch {
    /* private mode / disabled storage */
  }
}

/** 登出时清空 sessionStorage（导航回退标记等） */
export function clearUserSessionStorage(): void {
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}
