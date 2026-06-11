import { extractIfCondition } from './cst/block-parse.js'
import {
  findNextBalancedMacroTag,
  parseMacroTagInner,
} from './macro-tag-parse.js'

function escapeHbString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`
}

function findIfBlockClose(
  text: string,
  from: number,
): { closeStart: number; closeEnd: number; elseStart?: number } | null {
  let depth = 1
  let cursor = from
  let elseStart: number | undefined
  while (cursor < text.length) {
    const tag = findNextBalancedMacroTag(text, cursor)
    if (!tag) return null
    const parsed = parseMacroTagInner(tag.inner)
    if (parsed.isElse && depth === 1 && elseStart === undefined) {
      elseStart = tag.start
      cursor = tag.end
      continue
    }
    if (parsed.isClose && parsed.name === 'if') {
      depth -= 1
      if (depth === 0) {
        return { closeStart: tag.start, closeEnd: tag.end, elseStart }
      }
    } else if (!parsed.isClose && !parsed.isElse && parsed.name === 'if') {
      depth += 1
    }
    cursor = tag.end
  }
  return null
}

/** ST `{{if cond}}` … `{{else}}`? … `{{/if}}` → `{{#stIf "cond"}}` … */
export function preprocessStIfBlocks(text: string): string {
  if (!text.includes('{{')) return text
  let result = ''
  let cursor = 0
  while (cursor < text.length) {
    const tag = findNextBalancedMacroTag(text, cursor)
    if (!tag) {
      result += text.slice(cursor)
      break
    }
    const parsed = parseMacroTagInner(tag.inner)
    if (parsed.name === 'if' && !parsed.isClose && !parsed.isElse) {
      const close = findIfBlockClose(text, tag.end)
      if (close) {
        const thenEnd = close.elseStart ?? close.closeStart
        const thenBody = text.slice(tag.end, thenEnd)
        const cond = extractIfCondition(tag.inner)
        result += `{{#stIf ${escapeHbString(cond)}}}${thenBody}`
        if (close.elseStart !== undefined) {
          const elseTag = findNextBalancedMacroTag(text, close.elseStart)
          if (elseTag) {
            result += `{{else}}${text.slice(elseTag.end, close.closeStart)}`
          }
        }
        result += `{{/stIf}}`
        cursor = close.closeEnd
        continue
      }
    }
    result += text.slice(cursor, tag.start)
    result += text.slice(tag.start, tag.end)
    cursor = tag.end
  }
  return result
}
