import { preprocessMacroEscapes } from '../preprocess-escape.js'

export type LexToken =
  | { kind: 'text'; value: string }
  | { kind: 'macro'; inner: string }
  | { kind: 'unclosed'; value: string }

/** 将原文切分为 TEXT / MACRO 令牌（转义花括号先归一为占位符） */
export function lexMacroText(text: string): LexToken[] {
  const normalized = preprocessMacroEscapes(text)
  if (!normalized.includes('{{')) {
    return normalized ? [{ kind: 'text', value: normalized }] : []
  }

  const tokens: LexToken[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const open = normalized.indexOf('{{', cursor)
    if (open < 0) {
      tokens.push({ kind: 'text', value: normalized.slice(cursor) })
      break
    }
    if (open > cursor) {
      tokens.push({ kind: 'text', value: normalized.slice(cursor, open) })
    }
    const close = findBalancedMacroClose(normalized, open)
    if (close < 0) {
      tokens.push({ kind: 'unclosed', value: normalized.slice(open) })
      break
    }
    tokens.push({
      kind: 'macro',
      inner: normalized.slice(open + 2, close),
    })
    cursor = close + 2
  }
  return tokens
}

/** 匹配含嵌套 `{{` 的宏闭合 `}}` */
function findBalancedMacroClose(text: string, openStart: number): number {
  let i = openStart + 2
  let depth = 1
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      depth += 1
      i += 2
      continue
    }
    if (text.startsWith('}}', i)) {
      depth -= 1
      if (depth === 0) return i
      i += 2
      continue
    }
    i += 1
  }
  return -1
}
