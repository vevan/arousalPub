/**
 * 默认主题色（OKLCH，设计源）。Vuetify 实际使用由 build-vuetify-themes 转换的 hex。
 *
 * 设计方向：Tavern × Linear · 暖墨黑底 + 羊皮米文字 + 赤土橙 accent + 黄铜次级
 *  - background  暖墨黑 ≈ #0E0B08
 *  - surface     elev-1 ≈ #15110D
 *  - surface-light elev-2 ≈ #1C1813
 *  - surface-bright elev-3 ≈ #241F18
 *  - ink         羊皮米 ≈ #F4ECD8
 *  - primary     赤土橙 ≈ #D9602E（壁炉之火）
 *  - secondary   黄铜   ≈ #B89770
 *  - success     青苔绿 ≈ #7A8F6A
 *  - error       酒红   ≈ #A4332E
 */
export const darkOklchColors: Record<string, string> = {
  /** 与 `_design/demo-v3.html` 中 --bg / --bg-elev-* 十六进制逐字对齐（culori 反算 OKLCH） */
  background: 'oklch(0.152 0.0083 68)',
  surface: 'oklch(0.181 0.0103 67)',
  'surface-bright': 'oklch(0.243 0.0149 76)',
  'surface-light': 'oklch(0.212 0.0114 73)',
  'surface-variant': 'oklch(0.55 0.025 75)',
  'on-surface-variant': 'oklch(0.94 0.025 85)',
  primary: 'oklch(0.66 0.16 45)',
  'primary-darken-1': 'oklch(0.55 0.16 45)',
  secondary: 'oklch(0.65 0.07 75)',
  'secondary-darken-1': 'oklch(0.55 0.06 75)',
  error: 'oklch(0.55 0.16 25)',
  info: 'oklch(0.62 0.10 230)',
  success: 'oklch(0.62 0.06 130)',
  warning: 'oklch(0.72 0.13 75)',
  'on-background': 'oklch(0.944 0.0278 89)',
  'on-surface': 'oklch(0.944 0.0278 89)',
}

export const lightOklchColors: Record<string, string> = {
  background: 'oklch(0.97 0.012 85)',
  surface: 'oklch(0.99 0.006 85)',
  'surface-bright': 'oklch(1 0 0)',
  'surface-light': 'oklch(0.95 0.012 85)',
  'surface-variant': 'oklch(0.55 0.025 75)',
  'on-surface-variant': 'oklch(0.99 0.006 85)',
  primary: 'oklch(0.55 0.17 45)',
  'primary-darken-1': 'oklch(0.46 0.17 45)',
  secondary: 'oklch(0.50 0.06 75)',
  'secondary-darken-1': 'oklch(0.42 0.06 75)',
  error: 'oklch(0.50 0.18 25)',
  info: 'oklch(0.50 0.13 230)',
  success: 'oklch(0.55 0.10 130)',
  warning: 'oklch(0.62 0.15 75)',
  'on-background': 'oklch(0.22 0.025 60)',
  'on-surface': 'oklch(0.22 0.025 60)',
}

export const darkOklchVariables: Record<string, string> = {
  'border-color': 'oklch(0.94 0.025 85)',
  'theme-kbd': 'oklch(0.22 0.012 55)',
  'theme-on-kbd': 'oklch(0.82 0.022 85)',
  /** 与 demo --bg-elev-2 对齐 */
  'theme-code': 'oklch(0.212 0.0114 73)',
  'theme-on-code': 'oklch(0.85 0.025 85)',
}

export const lightOklchVariables: Record<string, string> = {
  'border-color': 'oklch(0.22 0.025 60)',
  'theme-kbd': 'oklch(0.93 0.014 85)',
  'theme-on-kbd': 'oklch(0.30 0.020 60)',
  'theme-code': 'oklch(0.94 0.013 85)',
  'theme-on-code': 'oklch(0.30 0.022 60)',
}
