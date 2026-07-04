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
    if (m) return JSON.parse(m[0])
    throw new Error('parse_failed')
  }
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
  const legacy = t.match(/-(\d+)-(\d+)$/)
  if (legacy && legacy.index !== undefined) {
    const core = t.slice(0, legacy.index).trim()
    if (core) return core
  }
  return t || '摘要'
}

export function resolveMemoIndex(
  rawTitle: string,
  fromTurn: number,
  blockTurns: number,
): number {
  const parsed = parsePlotSummaryEntryTitle(rawTitle.trim())
  if (parsed) return parsed.memoIndex
  const bt = Math.max(1, Math.round(blockTurns))
  return Math.floor(Math.max(0, fromTurn) / bt) + 1
}

/** 剧情纪要 lore 条目标题：[MEMO-n]-TITLE-[from-to] */
export function formatEntryTitle(
  rawTitle: string,
  startTurn: number,
  endTurn: number,
  blockTurns = 15,
): string {
  const title = extractSummaryCoreTitle(rawTitle)
  const memoIndex = resolveMemoIndex(rawTitle, startTurn, blockTurns)
  return `[MEMO-${memoIndex}]-${title}-[${startTurn}-${endTurn}]`
}
