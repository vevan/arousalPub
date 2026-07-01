/** 输入态：首行 slash 补全上下文（与 submit 解析一致，仅第一行） */

export interface ComposerSlashMenuContext {
  /** 命令名筛选（`/` 后至首个空格） */
  commandQuery: string
  /** 替换整行首 slash 行：起止下标 */
  lineStart: number
  lineEnd: number
}

const SLASH_LINE_RE = /^\s*\//

export function getComposerSlashMenuContext(
  text: string,
  cursor: number,
): ComposerSlashMenuContext | null {
  if (!Number.isFinite(cursor) || cursor < 0) return null
  const before = text.slice(0, cursor)
  const lineStart = before.lastIndexOf('\n') + 1
  if (lineStart !== 0) return null

  const afterBreak = text.indexOf('\n', cursor)
  const lineEnd = afterBreak === -1 ? text.length : afterBreak
  const line = text.slice(lineStart, lineEnd)

  if (!SLASH_LINE_RE.test(line)) return null

  const inner = line.trim().replace(/^\s*\//, '').trim()
  const space = inner.search(/\s/)
  const commandQuery = space < 0 ? inner : inner.slice(0, space)

  return { commandQuery, lineStart, lineEnd }
}

export function applyComposerSlashExample(
  text: string,
  ctx: ComposerSlashMenuContext,
  example: string,
): { next: string; cursor: number } {
  const before = text.slice(0, ctx.lineStart)
  const after = text.slice(ctx.lineEnd)
  const insert = example.endsWith(' ') ? example : `${example} `
  const next = `${before}${insert}${after}`
  const cursor = before.length + insert.length
  return { next, cursor }
}
