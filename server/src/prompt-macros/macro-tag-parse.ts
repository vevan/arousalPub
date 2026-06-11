/** 解析 `{{ … }}` 内层（不含外层花括号） */

export interface ParsedMacroTag {
  raw: string
  name: string
  /** 关闭标签 `{{/name}}` */
  isClose: boolean
  /** 独立 `{{else}}` */
  isElse: boolean
  /** 行内注释 `{{//…}}` */
  isComment: boolean
  args: string
}

export function parseMacroTagInner(inner: string): ParsedMacroTag {
  const raw = inner.trim()
  if (!raw) {
    return { raw, name: '', isClose: false, isElse: false, isComment: false, args: '' }
  }
  if (raw.toLowerCase() === 'else') {
    return { raw, name: 'else', isClose: false, isElse: true, isComment: false, args: '' }
  }
  if (raw.startsWith('//')) {
    return { raw, name: '//', isClose: false, isElse: false, isComment: true, args: raw.slice(2).trim() }
  }
  let body = raw
  if (body.startsWith('/')) {
    body = body.slice(1).trim()
    const name = body.split(/\s+/)[0] ?? ''
    return {
      raw,
      name: name.toLowerCase(),
      isClose: true,
      isElse: false,
      isComment: false,
      args: '',
    }
  }
  if (body.startsWith('#')) body = body.slice(1).trim()
  if (body.startsWith('!')) body = body.slice(1).trim()

  let name: string
  let args: string
  if (body.includes('::')) {
    const parts = body.split('::').map((s) => s.trim())
    name = (parts[0] ?? '').toLowerCase()
    args = parts.slice(1).join('::')
  } else {
    const parts = body.split(/\s+/).filter(Boolean)
    name = (parts[0] ?? '').toLowerCase()
    args = parts.slice(1).join(' ')
  }
  return { raw, name, isClose: false, isElse: false, isComment: false, args }
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
