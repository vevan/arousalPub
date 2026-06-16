export const REGEX_RULES_SCHEMA_VERSION = 1 as const

export const REGEX_PHASES = ['display', 'outgoing', 'persist'] as const
export type RegexPhase = (typeof REGEX_PHASES)[number]

export const REGEX_FIELDS = ['system', 'user', 'assistant', 'reasoning'] as const
export type RegexField = (typeof REGEX_FIELDS)[number]

export const REGEX_FLAGS_RE = /^[gimsuyd]*$/
export const MAX_REGEX_PATTERN_LENGTH = 2048
export const MAX_REGEX_REPLACEMENT_LENGTH = 8192
export const MAX_REGEX_LABEL_LENGTH = 128

export interface RegexRule {
  id: string
  label: string
  order: number
  enabled: boolean
  phases: RegexPhase[]
  fields: RegexField[]
  /** 旧版统一 skip；读盘时作各阶段未单独配置时的回退 */
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
  switch (phase) {
    case 'display':
      return rule.skipLastNTurnsDisplay
    case 'outgoing':
      return rule.skipLastNTurnsOutgoing
    case 'persist':
      return rule.skipLastNTurnsPersist
    default:
      return rule.skipLastNTurns
  }
}

export interface RegexRulesDocument {
  schemaVersion: typeof REGEX_RULES_SCHEMA_VERSION
  savedAt: string
  rules: RegexRule[]
}

/** API / 插件 listRules 摘要 */
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
  /** 无 turnOrdinal 的 system 不受 skipLastNTurns 限制 */
  turnOrdinal?: number
  tailOrdinal: number
  /** Historian 摘要：忽略各规则的 skip，对区间内全部轮次应用 */
  ignoreSkipLastNTurns?: boolean
}

export interface RegexApplyTextBody {
  text: string
  phase: RegexPhase
  field: RegexField
  turnOrdinal?: number
  tailOrdinal: number
  ruleIds?: string[] | 'all'
}
