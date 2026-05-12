/** localStorage key for UI language preference */
export const LOCALE_PREF_STORAGE_KEY = 'arousal-locale-pref'

export type LocalePreference = 'auto' | 'en' | 'zh'

export const SUPPORTED_LOCALES = ['en', 'zh'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export function isAppLocale(v: string): v is AppLocale {
  return v === 'en' || v === 'zh'
}

/** Map navigator language list to app locale; default English. */
export function resolveBrowserLocale(): AppLocale {
  if (typeof navigator === 'undefined') return 'en'
  const list =
    navigator.languages?.length > 0
      ? navigator.languages
      : [navigator.language]
  for (const raw of list) {
    const lower = raw.toLowerCase()
    if (lower.startsWith('zh')) return 'zh'
    if (lower.startsWith('en')) return 'en'
  }
  return 'en'
}

export function effectiveLocale(preference: LocalePreference): AppLocale {
  if (preference === 'en' || preference === 'zh') return preference
  return resolveBrowserLocale()
}

export function readStoredLocalePreference(): LocalePreference {
  try {
    const v = localStorage.getItem(LOCALE_PREF_STORAGE_KEY)
    if (v === 'auto' || v === 'en' || v === 'zh') return v
  } catch {
    /* private mode / disabled storage */
  }
  return 'auto'
}

export function htmlLangTag(locale: AppLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en'
}

export function intlLocaleTag(locale: AppLocale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}
