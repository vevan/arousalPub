import { getTurnUserText, type TurnRecord } from './chat-storage.js'

export const PLUGIN_SUMMARIZE_BATCH_MAX = 50

/** 摘要 history / context-history 内单条发言的 XML 包裹（name 由宏展开） */
export function wrapSummarizeTurnLine(
  role: 'user' | 'char',
  text: string,
): string {
  const body = (text ?? '').trim()
  if (!body) return ''
  const nameMacro = role === 'user' ? '{{user}}' : '{{char}}'
  const cdata = body.replace(/\]\]>/g, ']]]]><![CDATA[>')
  return `<${role} name="${nameMacro}"><![CDATA[${cdata}]]></${role}>`
}

export function formatSummarizeTranscript(
  turns: TurnRecord[],
  _userName: string,
  _assistantName: string,
): string {
  const lines: string[] = []
  for (const t of turns) {
    const userLine = wrapSummarizeTurnLine('user', getTurnUserText(t))
    if (userLine) lines.push(userLine)
    const idx = Math.min(
      Math.max(0, t.activeReceiveIndex ?? 0),
      Math.max(0, (t.receives?.length ?? 1) - 1),
    )
    const r = t.receives?.[idx]
    const charLine = wrapSummarizeTurnLine(
      'char',
      typeof r?.content === 'string' ? r.content : '',
    )
    if (charLine) lines.push(charLine)
  }
  return lines.join('\n')
}

export function asPluginString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

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
  const title = asPluginString(o.title)
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

export function formatEntryTitle(
  rawTitle: string,
  startTurn: number,
  endTurn: number,
): string {
  const base = rawTitle.trim()
  const suffix = `-${startTurn}-${endTurn}`
  if (/-\d+-\d+$/.test(base)) {
    return base.replace(/-\d+-\d+$/, suffix)
  }
  return `${base}${suffix}`
}
