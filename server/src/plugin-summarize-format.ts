import { getTurnUserText, type TurnRecord } from './chat-storage.js'
import { getTurnSegments } from './group-chat-turn.js'
import { filterRegexRules } from './regex-apply.js'
import { applyOutgoingRegexToTurnRecord } from './regex-outgoing.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'
import {
  assistantTextFromSegment,
  wrapTurnRoleLine,
} from './turn-memory-xml.js'

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
  return applyOutgoingRegexToTurnRecord(turn, rules, tailOrdinal, {
    regexApplyAllTurns,
  })
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
  defaultSpeakerCharacterId = '',
): string {
  const defaultSpeaker = defaultSpeakerCharacterId.trim()
  const lines: string[] = []
  for (const t of turns) {
    const userLine = wrapSummarizeTurnLine('user', getTurnUserText(t))
    if (userLine) lines.push(userLine)
    for (const seg of getTurnSegments(t, defaultSpeaker)) {
      const charLine = wrapSummarizeTurnLine(
        'assistant',
        assistantTextFromSegment(seg),
      )
      if (charLine) lines.push(charLine)
    }
  }
  return lines.join('\n')
}

/** 剥除 toTurn 指定 segment active receive 上的插件块标签 */
export function stripBlockTagsOnTurnSegment(
  turn: TurnRecord,
  tags: string[],
  segmentIndex?: number,
): TurnRecord {
  if (tags.length === 0 || turn.segments.length === 0) return turn
  const segIdx =
    typeof segmentIndex === 'number' && Number.isFinite(segmentIndex)
      ? Math.min(
          Math.max(0, Math.round(segmentIndex)),
          turn.segments.length - 1,
        )
      : Math.min(
          Math.max(0, Math.floor(turn.activeSegmentIndex)),
          turn.segments.length - 1,
        )
  const seg = turn.segments[segIdx]
  if (!seg) return turn
  const receives = [...seg.receives]
  const activeIdx = Math.min(
    Math.max(0, Math.floor(seg.activeReceiveIndex) || 0),
    Math.max(0, receives.length - 1),
  )
  const rec = receives[activeIdx]
  if (!rec) return turn
  const stripped = stripBlockTagsFromAssistant(rec.content, tags)
  if (stripped === rec.content) return turn
  receives[activeIdx] = { ...rec, content: stripped }
  return {
    ...turn,
    segments: turn.segments.map((s, i) =>
      i === segIdx ? { ...s, receives } : s,
    ),
  }
}

export function asPluginString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 从 assistant 正文剥除指定插件块标签（保留标签外叙事） */
export function stripBlockTagsFromAssistant(
  text: string,
  tags: string[],
): string {
  let out = text ?? ''
  for (const tag of tags) {
    const name = typeof tag === 'string' ? tag.trim() : ''
    if (!name) continue
    const re = new RegExp(
      `<${escapeRegExp(name)}>\\s*([\\s\\S]*?)\\s*<\\/${escapeRegExp(name)}>`,
      'gi',
    )
    out = out.replace(re, '')
  }
  return out.trim()
}
