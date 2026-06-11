import { trimScopedBlockContent } from './macro-truthy.js'

/** `{{// …}}` 行内注释 */
function stripInlineComment(inner: string): string {
  const raw = inner.trim()
  if (!raw.startsWith('//')) return inner
  return ''
}

/** `{{//}}` … `{{//}}` 块注释（预处理阶段移除） */
export function preprocessMacroComments(text: string): string {
  if (!text.includes('{{')) return text
  let out = text.replace(/\{\{([^}]+)\}\}/g, (match, inner: string) => {
    const raw = inner.trim()
    if (raw === '//') return match
    if (raw.startsWith('//')) return stripInlineComment(raw)
    return match
  })

  const blockOpen = /\{\{\s*\/\/\s*\}\}/g
  if (!blockOpen.test(out)) return out
  blockOpen.lastIndex = 0

  let result = ''
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = blockOpen.exec(out)) !== null) {
    result += out.slice(cursor, m.index)
    const close = out.indexOf('{{//}}', m.index + m[0].length)
    if (close < 0) {
      result += out.slice(m.index)
      return result
    }
    cursor = close + '{{//}}'.length
    blockOpen.lastIndex = cursor
  }
  result += out.slice(cursor)
  return result
}

export { trimScopedBlockContent }
