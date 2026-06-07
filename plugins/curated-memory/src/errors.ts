import { k } from './settings.js'
import type { PluginHost } from './types.js'

const PIPELINE_FATAL_ERRORS = new Set([
  'context_exceeded',
  'context_length_unconfigured',
])

export function isPipelineFatalError(e: unknown) {
  return e instanceof Error && PIPELINE_FATAL_ERRORS.has(e.message)
}

export function isAbortError(e: unknown) {
  return (
    (typeof DOMException !== 'undefined' &&
      e instanceof DOMException &&
      e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

export function isLorebookEntryMissingError(e: unknown) {
  if (!e || typeof e !== 'object') return false
  const o = e as { code?: string; status?: number }
  const code = typeof o.code === 'string' ? o.code : ''
  const status = typeof o.status === 'number' ? o.status : 0
  return (
    code === 'lorebook_entry_not_found' ||
    code === 'lorebook_not_found' ||
    (code === 'lorebook_entry_patch_failed' && status === 404)
  )
}

export function preflightToast(host: PluginHost, e: unknown) {
  if (e instanceof Error && e.message === 'context_exceeded') {
    const err = e as Error & { promptTokens?: number; budget?: number }
    host.ui.toast(
      host.t(k(host, 'toastContextExceeded'), {
        used: err.promptTokens,
        budget: err.budget,
      }),
      { color: 'warning' },
    )
    return
  }
  if (e instanceof Error && e.message === 'context_length_unconfigured') {
    host.ui.toast(host.t(k(host, 'toastContextLengthMissing')), { color: 'warning' })
    return
  }
  if (isLorebookEntryMissingError(e)) {
    host.ui.toast(host.t(k(host, 'toastSidecarEntryMissing')), { color: 'warning' })
    return
  }
  if (e instanceof Error && e.message === 'parse_failed') {
    host.ui.toast(host.t(k(host, 'toastParseFailed')), { color: 'error' })
    return
  }
  host.ui.toast(host.t(k(host, 'toastSummarizeFailed')), { color: 'error' })
}
