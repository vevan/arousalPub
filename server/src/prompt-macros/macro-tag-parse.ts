import { findBalancedMacroClose } from './cst/lexer.js'

/** 含嵌套 `{{` 的平衡宏标签扫描 */
export function findNextBalancedMacroTag(
  text: string,
  from = 0,
): { start: number; end: number; inner: string } | null {
  const start = text.indexOf('{{', from)
  if (start < 0) return null
  const close = findBalancedMacroClose(text, start)
  if (close < 0) return null
  return { start, end: close + 2, inner: text.slice(start + 2, close) }
}

/** 解析 `{{ … }}` 内层（不含外层花括号） */

/** `head::arg…` — 各段 trim；**最后一段**仅 `trimStart`（保留尾部换行等） */
export function splitColonMacroBody(body: string): { name: string; args: string } {
  const parts = body.split('::')
  const name = (parts[0] ?? '').trim().toLowerCase()
  const rest = parts.slice(1)
  if (rest.length === 0) return { name, args: '' }
  const normalized = rest.map((p, i) =>
    i === rest.length - 1 ? p.trimStart() : p.trim(),
  )
  return { name, args: normalized.join('::') }
}

export interface ParsedMacroTag {
  raw: string
  name: string
  /** 关闭标签 `{{/name}}` */
  isClose: boolean
  /** 独立 `{{else}}` */
  isElse: boolean
  /** 行内注释 `{{//…}}` */
  isComment: boolean
  /** ST `#`：scoped 块保留首尾空白 */
  preserveWhitespace: boolean
  args: string
}

export function parseMacroTagInner(inner: string): ParsedMacroTag {
  const raw = inner.trimStart()
  const trimmed = inner.trim()
  if (!trimmed) {
    return {
      raw,
      name: '',
      isClose: false,
      isElse: false,
      isComment: false,
      preserveWhitespace: false,
      args: '',
    }
  }
  if (trimmed.toLowerCase() === 'else') {
    return {
      raw,
      name: 'else',
      isClose: false,
      isElse: true,
      isComment: false,
      preserveWhitespace: false,
      args: '',
    }
  }
  if (trimmed.startsWith('//')) {
    return {
      raw,
      name: '//',
      isClose: false,
      isElse: false,
      isComment: true,
      preserveWhitespace: false,
      args: trimmed.slice(2).trim(),
    }
  }
  let body = inner.includes('::') ? raw : trimmed
  let preserveWhitespace = false
  if (body.startsWith('/')) {
    body = body.slice(1).trim()
    const name = body.split(/\s+/)[0] ?? ''
    return {
      raw,
      name: name.toLowerCase(),
      isClose: true,
      isElse: false,
      isComment: false,
      preserveWhitespace: false,
      args: '',
    }
  }
  if (body.startsWith('#')) {
    preserveWhitespace = true
    body = body.slice(1).trim()
  }
  if (body.startsWith('!')) body = body.slice(1).trim()

  let name: string
  let args: string
  if (body.includes('::')) {
    const colon = splitColonMacroBody(body)
    name = colon.name
    args = colon.args
  } else {
    const parts = body.split(/\s+/).filter(Boolean)
    name = (parts[0] ?? '').toLowerCase()
    args = parts.slice(1).join(' ')
  }
  return {
    raw,
    name,
    isClose: false,
    isElse: false,
    isComment: false,
    preserveWhitespace,
    args,
  }
}

export function findNextMacroTag(
  text: string,
  from = 0,
): { start: number; end: number; inner: string } | null {
  const start = text.indexOf('{{', from)
  if (start < 0) return null
  const end = text.indexOf('}}', start + 2)
  if (end < 0) return null
  return { start, end: end + 2, inner: text.slice(start + 2, end) }
}
