export const THEME_OKLCH_STORAGE_KEY = 'arousal-theme-oklch-overrides'

/** 按主题名存储部分颜色的 OKLCH 字符串（与 colors 键一致） */
export type ThemeOklchOverrides = Partial<{
  dark: Partial<Record<string, string>>
  light: Partial<Record<string, string>>
}>

export function readOklchOverrides(): ThemeOklchOverrides {
  try {
    const raw = localStorage.getItem(THEME_OKLCH_STORAGE_KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== 'object') return {}
    return j as ThemeOklchOverrides
  } catch {
    return {}
  }
}

export function writeOklchOverrides(overrides: ThemeOklchOverrides): void {
  try {
    const darkKeys = overrides.dark ? Object.keys(overrides.dark).length : 0
    const lightKeys = overrides.light ? Object.keys(overrides.light).length : 0
    if (darkKeys === 0 && lightKeys === 0) {
      localStorage.removeItem(THEME_OKLCH_STORAGE_KEY)
      return
    }
    localStorage.setItem(THEME_OKLCH_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    /* private mode */
  }
}

export function mergeOklchColors(
  base: Record<string, string>,
  over: Partial<Record<string, string>> | undefined,
): Record<string, string> {
  if (!over) return { ...base }
  const out: Record<string, string> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) out[k] = v
  }
  return out
}
