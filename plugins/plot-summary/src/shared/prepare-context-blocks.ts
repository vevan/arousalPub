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

export function buildHistoryBlock(transcript: string): string {
  const body = (transcript ?? '').trim()
  if (!body) return ''
  return `<history>\n${body}\n</history>`
}
