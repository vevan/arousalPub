import {
  type AppLocale,
  effectiveLocale,
  readStoredLocalePreference,
} from '@/i18n/locale'
import { createI18n } from 'vue-i18n'

const initialPreference = readStoredLocalePreference()
const initialLocale: AppLocale = effectiveLocale(initialPreference)

const localeLoaders: Record<
  AppLocale,
  () => Promise<{ default: Record<string, unknown> }>
> = {
  en: () => import('../locales/en.json'),
  zh: () => import('../locales/zh.json'),
}

const loadedLocales = new Set<AppLocale>()

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: {},
})

export async function ensureLocaleMessages(locale: AppLocale): Promise<void> {
  if (loadedLocales.has(locale)) return
  const mod = await localeLoaders[locale]()
  i18n.global.setLocaleMessage(locale, mod.default)
  loadedLocales.add(locale)
}

export async function bootstrapI18n(): Promise<void> {
  await ensureLocaleMessages(initialLocale)
  if (initialLocale !== 'en') {
    await ensureLocaleMessages('en')
  }
}
