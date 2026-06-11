import type {
  PluginSettingsFieldSchema,
  PluginSettingsOptionsFilter,
} from '@/plugins/plugin-settings-types'
import type { RegexPhase, RegexRule } from '@/types/regex-rules'
import { apiFetch } from '@/utils/api-fetch'
import { sortRegexRules } from '@/utils/regex-rules'
import type { PluginSchemaSelectItem } from '@/utils/plugin-schema-selects'

function isRegexPhase(v: string): v is RegexPhase {
  return v === 'display' || v === 'outgoing' || v === 'persist'
}

function filterRegexRulesForOptions(
  rules: RegexRule[],
  filter?: PluginSettingsOptionsFilter,
): RegexRule[] {
  let list = rules
  if (filter?.enabled === true) {
    list = list.filter((r) => r.enabled)
  }
  const phases = filter?.phases?.filter(isRegexPhase)
  if (phases?.length) {
    const phaseSet = new Set(phases)
    list = list.filter((r) => r.phases.some((p) => phaseSet.has(p)))
  }
  return sortRegexRules(list)
}

function ruleOptionTitle(rule: RegexRule): string {
  const label = rule.label.trim()
  return label || rule.id
}

export function optionsSourceCacheKey(
  field: Pick<PluginSettingsFieldSchema, 'optionsSource' | 'optionsFilter'>,
): string {
  const src = field.optionsSource ?? ''
  const filter = field.optionsFilter ?? {}
  return `${src}:${JSON.stringify(filter)}`
}

export async function loadCheckboxOptionsForField(
  field: PluginSettingsFieldSchema,
): Promise<PluginSchemaSelectItem[]> {
  if (field.type !== 'checkboxGroup') return []
  if (field.optionsSource === 'regex-rules') {
    const res = await apiFetch('/api/regex-rules')
    if (!res.ok) return []
    const doc = (await res.json()) as { rules?: RegexRule[] }
    const rules = Array.isArray(doc.rules) ? doc.rules : []
    return filterRegexRulesForOptions(rules, field.optionsFilter).map((r) => ({
      value: r.id,
      title: ruleOptionTitle(r),
    }))
  }
  return (field.options ?? []).map((o) => ({
    value: o.value,
    title: o.label?.trim() || o.value,
  }))
}

export function needsOptionsSource(fields: PluginSettingsFieldSchema[]): boolean {
  return fields.some(
    (f) => f.type === 'checkboxGroup' && Boolean(f.optionsSource),
  )
}

export function fieldsUsingOptionsSource(
  fields: PluginSettingsFieldSchema[],
): PluginSettingsFieldSchema[] {
  return fields.filter(
    (f) => f.type === 'checkboxGroup' && Boolean(f.optionsSource),
  )
}
