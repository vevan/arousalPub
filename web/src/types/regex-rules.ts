export const REGEX_PHASES = ['display', 'outgoing', 'persist'] as const
export type RegexPhase = (typeof REGEX_PHASES)[number]

export const REGEX_FIELDS = ['system', 'user', 'assistant', 'reasoning'] as const
export type RegexField = (typeof REGEX_FIELDS)[number]

export interface RegexRule {
  id: string
  label: string
  order: number
  enabled: boolean
  phases: RegexPhase[]
  fields: RegexField[]
  skipLastNTurns: number
  skipLastNTurnsDisplay: number
  skipLastNTurnsOutgoing: number
  skipLastNTurnsPersist: number
  pattern: string
  flags: string
  replacement: string
}

export function resolveSkipLastNTurns(
  rule: Pick<
    RegexRule,
    | 'skipLastNTurns'
    | 'skipLastNTurnsDisplay'
    | 'skipLastNTurnsOutgoing'
    | 'skipLastNTurnsPersist'
  >,
  phase: RegexPhase,
): number {
  const legacy = Math.max(0, Math.trunc(Number(rule.skipLastNTurns) || 0))
  const pick = (v: number | undefined) =>
    Math.max(0, Math.trunc(Number(v ?? legacy) || 0))
  switch (phase) {
    case 'display':
      return pick(rule.skipLastNTurnsDisplay)
    case 'outgoing':
      return pick(rule.skipLastNTurnsOutgoing)
    case 'persist':
      return pick(rule.skipLastNTurnsPersist)
    default:
      return legacy
  }
}

export interface RegexRulesDocument {
  schemaVersion: number
  savedAt: string
  rules: RegexRule[]
}

export interface RegexRuleSummary {
  id: string
  label: string
  order: number
  enabled: boolean
  phases: RegexPhase[]
  fields: RegexField[]
  skipLastNTurns: number
  skipLastNTurnsDisplay: number
  skipLastNTurnsOutgoing: number
  skipLastNTurnsPersist: number
}

export interface RegexApplyContext {
  phase: RegexPhase
  field: RegexField
  turnOrdinal?: number
  tailOrdinal: number
}
