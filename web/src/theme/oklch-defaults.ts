/**
 * 默认主题色（OKLCH，设计源）。Vuetify 实际使用由 build-vuetify-themes 转换的 hex。
 */
export const darkOklchColors: Record<string, string> = {
  background: 'oklch(0.19 0.009 285)',
  surface: 'oklch(0.27 0.012 285)',
  'surface-bright': 'oklch(0.78 0.04 285)',
  'surface-light': 'oklch(0.38 0.018 285)',
  'surface-variant': 'oklch(0.74 0.028 285)',
  'on-surface-variant': 'oklch(0.14 0.02 285)',
  primary: 'oklch(0.68 0.15 255)',
  'primary-darken-1': 'oklch(0.58 0.14 255)',
  secondary: 'oklch(0.72 0.1 195)',
  'secondary-darken-1': 'oklch(0.62 0.09 195)',
  error: 'oklch(0.63 0.18 18)',
  info: 'oklch(0.68 0.14 245)',
  success: 'oklch(0.72 0.16 145)',
  warning: 'oklch(0.78 0.15 75)',
  'on-background': 'oklch(0.94 0.008 285)',
  'on-surface': 'oklch(0.94 0.008 285)',
}

export const lightOklchColors: Record<string, string> = {
  background: 'oklch(0.98 0.006 285)',
  surface: 'oklch(1 0 0)',
  'surface-bright': 'oklch(1 0 0)',
  'surface-light': 'oklch(0.94 0.012 285)',
  'surface-variant': 'oklch(0.48 0.04 285)',
  'on-surface-variant': 'oklch(0.98 0.005 285)',
  primary: 'oklch(0.48 0.19 262)',
  'primary-darken-1': 'oklch(0.4 0.17 262)',
  secondary: 'oklch(0.5 0.1 195)',
  'secondary-darken-1': 'oklch(0.42 0.09 195)',
  error: 'oklch(0.52 0.2 25)',
  info: 'oklch(0.48 0.16 245)',
  success: 'oklch(0.5 0.15 145)',
  warning: 'oklch(0.58 0.16 75)',
  'on-background': 'oklch(0.2 0.03 285)',
  'on-surface': 'oklch(0.2 0.03 285)',
}

export const darkOklchVariables: Record<string, string> = {
  'border-color': 'oklch(1 0 0)',
  'theme-kbd': 'oklch(0.34 0.02 285)',
  'theme-on-kbd': 'oklch(0.98 0 0)',
  'theme-code': 'oklch(0.28 0.018 285)',
  'theme-on-code': 'oklch(0.88 0.015 285)',
}

export const lightOklchVariables: Record<string, string> = {
  'border-color': 'oklch(0.2 0.03 285)',
  'theme-kbd': 'oklch(0.94 0.01 285)',
  'theme-on-kbd': 'oklch(0.15 0.02 285)',
  'theme-code': 'oklch(0.96 0.008 285)',
  'theme-on-code': 'oklch(0.2 0.03 285)',
}
