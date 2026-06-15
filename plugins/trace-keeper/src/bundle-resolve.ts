import sampleState from '../bundles/scene-tracker-default/sample-state.json'
import template from '../bundles/scene-tracker-default/template.hbs'
import stylesheet from '../bundles/scene-tracker-default/stylesheet.css'
import { DEFAULT_BUNDLE_ID, type TraceBundle } from './constants.js'

export const DEFAULT_TRACE_BUNDLE: TraceBundle = {
  id: DEFAULT_BUNDLE_ID,
  label: 'Scene Tracker (default)',
  sampleState: sampleState as Record<string, unknown>,
  template: template as string,
  stylesheet: stylesheet as string,
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
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
  return next
}

export function resolveTraceBundle(opts: {
  userSettings?: Record<string, unknown> | null
  convSettings?: Record<string, unknown> | null
  embeddedBundle?: TraceBundle
}): TraceBundle {
  const embedded = opts.embeddedBundle ?? DEFAULT_TRACE_BUNDLE
  const user = opts.userSettings ?? {}
  const conv = opts.convSettings ?? {}
  const bundlesRaw = user.bundles
  const bundles =
    bundlesRaw && typeof bundlesRaw === 'object' && !Array.isArray(bundlesRaw)
      ? (bundlesRaw as Record<string, unknown>)
      : {}

  const convOverride = conv.bundleOverride
  const convBundle =
    isPlainObject(conv.bundle) ? (conv.bundle as Record<string, unknown>) : null

  const bundleId =
    (typeof conv.bundleId === 'string' && conv.bundleId.trim()) ||
    (typeof user.activeBundleId === 'string' && user.activeBundleId.trim()) ||
    embedded.id

  let base: TraceBundle = { ...embedded, id: bundleId }
  const fromUser = bundles[bundleId]
  if (isPlainObject(fromUser)) {
    base = mergeBundlePartial(base, fromUser)
  }
  if (convBundle) {
    base = mergeBundlePartial(base, convBundle)
  }
  if (isPlainObject(convOverride)) {
    base = mergeBundlePartial(base, convOverride)
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
