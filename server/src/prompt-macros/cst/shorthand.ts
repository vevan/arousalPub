import { parseMacroTagInner, type ParsedMacroTag } from '../macro-tag-parse.js'

/** `{{.name}}` / `{{$name}}` → getvar / getglobalvar */
export function expandVariableShorthand(tag: ParsedMacroTag): ParsedMacroTag {
  if (tag.isComment || tag.isClose || tag.isElse) return tag
  const raw = tag.raw.trim()
  if (!raw || raw.includes(' ') || raw.includes('::')) return tag
  if (raw.startsWith('.') && raw.length > 1 && !raw.startsWith('..')) {
    const name = raw.slice(1).trim()
    if (/^[\w$-]+$/.test(name)) {
      return parseMacroTagInner(`getvar::${name}`)
    }
  }
  if (raw.startsWith('$') && raw.length > 1) {
    const name = raw.slice(1).trim()
    if (/^[\w$-]+$/.test(name)) {
      return parseMacroTagInner(`getglobalvar::${name}`)
    }
  }
  return tag
}
