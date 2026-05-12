import {
  type AppLocale,
  effectiveLocale,
  readStoredLocalePreference,
} from '@/i18n/locale'
import { createI18n } from 'vue-i18n'
import en from '../locales/en.json'
import zh from '../locales/zh.json'

const initialPreference = readStoredLocalePreference()
const initialLocale: AppLocale = effectiveLocale(initialPreference)

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: {
    en,
    zh,
  },
})
