import { asString } from './utils.js'

export const PLOT_SUMMARY_ENTRY_TITLE_RE =
  /^\[MEMO-(\d+)\]-(.+)-\[(\d+)-(\d+)\]$/

export function parseModelJson(text: string): unknown {
  let raw = (text ?? '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  try {
    return JSON.parse(raw)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        throw new Error('parse_failed')
      }
    }
    throw new Error('parse_failed')
  }
}

function coerceDraftText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value != null && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

/** Sidecar 出站 JSON：title 固定为 sidecar 名，content 可来自对象字段 */
export function normalizeSidecarPayload(
  sidecarName: string,
  obj: unknown,
): {
  title: string
  content: string
  keywords: string[]
} {
  if (!obj || typeof obj !== 'object') throw new Error('parse_failed')
  const o = obj as Record<string, unknown>
  const title = sidecarName.trim() || asString(o.title)
  let content =
    coerceDraftText(o.content) ||
    coerceDraftText(o.state) ||
    coerceDraftText(o.summary) ||
    asString(o.title)
  if (!title || !content) throw new Error('parse_failed')
  let keywords: string[] = []
  if (Array.isArray(o.keywords)) {
    keywords = o.keywords
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return { title, content, keywords }
}

export function normalizeSummaryPayload(obj: unknown): {
  title: string
  content: string
  keywords: string[]
} {
  if (!obj || typeof obj !== 'object') throw new Error('parse_failed')
  const o = obj as Record<string, unknown>
  const title = asString(o.title)
  const content = typeof o.content === 'string' ? o.content : ''
  if (!title || !content.trim()) throw new Error('parse_failed')
  let keywords: string[] = []
  if (Array.isArray(o.keywords)) {
    keywords = o.keywords
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return { title, content: content.trim(), keywords }
}

export function parsePlotSummaryEntryTitle(title: string): {
  memoIndex: number
  coreTitle: string
  start: number
  end: number
} | null {
  const m = (title ?? '').trim().match(PLOT_SUMMARY_ENTRY_TITLE_RE)
  if (!m) return null
  const memoIndex = Number(m[1])
  const start = Number(m[3])
  const end = Number(m[4])
  if (!Number.isFinite(memoIndex) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null
  }
  return { memoIndex, coreTitle: m[2].trim(), start, end }
}

export function extractSummaryCoreTitle(rawTitle: string): string {
  const t = rawTitle.trim()
  const parsed = parsePlotSummaryEntryTitle(t)
  if (parsed?.coreTitle) return parsed.coreTitle
  return t || '摘要'
}

export function resolveMemoIndex(
  rawTitle: string,
  _fromTurn: number,
  blockTurnsOrOpts: number | { blockTurns?: number; memoIndex?: number } = 15,
): number {
  const opts =
    typeof blockTurnsOrOpts === 'number'
      ? { blockTurns: blockTurnsOrOpts }
      : (blockTurnsOrOpts ?? {})
  // 会话显式分配优先于模型标题里碰巧带上的 [MEMO-n]
  if (
    typeof opts.memoIndex === 'number' &&
    Number.isFinite(opts.memoIndex) &&
    opts.memoIndex >= 1
  ) {
    return Math.round(opts.memoIndex)
  }
  const parsed = parsePlotSummaryEntryTitle(rawTitle.trim())
  if (parsed) return parsed.memoIndex
  // 无会话序号、无旧标题格式时从 1 起（不再用 fromTurn/blockTurns 推算）
  return 1
}

/** 剧情纪要 lore 条目标题：[MEMO-n]-TITLE-[from-to] */
export function formatEntryTitle(
  rawTitle: string,
  startTurn: number,
  endTurn: number,
  blockTurnsOrOpts: number | { blockTurns?: number; memoIndex?: number } = 15,
): string {
  const title = extractSummaryCoreTitle(rawTitle)
  const memoIndex = resolveMemoIndex(rawTitle, startTurn, blockTurnsOrOpts)
  return `[MEMO-${memoIndex}]-${title}-[${startTurn}-${endTurn}]`
}
