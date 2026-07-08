/** 当前选中的 Vuetify 主题（仅深色 / 浅色） */
export type AppThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'arousal-theme'

export function readStoredTheme(): AppThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function writeStoredTheme(mode: AppThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}
