import type { ChatMessage } from './assemble-prompts.js'
import { replaceRegexWithTimeout } from './regex-exec-timeout.js'
import type {
  RegexApplyContext,
  RegexField,
  RegexPhase,
  RegexRule,
} from './regex-rules-types.js'
import { resolveSkipLastNTurns } from './regex-rules-types.js'

export interface ApplyRegexOptions {
  /** runtime 单条规则编译失败时调用；默认静默跳过 */
  onRuleError?: (rule: RegexRule, error: unknown) => void
}

export function compileRegexRule(
  rule: RegexRule,
): RegExp | null {
  try {
    return new RegExp(rule.pattern, rule.flags)
  } catch {
    return null
  }
}

/** 是否对该 ctx 应用此规则（enabled / phase / field / skipLastNTurns） */
export function shouldApplyRegexRule(
  rule: RegexRule,
  ctx: RegexApplyContext,
): boolean {
  if (!rule.enabled) return false
  if (!rule.phases.includes(ctx.phase)) return false
  if (!rule.fields.includes(ctx.field)) return false

  if (!ctx.ignoreSkipLastNTurns) {
    const skip = resolveSkipLastNTurns(rule, ctx.phase)
    if (skip > 0 && ctx.turnOrdinal !== undefined) {
      const threshold = ctx.tailOrdinal - skip
      if (ctx.turnOrdinal > threshold) return false
    }
  }
  return true
}

export function applyRegexRuleToText(
  rule: RegexRule,
  text: string,
  opts?: ApplyRegexOptions,
): string {
  if (!compileRegexRule(rule)) {
    opts?.onRuleError?.(rule, new Error('invalid_regexp'))
    return text
  }
  const result = replaceRegexWithTimeout(
    rule.pattern,
    rule.flags,
    text,
    rule.replacement,
  )
  if (!result.ok) {
    opts?.onRuleError?.(rule, new Error(result.code))
    return text
  }
  return result.text
}

/** enabled 规则按 order 升序串联 apply */
export function applyRegexRulesToText(
  text: string,
  rules: RegexRule[],
  ctx: RegexApplyContext,
  opts?: ApplyRegexOptions,
): string {
  const sorted = sortRegexRules(rules)
  let aborted = false
  const wrapped: ApplyRegexOptions = {
    onRuleError: (rule, error) => {
      if (error instanceof Error && error.message === 'regex_exec_timeout') {
        aborted = true
      }
      opts?.onRuleError?.(rule, error)
    },
  }
  let out = text
  for (const rule of sorted) {
    if (aborted) break
    if (!shouldApplyRegexRule(rule, ctx)) continue
    out = applyRegexRuleToText(rule, out, wrapped)
    if (aborted) return text
  }
  return out
}

export function sortRegexRules(rules: RegexRule[]): RegexRule[] {
  return [...rules].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })
}

export function filterRegexRules(
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

export function applyRegexRulesToMessages(
  messages: ChatMessage[],
  rules: RegexRule[],
  ctxBase: Omit<RegexApplyContext, 'field'> & {
    /** 每条 message 的 turnOrdinal；缺省仅 system 类无 ordinal */
    turnOrdinalByIndex?: (index: number, msg: ChatMessage) => number | undefined
  },
  opts?: ApplyRegexOptions,
): ChatMessage[] {
  return messages.map((msg, index) => {
    const field = messageRoleToRegexField(msg.role)
    const turnOrdinal = ctxBase.turnOrdinalByIndex?.(index, msg)
    const content = applyRegexRulesToText(
      msg.content,
      rules,
      {
        phase: ctxBase.phase,
        field,
        turnOrdinal,
        tailOrdinal: ctxBase.tailOrdinal,
      },
      opts,
    )
    if (content === msg.content) return msg
    return { ...msg, content }
  })
}

function messageRoleToRegexField(role: ChatMessage['role']): RegexField {
  if (role === 'system') return 'system'
  if (role === 'user') return 'user'
  return 'assistant'
}

/** persist 阶段：改 user / assistant / reasoning 文本 */
export function applyRegexPersistToTurnFields(params: {
  userText: string
  assistantContent: string
  assistantReasoning?: string
  turnOrdinal: number
  tailOrdinal: number
  rules: RegexRule[]
  opts?: ApplyRegexOptions
}): {
  userText: string
  assistantContent: string
  assistantReasoning?: string
} {
  const ctxBase = {
    phase: 'persist' as const,
    turnOrdinal: params.turnOrdinal,
    tailOrdinal: params.tailOrdinal,
  }
  const userText = applyRegexRulesToText(
    params.userText,
    params.rules,
    { ...ctxBase, field: 'user' },
    params.opts,
  )
  const assistantContent = applyRegexRulesToText(
    params.assistantContent,
    params.rules,
    { ...ctxBase, field: 'assistant' },
    params.opts,
  )
  let assistantReasoning = params.assistantReasoning
  if (assistantReasoning !== undefined && assistantReasoning.length > 0) {
    assistantReasoning = applyRegexRulesToText(
      assistantReasoning,
      params.rules,
      { ...ctxBase, field: 'reasoning' },
      params.opts,
    )
  }
  return { userText, assistantContent, assistantReasoning }
}

export function toRegexRuleSummary(rule: RegexRule) {
  return {
    id: rule.id,
    label: rule.label,
    order: rule.order,
    enabled: rule.enabled,
    phases: [...rule.phases],
    fields: [...rule.fields],
    skipLastNTurns: rule.skipLastNTurns,
    skipLastNTurnsDisplay: rule.skipLastNTurnsDisplay,
    skipLastNTurnsOutgoing: rule.skipLastNTurnsOutgoing,
    skipLastNTurnsPersist: rule.skipLastNTurnsPersist,
  }
}
