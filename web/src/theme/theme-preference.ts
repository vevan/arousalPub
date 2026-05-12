/** 当前选中的 Vuetify 主题（仅深色 / 浅色） */
export type AppThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'arousal-theme'
const LEGACY_APPEARANCE_KEY = 'arousal-vuetify-appearance'

export function readStoredTheme(): AppThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
    const old = localStorage.getItem(LEGACY_APPEARANCE_KEY)
    if (old === 'light' || old === 'dark') return old
    if (old === 'system') {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function writeStoredTheme(mode: AppThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
    localStorage.removeItem(LEGACY_APPEARANCE_KEY)
  } catch {
    /* ignore */
  }
}
