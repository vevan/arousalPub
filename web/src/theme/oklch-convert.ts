import { converter, formatCss, formatHex, parse } from 'culori'

const toOklch = converter('oklch')

export function oklchToHex(oklch: string): string {
  const c = parse(oklch)
  if (!c) return '#000000'
  return formatHex(c) ?? '#000000'
}

export function mapOklchRecordToHex(
  record: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, oklchToHex(v)]),
  )
}

/** 从 OKLCH 字符串解析 L/C/H，供滑块初始化 */
export function parseOklchComponents(oklch: string): {
  l: number
  c: number
  h: number
} {
  const o = toOklch(parse(oklch))
  if (!o || o.mode !== 'oklch') {
    return { l: 0.65, c: 0.15, h: 250 }
  }
  return {
    l: typeof o.l === 'number' ? o.l : 0.65,
    c: typeof o.c === 'number' ? o.c : 0,
    h: typeof o.h === 'number' && !Number.isNaN(o.h) ? o.h : 0,
  }
}

export function componentsToOklchCss(l: number, c: number, h: number): string {
  return formatCss({
    mode: 'oklch',
    l: clamp(l, 0, 1),
    c: clamp(c, 0, 0.4),
    h: ((h % 360) + 360) % 360,
  })
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 略压亮度生成 primary-darken-1，保持同一色相与彩度习惯 */
export function derivePrimaryDarken1(oklchCss: string): string {
  const o = toOklch(parse(oklchCss))
  if (!o || o.mode !== 'oklch') return oklchCss
  return formatCss({
    mode: 'oklch',
    l: clamp((o.l ?? 0) - 0.08, 0, 1),
    c: o.c ?? 0,
    h: o.h ?? 0,
  })
}
