/** Historian prepare-context 文本块（plot-summary 插件） */

export function buildPreviousSummariesBlock(
  entries: { title: string; content: string }[],
): string {
  if (entries.length === 0) return ''
  const body = entries
    .map((e) => {
      const title = e.title.trim()
      const content = (e.content ?? '').trim()
      return `## ${title}\n${content}`
    })
    .join('\n\n')
  return `<previous-summaries readonly>\n${body}\n</previous-summaries>\n\n`
}

export function buildSidecarsBlock(
  entries: { title: string; content: string }[],
): string {
  if (entries.length === 0) return ''
  const body = entries
    .map((e) => {
      const title = e.title.trim()
      const content = (e.content ?? '').trim()
      return `## ${title}\n${content}`
    })
    .join('\n\n')
  return `<sidecars readonly>\n${body}\n</sidecars>\n\n`
}

export function buildContextHistoryBlock(transcript: string): string {
  const body = (transcript ?? '').trim()
  if (!body) return ''
  return `<context-history readonly>\n${body}\n</context-history>\n\n`
}

export function buildHistoryBlock(transcript: string): string {
  const body = (transcript ?? '').trim()
  if (!body) return ''
  return `<history>\n${body}\n</history>`
}

/** history 块起始轮：含 fromTurn，并向前最多 N 轮（N=0 则仅 fromTurn） */
export function resolveContextHistoryStart(
  fromTurn: number,
  contextTurns: number,
): number {
  const n =
    typeof contextTurns === 'number' && Number.isFinite(contextTurns)
      ? Math.max(0, Math.round(contextTurns))
      : 0
  if (n <= 0) return fromTurn
  return Math.max(0, fromTurn - n + 1)
}
