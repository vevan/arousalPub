import {
  LOCALE_PREF_STORAGE_KEY,
  type LocalePreference,
  effectiveLocale,
  readStoredLocalePreference,
} from '@/i18n/locale'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export const useLocaleStore = defineStore('locale', () => {
  const preference = ref<LocalePreference>(readStoredLocalePreference())
  const effective = computed(() => effectiveLocale(preference.value))

  watch(
    preference,
    (p) => {
      try {
        localStorage.setItem(LOCALE_PREF_STORAGE_KEY, p)
      } catch {
        /* ignore */
      }
    },
    { flush: 'post' },
  )

  function setPreference(p: LocalePreference) {
    preference.value = p
  }

  return { preference, effective, setPreference }
})
