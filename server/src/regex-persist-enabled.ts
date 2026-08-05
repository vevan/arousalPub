import type { RegexRule } from './regex-rules-types.js'

export function hasEnabledPersistRules(rules: RegexRule[]): boolean {
  return rules.some((r) => r.enabled && r.phases.includes('persist'))
}
