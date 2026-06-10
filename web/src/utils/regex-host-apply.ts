import type {
  RegexApplyContext,
  RegexField,
  RegexPhase,
  RegexRule,
  RegexRuleSummary,
} from '@/types/regex-rules'

export interface RegexHostMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RegexApplyMessagesContext {
  phase: RegexPhase
  tailOrdinal: number
  turnOrdinalByIndex?: (
    index: number,
    msg: RegexHostMessage,
  ) => number | undefined
}

function sortRegexRules(rules: RegexRule[]): RegexRule[] {
  return [...rules].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })
}

function shouldApplyRegexRule(
  rule: RegexRule,
  ctx: RegexApplyContext,
): boolean {
  if (!rule.enabled) return false
  if (!rule.phases.includes(ctx.phase)) return false
  if (!rule.fields.includes(ctx.field)) return false
  const skip = rule.skipLastNTurns
  if (skip > 0 && ctx.turnOrdinal !== undefined) {
    const threshold = ctx.tailOrdinal - skip
    if (ctx.turnOrdinal > threshold) return false
  }
  return true
}

function applyRegexRuleToText(rule: RegexRule, text: string): string {
  try {
    const re = new RegExp(rule.pattern, rule.flags)
    return text.replace(re, rule.replacement)
  } catch {
    return text
  }
}

export function filterRegexRulesForHost(
  rules: RegexRule[],
  opts?: { phases?: RegexPhase[]; ruleIds?: string[] | 'all' },
): RegexRule[] {
  let list = rules
  if (opts?.phases?.length) {
    const phaseSet = new Set(opts.phases)
    list = list.filter((r) => r.phases.some((p) => phaseSet.has(p)))
  }
  if (opts?.ruleIds && opts.ruleIds !== 'all') {
    const idSet = new Set(opts.ruleIds)
    list = list.filter((r) => idSet.has(r.id))
  }
  return list
}

export function applyRegexRulesToTextHost(
  text: string,
  rules: RegexRule[],
  ctx: RegexApplyContext,
): string {
  let out = text
  for (const rule of sortRegexRules(rules)) {
    if (!shouldApplyRegexRule(rule, ctx)) continue
    out = applyRegexRuleToText(rule, out)
  }
  return out
}

function messageRoleToRegexField(role: RegexHostMessage['role']): RegexField {
  if (role === 'system') return 'system'
  if (role === 'user') return 'user'
  return 'assistant'
}

export function applyRegexRulesToMessagesHost(
  messages: RegexHostMessage[],
  rules: RegexRule[],
  ctx: RegexApplyMessagesContext,
): RegexHostMessage[] {
  return messages.map((msg, index) => {
    const field = messageRoleToRegexField(msg.role)
    const turnOrdinal = ctx.turnOrdinalByIndex?.(index, msg)
    const content = applyRegexRulesToTextHost(
      msg.content,
      rules,
      {
        phase: ctx.phase,
        field,
        turnOrdinal,
        tailOrdinal: ctx.tailOrdinal,
      },
    )
    if (content === msg.content) return msg
    return { ...msg, content }
  })
}

export function toRegexRuleSummary(rule: RegexRule): RegexRuleSummary {
  return {
    id: rule.id,
    label: rule.label,
    order: rule.order,
    enabled: rule.enabled,
    phases: [...rule.phases],
    fields: [...rule.fields],
    skipLastNTurns: rule.skipLastNTurns,
  }
}
