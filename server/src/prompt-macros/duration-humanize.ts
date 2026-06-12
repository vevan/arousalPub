/** ST 兼容：moment.duration().humanize() / humanize(true) 近似（Intl.RelativeTimeFormat） */

const UNIT_MS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
]

function pickDurationUnit(absMs: number): {
  unit: Intl.RelativeTimeFormatUnit
  value: number
} {
  for (const { unit, ms } of UNIT_MS) {
    if (absMs >= ms * 0.75) {
      return { unit, value: Math.round(absMs / ms) }
    }
  }
  return { unit: 'second', value: Math.max(1, Math.round(absMs / 1000)) }
}

function justNowLabel(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? '刚刚' : 'just now'
}

/** 去掉 RelativeTimeFormat 的方向词，仅保留时长短语 */
function stripRelativeDirection(text: string): string {
  return text
    .replace(/^(in\s+|)\(?(.+?)\)?(\s+ago)?$/i, '$2')
    .replace(/^(.*)(前|后)$/u, '$1')
    .trim()
}

/**
 * 将毫秒时长格式化为人类可读字符串。
 * @param withSuffix true → ST `timeDiff`（带 ago/in/前/后）；false → ST `idleDuration`
 */
export function humanizeDurationMs(
  durationMs: number,
  locale: string,
  withSuffix = false,
): string {
  const abs = Math.abs(durationMs)
  if (!withSuffix && abs < 10_000) {
    return justNowLabel(locale)
  }
  if (abs < 500) {
    return withSuffix
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
      : justNowLabel(locale)
  }
  const { unit, value } = pickDurationUnit(abs)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (withSuffix) {
    const signed = durationMs >= 0 ? value : -value
    return rtf.format(signed, unit)
  }
  return stripRelativeDirection(rtf.format(value, unit))
}

/** 解析宏参数中的时间（ISO、Date.parse 可识别格式） */
export function parseMacroTimeValue(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null
  const t = Date.parse(s)
  if (Number.isFinite(t)) return new Date(t)
  return null
}

export function humanizeTimeDiff(
  leftRaw: string,
  rightRaw: string,
  locale: string,
): string {
  const left = parseMacroTimeValue(leftRaw)
  const right = parseMacroTimeValue(rightRaw)
  if (!left || !right) return ''
  return humanizeDurationMs(left.getTime() - right.getTime(), locale, true)
}

export function humanizeIdleDuration(
  referenceIso: string | undefined,
  now: Date,
  locale: string,
): string {
  if (!referenceIso?.trim()) return justNowLabel(locale)
  const ref = parseMacroTimeValue(referenceIso)
  if (!ref) return justNowLabel(locale)
  return humanizeDurationMs(now.getTime() - ref.getTime(), locale, false)
}
