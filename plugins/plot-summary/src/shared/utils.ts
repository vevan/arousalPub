export function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function asInt(v: unknown, fallback: number, max = 500): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, Math.round(n)))
}

export function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export function keywordsToText(keywords: string[]): string {
  if (!Array.isArray(keywords)) return ''
  return keywords.filter((x) => typeof x === 'string').join(', ')
}

export function parseKeywordsText(text: unknown): string[] {
  if (typeof text !== 'string') return []
  return text
    .split(/[,，、;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function entryKeys(keywords: string[]): string[] {
  if (!Array.isArray(keywords)) return []
  return keywords
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
}
