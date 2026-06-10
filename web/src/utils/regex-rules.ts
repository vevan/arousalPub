import {
  REGEX_FIELDS,
  REGEX_PHASES,
  type RegexField,
  type RegexPhase,
  type RegexRule,
  type RegexRulesDocument,
} from '@/types/regex-rules'

export const MAX_REGEX_PATTERN_LENGTH = 2048
export const MAX_REGEX_REPLACEMENT_LENGTH = 8192
export const MAX_REGEX_LABEL_LENGTH = 128
export const REGEX_FLAGS_RE = /^[gimsuyd]*$/

const SHORT_ID_RE = /^[0-9a-f]{8}$/i

export function isValidShortId(id: string): boolean {
  return SHORT_ID_RE.test(id.trim())
}

export function generateShortId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function allocateShortId(used: Set<string>): string {
  let id: string
  do {
    id = generateShortId()
  } while (used.has(id))
  used.add(id)
  return id
}

export function sortRegexRules(rules: RegexRule[]): RegexRule[] {
  return [...rules].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })
}

export function suggestNextRegexRuleOrder(rules: RegexRule[]): number {
  if (rules.length === 0) return 10
  return Math.max(...rules.map((r) => r.order)) + 10
}

export function reassignRegexRuleOrders(rules: RegexRule[]): RegexRule[] {
  return sortRegexRules(rules).map((r, i) => ({
    ...r,
    order: (i + 1) * 10,
  }))
}

export function cloneRegexRule(rule: RegexRule): RegexRule {
  return {
    ...rule,
    phases: [...rule.phases],
    fields: [...rule.fields],
  }
}

export function cloneRegexRules(rules: RegexRule[]): RegexRule[] {
  return rules.map(cloneRegexRule)
}

export function createDefaultRegexRule(existing: RegexRule[]): RegexRule {
  const used = new Set(existing.map((r) => r.id))
  return {
    id: allocateShortId(used),
    label: '',
    order: suggestNextRegexRuleOrder(existing),
    enabled: false,
    phases: ['display', 'outgoing', 'persist'],
    fields: ['user', 'assistant'],
    skipLastNTurns: 0,
    pattern: '',
    flags: 'g',
    replacement: '',
  }
}

export function regexRulesEqual(a: RegexRule[], b: RegexRule[]): boolean {
  if (a.length !== b.length) return false
  const sa = sortRegexRules(a)
  const sb = sortRegexRules(b)
  return sa.every((r, i) => {
    const o = sb[i]
    if (!o || r.id !== o.id) return false
    return (
      r.label === o.label &&
      r.order === o.order &&
      r.enabled === o.enabled &&
      r.skipLastNTurns === o.skipLastNTurns &&
      r.pattern === o.pattern &&
      r.flags === o.flags &&
      r.replacement === o.replacement &&
      r.phases.length === o.phases.length &&
      r.fields.length === o.fields.length &&
      r.phases.every((p, j) => p === o.phases[j]) &&
      r.fields.every((f, j) => f === o.fields[j])
    )
  })
}

export function documentFromRules(rules: RegexRule[]): RegexRulesDocument {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    rules: cloneRegexRules(reassignRegexRuleOrders(rules)),
  }
}

export function validateRegexPatternClient(
  pattern: string,
  flags: string,
): string | null {
  if (!pattern.trim()) return 'pattern_required'
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) return 'pattern_too_long'
  if (!REGEX_FLAGS_RE.test(flags)) return 'invalid_flags'
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, flags)
    return null
  } catch {
    return 'invalid_regexp'
  }
}

export const REGEX_PHASE_OPTIONS = REGEX_PHASES.map((value) => ({ value }))
export const REGEX_FIELD_OPTIONS = REGEX_FIELDS.map((value) => ({ value }))

export function isRegexPhase(v: string): v is RegexPhase {
  return (REGEX_PHASES as readonly string[]).includes(v)
}

export function isRegexField(v: string): v is RegexField {
  return (REGEX_FIELDS as readonly string[]).includes(v)
}

/** PUT 前：phases/fields 非空且 pattern 合法 */
export function isRegexRuleSaveReady(rule: RegexRule): boolean {
  if (rule.phases.length === 0 || rule.fields.length === 0) return false
  return validateRegexPatternClient(rule.pattern, rule.flags) === null
}

export function allRegexRulesSaveReady(rules: RegexRule[]): boolean {
  return rules.every(isRegexRuleSaveReady)
}
