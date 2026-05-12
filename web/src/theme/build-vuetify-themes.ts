import type { ThemeDefinition } from 'vuetify'
import {
  darkOklchColors,
  darkOklchVariables,
  lightOklchColors,
  lightOklchVariables,
} from '@/theme/oklch-defaults'
import { mapOklchRecordToHex } from '@/theme/oklch-convert'
import {
  mergeOklchColors,
  type ThemeOklchOverrides,
} from '@/theme/overrides-storage'

const darkNumericVariables: ThemeDefinition['variables'] = {
  'border-opacity': 0.12,
  'high-emphasis-opacity': 1,
  'medium-emphasis-opacity': 0.7,
  'disabled-opacity': 0.5,
  'idle-opacity': 0.1,
  'hover-opacity': 0.04,
  'focus-opacity': 0.12,
  'selected-opacity': 0.08,
  'activated-opacity': 0.12,
  'pressed-opacity': 0.16,
  'dragged-opacity': 0.08,
}

const lightNumericVariables: ThemeDefinition['variables'] = {
  'border-opacity': 0.12,
  'high-emphasis-opacity': 0.87,
  'medium-emphasis-opacity': 0.6,
  'disabled-opacity': 0.38,
  'idle-opacity': 0.04,
  'hover-opacity': 0.04,
  'focus-opacity': 0.12,
  'selected-opacity': 0.08,
  'activated-opacity': 0.12,
  'pressed-opacity': 0.12,
  'dragged-opacity': 0.08,
}

export function buildVuetifyThemes(
  overrides: ThemeOklchOverrides = {},
): Record<string, ThemeDefinition> {
  const darkMerged = mergeOklchColors(darkOklchColors, overrides.dark)
  const lightMerged = mergeOklchColors(lightOklchColors, overrides.light)

  return {
    dark: {
      dark: true,
      colors: mapOklchRecordToHex(darkMerged),
      variables: {
        ...darkNumericVariables,
        ...mapOklchRecordToHex(darkOklchVariables),
      },
    },
    light: {
      dark: false,
      colors: mapOklchRecordToHex(lightMerged),
      variables: {
        ...lightNumericVariables,
        ...mapOklchRecordToHex(lightOklchVariables),
      },
    },
  }
}
