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
  pattern: string
  flags: string
  replacement: string
}

export interface RegexRulesDocument {
  schemaVersion: number
  savedAt: string
  rules: RegexRule[]
}
