import type { RegexField, RegexRule } from '@/types/regex-rules'
import { replaceRegexWithTimeoutSync } from '@/utils/regex-exec-timeout'

export interface RegexDisplayContext {
  field: RegexField
  turnOrdinal: number
  tailOrdinal: number
}

function sortRegexRules(rules: RegexRule[]): RegexRule[] {
  return [...rules].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })
}

function shouldApplyRegexRule(rule: RegexRule, ctx: RegexDisplayContext): boolean {
  if (!rule.enabled) return false
  if (!rule.phases.includes('display')) return false
  if (!rule.fields.includes(ctx.field)) return false
  const skip = rule.skipLastNTurns
  if (skip > 0) {
    const threshold = ctx.tailOrdinal - skip
    if (ctx.turnOrdinal > threshold) return false
  }
  return true
}

/** display 失败仅跳过该条规则，不回退全文（不落盘） */
function applyRegexRuleToText(rule: RegexRule, text: string): string {
  const result = replaceRegexWithTimeoutSync(
    rule.pattern,
    rule.flags,
    text,
    rule.replacement,
  )
  if (!result.ok) return text
  return result.text
}

/** display 阶段：enabled + field + skipLastNTurns */
export function applyDisplayRegexToText(
  text: string,
  rules: RegexRule[],
  ctx: RegexDisplayContext,
): string {
  if (!text || rules.length === 0) return text
  let out = text
  for (const rule of sortRegexRules(rules)) {
    if (!shouldApplyRegexRule(rule, ctx)) continue
    out = applyRegexRuleToText(rule, out)
  }
  return out
}

export function filterDisplayRulesForField(
  rules: RegexRule[],
  field: RegexField,
): RegexRule[] {
  return rules.filter(
    (r) => r.enabled && r.phases.includes('display') && r.fields.includes(field),
  )
}

export function hasDisplayRulesForField(
  rules: RegexRule[],
  field: RegexField,
): boolean {
  return filterDisplayRulesForField(rules, field).length > 0
}
