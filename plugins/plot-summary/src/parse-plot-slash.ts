/**
 * `/plot` 参数解析（插件侧；宿主只把 head=`plot` 的 args 原文交给本模块）。
 *
 * 形态：
 * - （空）→ bare
 * - summary [N-M]
 * - sidecar <name|"name with spaces"> [N-M]
 */

export type PlotSlashOk =
  | { ok: true; kind: 'bare' }
  | {
      ok: true
      kind: 'summary'
      scopeStart?: number
      scopeEnd?: number
    }
  | {
      ok: true
      kind: 'sidecar'
      entryName: string
      scopeStart?: number
      scopeEnd?: number
    }

export type PlotSlashErr = {
  ok: false
  code:
    | 'unknown_type'
    | 'missing_entry'
    | 'unquoted_spaces'
    | 'unclosed_quote'
    | 'invalid_range'
    | 'trailing_garbage'
}

export type PlotSlashParseResult = PlotSlashOk | PlotSlashErr

const RANGE_RE = /^(\d+)-(\d+)$/

function parseRangeToken(token: string): {
  ok: true
  scopeStart: number
  scopeEnd: number
} | {
  ok: false
  code: 'invalid_range'
} {
  const m = RANGE_RE.exec(token)
  if (!m) return { ok: false, code: 'invalid_range' }
  const scopeStart = Number.parseInt(m[1]!, 10)
  const scopeEnd = Number.parseInt(m[2]!, 10)
  if (
    !Number.isFinite(scopeStart) ||
    !Number.isFinite(scopeEnd) ||
    scopeStart < 0 ||
    scopeEnd < scopeStart
  ) {
    return { ok: false, code: 'invalid_range' }
  }
  return { ok: true, scopeStart, scopeEnd }
}

/**
 * 解析 entry name：引号包裹可含空格；未引号只能是单个 token。
 * 返回剩余原文（trim 后）。
 */
function parseEntryName(rest: string): {
  ok: true
  name: string
  remainder: string
} | PlotSlashErr {
  const s = rest.trim()
  if (!s) return { ok: false, code: 'missing_entry' }

  if (s.startsWith('"')) {
    let i = 1
    let name = ''
    let closed = false
    while (i < s.length) {
      const ch = s[i]!
      if (ch === '\\' && i + 1 < s.length) {
        name += s[i + 1]!
        i += 2
        continue
      }
      if (ch === '"') {
        closed = true
        i += 1
        break
      }
      name += ch
      i += 1
    }
    if (!closed) return { ok: false, code: 'unclosed_quote' }
    const trimmedName = name.trim()
    if (!trimmedName) return { ok: false, code: 'missing_entry' }
    return { ok: true, name: trimmedName, remainder: s.slice(i).trim() }
  }

  const space = s.search(/\s/)
  if (space < 0) {
    return { ok: true, name: s, remainder: '' }
  }
  const name = s.slice(0, space)
  const remainder = s.slice(space + 1).trim()
  if (!name) return { ok: false, code: 'missing_entry' }
  // 未引号 name 后只允许整段为 N-M；否则视为需引号的空格名 / 多余参数
  if (remainder && !RANGE_RE.test(remainder)) {
    return { ok: false, code: 'unquoted_spaces' }
  }
  return { ok: true, name, remainder }
}

export function parsePlotSlashArgs(args: string): PlotSlashParseResult {
  const trimmed = args.trim()
  if (!trimmed) return { ok: true, kind: 'bare' }

  const space = trimmed.search(/\s/)
  const type = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase()
  const rest = space < 0 ? '' : trimmed.slice(space + 1).trim()

  if (type === 'summary') {
    if (!rest) return { ok: true, kind: 'summary' }
    const range = parseRangeToken(rest)
    if (!range.ok) {
      // 多个 token 或非范围
      if (rest.includes(' ')) return { ok: false, code: 'trailing_garbage' }
      return { ok: false, code: 'invalid_range' }
    }
    return {
      ok: true,
      kind: 'summary',
      scopeStart: range.scopeStart,
      scopeEnd: range.scopeEnd,
    }
  }

  if (type === 'sidecar') {
    const entry = parseEntryName(rest)
    if (!entry.ok) return entry
    if (!entry.remainder) {
      return { ok: true, kind: 'sidecar', entryName: entry.name }
    }
    // 剩余应恰为一个范围 token
    if (entry.remainder.includes(' ')) {
      return { ok: false, code: 'trailing_garbage' }
    }
    const range = parseRangeToken(entry.remainder)
    if (!range.ok) return range
    return {
      ok: true,
      kind: 'sidecar',
      entryName: entry.name,
      scopeStart: range.scopeStart,
      scopeEnd: range.scopeEnd,
    }
  }

  return { ok: false, code: 'unknown_type' }
}
