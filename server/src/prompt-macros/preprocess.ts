import {
  COLON_MACRO_HEADS,
  KNOWN_MACRO_HEADS,
  normalizeMacroHead,
} from './macro-values.js'

const LEGACY_ANGLE_TAGS: Record<string, string> = {
  user: '{{user}}',
  bot: '{{char}}',
  char: '{{char}}',
}

/** Legacy `<USER>` / `<BOT>` / `<CHAR>` → Handlebars 宏 */
export function preprocessLegacyAngleTags(text: string): string {
  if (!text.includes('<')) return text
  return text.replace(/<(USER|BOT|CHAR)>/gi, (_, tag: string) => {
    return LEGACY_ANGLE_TAGS[tag.toLowerCase()] ?? `<${tag}>`
  })
}

function escapeHbString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** ST `{{macro::a::b}}` → `{{macro "a" "b"}}` */
export function preprocessStColonMacros(text: string): string {
  if (!text.includes('::') || !text.includes('{{')) return text
  return text.replace(/\{\{([^}]+)\}\}/g, (match, inner: string) => {
    const raw = inner.trim()
    if (!raw.includes('::')) return match
    const parts = raw.split('::').map((s) => s.trim())
    if (parts.some((p) => p.includes('{{'))) return match
    const head = normalizeMacroHead(parts[0]!)
    if (!COLON_MACRO_HEADS.has(head)) return match
    const args = parts.slice(1)
    if (args.length === 0) {
      if (head === 'space' || head === 'newline') return `{{${head} 1}}`
      return `{{${head}}}`
    }
    const formatted = args
      .map((a) => (/^\d+$/.test(a) ? a : escapeHbString(a)))
      .join(' ')
    return `{{${head} ${formatted}}}`
  })
}

/** `{{char1}}` / `{{CHAR 2}}` / camelCase 已知宏 → 规范 Handlebars 形态 */
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
    const headLower = normalizeMacroHead(headRaw)
    const charDigits = headRaw.toLowerCase().match(/^char(\d+)$/)
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
      return parts.length > 1
        ? `{{${headLower} ${parts.slice(1).join(' ')}}}`
        : `{{${headLower}}}`
    }
    return match
  })
}
