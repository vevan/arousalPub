import { findNextMacroTag, parseMacroTagInner } from '../macro-tag-parse.js'
import { findBalancedMacroClose } from './lexer.js'

export function extractIfCondition(inner: string): string {
  let raw = inner.trim()
  if (raw.startsWith('#')) raw = raw.slice(1).trim()
  if (raw.includes('::')) {
    const parts = raw.split('::').map((s) => s.trim())
    if (parts[0]!.toLowerCase() === 'if') {
      return parts.slice(1).join('::').trim()
    }
  }
  const m = raw.match(/^!?if\s+([\s\S]+)$/i)
  if (m) return m[1]!.trim()
  return raw.replace(/^!?if\s*/i, '').trim()
}

export function findIfBlockClose(
  text: string,
  from: number,
): { closeStart: number; closeEnd: number; elseStart?: number } | null {
  let depth = 1
  let cursor = from
  let elseStart: number | undefined
  while (cursor < text.length) {
    const tag = findNextMacroTag(text, cursor)
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

export function findScopedBlockClose(
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

export function readBalancedMacroInner(
  text: string,
  openStart: number,
): { inner: string; end: number } | null {
  const close = findBalancedMacroClose(text, openStart)
  if (close < 0) return null
  return { inner: text.slice(openStart + 2, close), end: close + 2 }
}
