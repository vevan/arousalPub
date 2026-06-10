import type {
  RegexApplyContext,
  RegexPhase,
  RegexRule,
  RegexRuleSummary,
} from '@/types/regex-rules'
import { PluginHostApiError } from '@/plugins/plugin-host-api-error'
import {
  applyRegexRulesToMessagesHost,
  applyRegexRulesToTextHost,
  filterRegexRulesForHost,
  toRegexRuleSummary,
  type RegexApplyMessagesContext,
  type RegexHostMessage,
} from '@/utils/regex-host-apply'

let cachedRules: RegexRule[] | null = null
let cacheLoadedAt = 0
const CACHE_TTL_MS = 30_000

export function invalidateRegexHostRulesCache(): void {
  cachedRules = null
  cacheLoadedAt = 0
}

async function fetchRegexRulesCached(): Promise<RegexRule[]> {
  const now = Date.now()
  if (cachedRules && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedRules
  }
  const res = await fetch('/api/regex-rules')
  if (!res.ok) {
    throw new PluginHostApiError('regex_rules_read_failed', res.status)
  }
  const doc = (await res.json()) as { rules?: RegexRule[] }
  cachedRules = Array.isArray(doc.rules) ? doc.rules : []
  cacheLoadedAt = now
  return cachedRules
}

export async function listRegexRulesForHost(opts?: {
  phases?: RegexPhase[]
}): Promise<RegexRuleSummary[]> {
  const rules = await fetchRegexRulesCached()
  const filtered = filterRegexRulesForHost(rules, { phases: opts?.phases })
  return filtered.map(toRegexRuleSummary)
}

export async function applyRegexTextForHost(
  text: string,
  ruleIds: string[] | 'all',
  ctx: RegexApplyContext,
): Promise<string> {
  const rules = await fetchRegexRulesCached()
  const filtered = filterRegexRulesForHost(rules, { ruleIds })
  return applyRegexRulesToTextHost(text, filtered, ctx)
}

export async function applyRegexMessagesForHost(
  messages: RegexHostMessage[],
  ruleIds: string[] | 'all',
  ctx: RegexApplyMessagesContext,
): Promise<RegexHostMessage[]> {
  const rules = await fetchRegexRulesCached()
  const filtered = filterRegexRulesForHost(rules, { ruleIds })
  return applyRegexRulesToMessagesHost(messages, filtered, ctx)
}

export type { RegexApplyMessagesContext, RegexHostMessage }
