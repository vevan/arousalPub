import { trimScopedBlockContent } from './macro-truthy.js'
import { findNextMacroTag, parseMacroTagInner } from './macro-tag-parse.js'

const SCOPED_INLINE_MACROS = new Set([
  'setvar',
  'setglobalvar',
  'reverse',
  'trim',
])

function escapeHbString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')}"`
}

function findMatchingClose(
  text: string,
  macroName: string,
  from: number,
): { closeStart: number; closeEnd: number } | null {
  let depth = 1
  let cursor = from
  while (cursor < text.length) {
    const tag = findNextMacroTag(text, cursor)
    if (!tag) return null
    const parsed = parseMacroTagInner(tag.inner)
    if (parsed.isClose && parsed.name === macroName) {
      depth -= 1
      if (depth === 0) {
        return { closeStart: tag.start, closeEnd: tag.end }
      }
    } else if (!parsed.isClose && !parsed.isElse && parsed.name === macroName) {
      depth += 1
    }
    cursor = tag.end
  }
  return null
}

/** ST scoped：`{{macro arg}}` … `{{/macro}}` → `{{macro arg "body"}}` */
export function preprocessStScopedBlocks(text: string): string {
  if (!text.includes('{{')) return text
  let result = ''
  let cursor = 0
  while (cursor < text.length) {
    const tag = findNextMacroTag(text, cursor)
    if (!tag) {
      result += text.slice(cursor)
      break
    }
    result += text.slice(cursor, tag.start)
    const parsed = parseMacroTagInner(tag.inner)
    if (
      !parsed.isClose &&
      !parsed.isElse &&
      !parsed.isComment &&
      SCOPED_INLINE_MACROS.has(parsed.name)
    ) {
      const close = findMatchingClose(text, parsed.name, tag.end)
      if (close) {
        const body = trimScopedBlockContent(
          text.slice(tag.end, close.closeStart),
        )
        const arg = parsed.args.trim()
        const formatted = arg
          ? `${parsed.name} ${escapeHbString(arg)} ${escapeHbString(body)}`
          : `${parsed.name} ${escapeHbString(body)}`
        result += `{{${formatted}}}`
        cursor = close.closeEnd
        continue
      }
    }
    result += text.slice(tag.start, tag.end)
    cursor = tag.end
  }
  return result
}
