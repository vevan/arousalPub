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

/** 项目支持的 RegExp flags（顺序固定，序列化时按此排列） */
export const REGEX_FLAG_KEYS = ['g', 'i', 'm', 's', 'u', 'y', 'd'] as const
export type RegexFlagKey = (typeof REGEX_FLAG_KEYS)[number]

export function parseRegexFlags(flags: string): Set<RegexFlagKey> {
  const set = new Set<RegexFlagKey>()
  for (const ch of flags) {
    if ((REGEX_FLAG_KEYS as readonly string[]).includes(ch)) {
      set.add(ch as RegexFlagKey)
    }
  }
  return set
}

export function serializeRegexFlags(active: Iterable<RegexFlagKey>): string {
  const set = active instanceof Set ? active : new Set(active)
  return REGEX_FLAG_KEYS.filter((f) => set.has(f)).join('')
}

export function toggleRegexFlag(flags: string, flag: RegexFlagKey): string {
  const set = parseRegexFlags(flags)
  if (set.has(flag)) set.delete(flag)
  else set.add(flag)
  return serializeRegexFlags(set)
}

export function isRegexFlagActive(flags: string, flag: RegexFlagKey): boolean {
  return parseRegexFlags(flags).has(flag)
}

/** 只读展示：/gim（无 flag 时为 /） */
export function formatRegexFlagsLiteral(flags: string): string {
  return `/${flags}`
}

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

export function assignOrdersInListOrder(rules: RegexRule[]): RegexRule[] {
  return rules.map((r, i) => ({
    ...cloneRegexRule(r),
    order: (i + 1) * 10,
  }))
}

/** 先按 order 排序，再重赋 order（用于读盘/合并后规范化） */
export function reassignRegexRuleOrders(rules: RegexRule[]): RegexRule[] {
  return assignOrdersInListOrder(sortRegexRules(rules))
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

export const REGEX_RULE_COPY_SUFFIX = '-COPY'

/** 复制规则名称：AAA-COPY；超长时截断 AAA 部分 */
export function buildDuplicateRegexRuleLabel(
  sourceLabel: string,
  fallbackLabel: string,
  suffix = REGEX_RULE_COPY_SUFFIX,
): string {
  const base = sourceLabel.trim() || fallbackLabel.trim()
  const maxBaseLen = Math.max(0, MAX_REGEX_LABEL_LENGTH - suffix.length)
  const trimmedBase = base.length > maxBaseLen ? base.slice(0, maxBaseLen) : base
  return `${trimmedBase}${suffix}`
}

export function duplicateRegexRule(
  source: RegexRule,
  existing: RegexRule[],
  label: string,
): RegexRule {
  const used = new Set(existing.map((r) => r.id))
  return {
    ...cloneRegexRule(source),
    id: allocateShortId(used),
    label,
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
    rules: assignOrdersInListOrder(rules),
  }
}

/**
 * 构建 PUT 载荷：保持 UI 列表顺序；未保存就绪的新草稿不入库；
 * 已有但未编辑完的规则沿用上次同步内容，仅同步 order / enabled / label。
 */
export function buildRulesForServerPut(
  localInOrder: RegexRule[],
  synced: RegexRule[],
): RegexRule[] {
  const syncedById = new Map(synced.map((r) => [r.id, r]))
  const out: RegexRule[] = []
  for (const local of localInOrder) {
    if (isRegexRuleSaveReady(local)) {
      out.push(cloneRegexRule(local))
      continue
    }
    const prev = syncedById.get(local.id)
    if (prev) {
      out.push({
        ...cloneRegexRule(prev),
        order: local.order,
        enabled: local.enabled,
        label: local.label,
      })
    }
  }
  return assignOrdersInListOrder(out)
}

/** PUT 成功后把服务端规则与本地未保存草稿合并，恢复 UI 列表 */
export function mergeSavedRulesWithLocalDrafts(
  savedInOrder: RegexRule[],
  localInOrder: RegexRule[],
): RegexRule[] {
  const savedById = new Map(savedInOrder.map((r) => [r.id, r]))
  const merged: RegexRule[] = []
  for (const local of localInOrder) {
    if (!isRegexRuleSaveReady(local)) {
      merged.push(cloneRegexRule(local))
      continue
    }
    merged.push(savedById.get(local.id) ?? cloneRegexRule(local))
  }
  return assignOrdersInListOrder(merged)
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

export type RegexPipelineRuleOutcome = 'skipped_disabled' | 'no_match' | 'hit'

export interface RegexPipelineRuleStat {
  ruleId: string
  outcome: RegexPipelineRuleOutcome
  hitCount: number
}

export interface RegexPipelinePlainTextResult {
  output: string
  stats: RegexPipelineRuleStat[]
}

function countRegexMatches(text: string, pattern: string, flags: string): number {
  if (validateRegexPatternClient(pattern, flags) !== null) return 0
  const re = new RegExp(pattern, flags)
  if (!re.global) return re.test(text) ? 1 : 0
  return [...text.matchAll(re)].length
}

/**
 * 单管线纯文本测试：按 order 串联；仅 enabled 规则参与；忽略 phase / field / skipLastNTurns。
 */
export function runRegexPipelinePlainTextTest(
  text: string,
  rules: RegexRule[],
): RegexPipelinePlainTextResult {
  const stats: RegexPipelineRuleStat[] = []
  let out = text
  for (const rule of sortRegexRules(rules)) {
    if (!rule.enabled) {
      stats.push({ ruleId: rule.id, outcome: 'skipped_disabled', hitCount: 0 })
      continue
    }
    const hitCount = countRegexMatches(out, rule.pattern, rule.flags)
    if (hitCount === 0) {
      stats.push({ ruleId: rule.id, outcome: 'no_match', hitCount: 0 })
      continue
    }
    try {
      const re = new RegExp(rule.pattern, rule.flags)
      out = out.replace(re, rule.replacement)
    } catch {
      stats.push({ ruleId: rule.id, outcome: 'no_match', hitCount: 0 })
      continue
    }
    stats.push({ ruleId: rule.id, outcome: 'hit', hitCount })
  }
  return { output: out, stats }
}
