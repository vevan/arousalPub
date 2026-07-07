import { getTurnUserText, patchTurnDisplayContent, type TurnRecord } from './chat-storage.js'
import { applyRegexRulesToText, filterRegexRules } from './regex-apply.js'
import { resolveOutgoingSkipTailOrdinal } from './regex-outgoing.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'
import { normalizeXmlTextBeforeProcessing } from './prompt-xml.js'
import { assistantTextFromTurn, wrapTurnRoleLine } from './turn-memory-xml.js'

export const PLUGIN_SUMMARIZE_BATCH_MAX = 50

export function normalizeRegexRuleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
}

export async function loadSummarizeOutgoingRegexRules(
  ruleIds: string[],
): Promise<RegexRule[]> {
  const ids = normalizeRegexRuleIds(ruleIds)
  if (ids.length === 0) return []
  const doc = await readRegexRulesDocument()
  return filterRegexRules(doc.rules, { ruleIds: ids, phases: ['outgoing'] }).filter(
    (r) => r.enabled,
  )
}

export function applyOutgoingRegexToSummaryTurn(
  turn: TurnRecord,
  rules: RegexRule[],
  tailOrdinal: number,
  regexApplyAllTurns = false,
): TurnRecord {
  if (rules.length === 0) return turn

  const ord = turn.turnOrdinal
  const skipTailOrdinal = resolveOutgoingSkipTailOrdinal(tailOrdinal)
  const regexCtxBase = {
    phase: 'outgoing' as const,
    tailOrdinal: skipTailOrdinal,
    ...(regexApplyAllTurns ? { ignoreSkipLastNTurns: true as const } : {}),
  }
  let userText = normalizeXmlTextBeforeProcessing(getTurnUserText(turn))
  let userChanged = false
  if (userText.trim()) {
    const next = applyRegexRulesToText(userText, rules, {
      ...regexCtxBase,
      field: 'user',
      turnOrdinal: ord,
    })
    if (next !== userText) {
      userText = next
      userChanged = true
    }
  }

  let assistant = normalizeXmlTextBeforeProcessing(assistantTextFromTurn(turn))
  let assistantChanged = false
  if (assistant.trim()) {
    const next = applyRegexRulesToText(assistant, rules, {
      ...regexCtxBase,
      field: 'assistant',
      turnOrdinal: ord,
    })
    if (next !== assistant) {
      assistant = next
      assistantChanged = true
    }
  }

  if (!userChanged && !assistantChanged) return turn

  return patchTurnDisplayContent(turn, userText, assistant)
}

export function applyOutgoingRegexToSummaryTurns(
  turns: TurnRecord[],
  rules: RegexRule[],
  tailOrdinal: number,
  regexApplyAllTurns = false,
): TurnRecord[] {
  if (rules.length === 0) return turns
  return turns.map((t) =>
    applyOutgoingRegexToSummaryTurn(t, rules, tailOrdinal, regexApplyAllTurns),
  )
}

/** 摘要 <history> 内单条发言的 XML 包裹（属性宏由 complete 阶段展开） */
export function wrapSummarizeTurnLine(
  role: 'user' | 'assistant',
  text: string,
): string {
  return wrapTurnRoleLine(role, text)
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
    const charLine = wrapSummarizeTurnLine('assistant', assistantTextFromTurn(t))
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
  if (!obj || typeof obj !== 'object') {
    return { title: '', content: '', keywords: [] }
  }
  const o = obj as Record<string, unknown>
  const title = asPluginString(o.title)
  const content = asPluginString(o.content ?? o.summary)
  let keywords: string[] = []
  if (Array.isArray(o.keywords)) {
    keywords = o.keywords
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .map((k) => k.trim())
  }
  return { title, content, keywords }
}

export function formatEntryTitle(
  title: string,
  fromTurn: number,
  toTurn: number,
  blockTurns = 15,
): string {
  const base = title.trim()
  const core = (() => {
    const parsed = base.match(/^\[MEMO-(\d+)\]-(.+)-\[(\d+)-(\d+)\]$/)
    if (parsed) return parsed[2].trim()
    const legacy = base.match(/-(\d+)-(\d+)$/)
    if (legacy && legacy.index !== undefined) {
      const stripped = base.slice(0, legacy.index).trim()
      if (stripped) return stripped
    }
    return base
  })()
  const memoIndex = (() => {
    const parsed = base.match(/^\[MEMO-(\d+)\]-/)
    if (parsed) return Number(parsed[1])
    const bt = Math.max(1, Math.round(blockTurns))
    return Math.floor(Math.max(0, fromTurn) / bt) + 1
  })()
  const label = core || `${fromTurn}-${toTurn}`
  return `[MEMO-${memoIndex}]-${label}-[${fromTurn}-${toTurn}]`
}
