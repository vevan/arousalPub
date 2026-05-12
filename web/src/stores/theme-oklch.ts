import {
  darkOklchColors,
  lightOklchColors,
} from '@/theme/oklch-defaults'
import { derivePrimaryDarken1 } from '@/theme/oklch-convert'
import {
  mergeOklchColors,
  readOklchOverrides,
  writeOklchOverrides,
  type ThemeOklchOverrides,
} from '@/theme/overrides-storage'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useThemeOklchStore = defineStore('themeOklch', () => {
  const overrides = ref<ThemeOklchOverrides>(readOklchOverrides())

  function reloadFromStorage() {
    overrides.value = readOklchOverrides()
  }

  function mergedPrimaryOklch(mode: 'dark' | 'light'): string {
    const base = mode === 'dark' ? darkOklchColors : lightOklchColors
    return mergeOklchColors(base, overrides.value[mode]).primary
  }

  function savePrimary(mode: 'dark' | 'light', primaryOklch: string) {
    const darken = derivePrimaryDarken1(primaryOklch)
    const next: ThemeOklchOverrides = {
      ...overrides.value,
      [mode]: {
        ...overrides.value[mode],
        primary: primaryOklch,
        'primary-darken-1': darken,
      },
    }
    overrides.value = next
    writeOklchOverrides(next)
  }

  function resetPrimary(mode: 'dark' | 'light') {
    const cur = { ...(overrides.value[mode] ?? {}) }
    delete cur.primary
    delete cur['primary-darken-1']
    const next: ThemeOklchOverrides = { ...overrides.value }
    if (Object.keys(cur).length === 0) {
      delete next[mode]
    } else {
      next[mode] = cur
    }
    overrides.value = next
    writeOklchOverrides(next)
  }

  return {
    overrides,
    reloadFromStorage,
    mergedPrimaryOklch,
    savePrimary,
    resetPrimary,
  }
})
