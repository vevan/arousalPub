/** 输入态：首行 slash 补全上下文（与 submit 解析一致，仅第一行） */

export interface ComposerSlashMenuContext {
  /** 命令名筛选（`/` 后至首个空格） */
  commandQuery: string
  /** 首行起止下标 */
  lineStart: number
  lineEnd: number
  /** `/` 字符下标 */
  slashStart: number
  /** 补全时替换区间 `[slashStart, insertEnd)`，保留其后正文 */
  insertEnd: number
}

const SLASH_LINE_RE = /^\s*\//

export function slashCommandToken(commandId: string): string {
  const id = commandId.trim()
  return id === '@' ? '/@' : `/${id}`
}

export function isComposerSlashCommandFullyMatched(
  commandQuery: string,
  commandIds: readonly string[],
): boolean {
  const q = commandQuery.trim().toLowerCase()
  if (!q) return false
  return commandIds.some((id) => id.trim().toLowerCase() === q)
}

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

  const slashRel = line.search(/\//)
  if (slashRel < 0) return null
  const slashStart = lineStart + slashRel

  const inner = line.trim().replace(/^\s*\//, '').trim()
  const space = inner.search(/\s/)
  const commandQuery = space < 0 ? inner : inner.slice(0, space)

  const insertEnd = Math.max(slashStart + 1, cursor)

  return { commandQuery, lineStart, lineEnd, slashStart, insertEnd }
}

/** 在光标处插入命令 token（仅命令名，不含示例参数）；保留 insertEnd 之后同 line 正文 */
export function applyComposerSlashCommand(
  text: string,
  ctx: ComposerSlashMenuContext,
  commandId: string,
  cursor = ctx.insertEnd,
): { next: string; cursor: number } {
  const token = slashCommandToken(commandId)
  const tokenWithSpace = token.endsWith(' ') ? token : `${token} `
  const insertEnd = Math.max(ctx.slashStart, Math.min(cursor, ctx.lineEnd))
  const before = text.slice(0, ctx.slashStart)
  let after = text.slice(insertEnd)
  if (tokenWithSpace.endsWith(' ') && after.startsWith(' ')) {
    after = after.slice(1)
  }
  const next = `${before}${tokenWithSpace}${after}`
  const newCursor = before.length + tokenWithSpace.length
  return { next, cursor: newCursor }
}
