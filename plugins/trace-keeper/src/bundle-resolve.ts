import sampleState from '../bundles/scene-tracker-default/sample-state.json'
import template from '../bundles/scene-tracker-default/template.hbs'
import stylesheet from '../bundles/scene-tracker-default/stylesheet.css'
import { DEFAULT_BUNDLE_ID, type TraceBundle } from './constants.js'
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE } from './default-prompt.js'

export const DEFAULT_TRACE_BUNDLE: TraceBundle = {
  id: DEFAULT_BUNDLE_ID,
  label: 'Scene Tracker (default)',
  sampleState: sampleState as Record<string, unknown>,
  template: template as string,
  stylesheet: stylesheet as string,
  systemPromptTemplate: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  separateSystemPromptTemplate: DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE,
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function parseSampleStateJson(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseUserBundleEntry(
  raw: unknown,
): (Partial<TraceBundle> & { id: string }) | null {
  if (!isPlainObject(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null
  const out: Partial<TraceBundle> & { id: string } = { id }
  if (typeof raw.label === 'string' && raw.label.trim()) {
    out.label = raw.label.trim()
  }
  if (
    typeof raw.systemPromptTemplate === 'string' &&
    raw.systemPromptTemplate.trim()
  ) {
    out.systemPromptTemplate = raw.systemPromptTemplate.trim()
  }
  if (
    typeof raw.separateSystemPromptTemplate === 'string' &&
    raw.separateSystemPromptTemplate.trim()
  ) {
    out.separateSystemPromptTemplate = raw.separateSystemPromptTemplate.trim()
  }
  const fromJson = parseSampleStateJson(raw.sampleStateJson)
  if (fromJson) {
    out.sampleState = fromJson
  } else if (isPlainObject(raw.sampleState)) {
    out.sampleState = raw.sampleState
  }
  if (typeof raw.template === 'string' && raw.template.trim()) {
    out.template = raw.template
  }
  if (typeof raw.stylesheet === 'string') {
    out.stylesheet = raw.stylesheet
  }
  return out
}

function collectUserBundles(
  user: Record<string, unknown>,
): Record<string, Partial<TraceBundle>> {
  const out: Record<string, Partial<TraceBundle>> = {}
  const listRaw = user.bundleList
  const list = Array.isArray(listRaw)
    ? listRaw
    : typeof listRaw === 'string'
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(listRaw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })()
      : []
  for (const item of list) {
    const entry = parseUserBundleEntry(item)
    if (!entry) continue
    out[entry.id] = { ...out[entry.id], ...entry }
  }
  const legacy = user.bundles
  if (isPlainObject(legacy)) {
    for (const [key, val] of Object.entries(legacy)) {
      if (!isPlainObject(val)) continue
      const entry = parseUserBundleEntry({ ...val, id: key })
      if (!entry) continue
      out[entry.id] = { ...out[entry.id], ...entry }
    }
  }
  return out
}

function mergeBundlePartial(
  base: TraceBundle,
  partial: Record<string, unknown>,
): TraceBundle {
  const next: TraceBundle = { ...base }
  if (typeof partial.label === 'string' && partial.label.trim()) {
    next.label = partial.label.trim()
  }
  if (isPlainObject(partial.sampleState)) {
    next.sampleState = partial.sampleState
  }
  if (typeof partial.template === 'string' && partial.template.trim()) {
    next.template = partial.template
  }
  if (typeof partial.stylesheet === 'string') {
    next.stylesheet = partial.stylesheet
  }
  if (
    typeof partial.systemPromptTemplate === 'string' &&
    partial.systemPromptTemplate.trim()
  ) {
    next.systemPromptTemplate = partial.systemPromptTemplate.trim()
  }
  if (
    typeof partial.separateSystemPromptTemplate === 'string' &&
    partial.separateSystemPromptTemplate.trim()
  ) {
    next.separateSystemPromptTemplate =
      partial.separateSystemPromptTemplate.trim()
  }
  return next
}

function shellBundle(id: string, embedded: TraceBundle): TraceBundle {
  if (id === embedded.id) return { ...embedded, id }
  return {
    id,
    label: id,
    sampleState: {},
    template:
      '<div class="trace-keeper-panel"><pre>{{json data}}</pre></div>',
    stylesheet: '.trace-keeper-panel { font-size: 0.875rem; }',
    systemPromptTemplate: embedded.systemPromptTemplate,
    separateSystemPromptTemplate: embedded.separateSystemPromptTemplate,
  }
}

export function resolveTraceBundle(opts: {
  userSettings?: Record<string, unknown> | null
  convSettings?: Record<string, unknown> | null
  embeddedBundle?: TraceBundle
}): TraceBundle {
  const embedded = opts.embeddedBundle ?? DEFAULT_TRACE_BUNDLE
  const user = opts.userSettings ?? {}
  const conv = opts.convSettings ?? {}
  const userBundles = collectUserBundles(user)

  const convOverride = conv.bundleOverride
  const convBundle =
    isPlainObject(conv.bundle) ? (conv.bundle as Record<string, unknown>) : null

  const bundleId =
    (typeof conv.bundleId === 'string' && conv.bundleId.trim()) ||
    (typeof user.activeBundleId === 'string' && user.activeBundleId.trim()) ||
    embedded.id

  let base = shellBundle(bundleId, embedded)
  const fromUser = userBundles[bundleId]
  if (fromUser) {
    base = mergeBundlePartial(base, fromUser)
  }
  if (convBundle) {
    base = mergeBundlePartial(base, convBundle)
  }
  if (isPlainObject(convOverride)) {
    base = mergeBundlePartial(base, convOverride)
  }
  if (!base.systemPromptTemplate?.trim()) {
    base.systemPromptTemplate = DEFAULT_SYSTEM_PROMPT_TEMPLATE
  }
  if (!base.separateSystemPromptTemplate?.trim()) {
    base.separateSystemPromptTemplate = DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE
  }
  return base
}

export function trackerEpochFromSettings(
  convSettings?: Record<string, unknown> | null,
): number {
  const n = convSettings?.trackerEpoch
  if (typeof n === 'number' && Number.isFinite(n)) return Math.max(0, Math.round(n))
  return 0
}
