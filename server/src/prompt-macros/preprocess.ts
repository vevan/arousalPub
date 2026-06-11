import { KNOWN_MACRO_HEADS } from './macro-values.js'

/** `{{char1}}` / `{{CHAR 2}}` → `{{char 1}}` / `{{char 2}}` */
export function preprocessLegacyMacroSyntax(text: string): string {
  if (!text.includes('{{')) return text
  return text.replace(/\{\{([^}]+)\}\}/g, (match, inner: string) => {
    const raw = inner.trim()
    if (!raw || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('!')) {
      return match
    }
    const parts = raw.split(/\s+/).filter(Boolean)
    if (parts.length === 0) return match
    const headRaw = parts[0]!
    const headLower = headRaw.toLowerCase()
    const charDigits = headLower.match(/^char(\d+)$/)
    if (charDigits) {
      return `{{char ${charDigits[1]}}}`
    }
    if (headLower === 'char' && parts.length >= 2) {
      const n = parts[1]!
      if (/^\d+$/.test(n)) {
        return `{{char ${n}}}`
      }
    }
    if (KNOWN_MACRO_HEADS.has(headLower)) {
      return parts.length > 1 ? `{{${headLower} ${parts.slice(1).join(' ')}}}` : `{{${headLower}}}`
    }
    return match
  })
}
