import { k } from './settings.js'
import type { PluginHost } from './types.js'

const PIPELINE_FATAL_CODES = new Set([
  'context_exceeded',
  'plugin_complete_context_exceeded',
  'context_length_unconfigured',
  'plugin_complete_context_length_unconfigured',
])

export function pipelineErrorCode(e: unknown): string {
  if (!e || typeof e !== 'object') return ''
  const o = e as { code?: string; message?: string }
  if (typeof o.code === 'string' && o.code) return o.code
  if (e instanceof Error && e.message) return e.message
  return ''
}

export function isPipelineFatalError(e: unknown) {
  return PIPELINE_FATAL_CODES.has(pipelineErrorCode(e))
}

export function isAbortError(e: unknown) {
  return (
    (typeof DOMException !== 'undefined' &&
      e instanceof DOMException &&
      e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  )
}

export function lorebookErrorCode(e: unknown): string {
  return pipelineErrorCode(e)
}

export function isLorebookNotFoundError(e: unknown) {
  return lorebookErrorCode(e) === 'lorebook_not_found'
}

export function isLorebookEntryMissingError(e: unknown) {
  if (!e || typeof e !== 'object') return false
  const o = e as { code?: string; status?: number; message?: string }
  const code = lorebookErrorCode(e) || (typeof o.code === 'string' ? o.code : '')
  const status = typeof o.status === 'number' ? o.status : 0
  return (
    code === 'lorebook_entry_not_found' ||
    (code === 'lorebook_entry_patch_failed' && status === 404)
  )
}

function contextExceededToastParams(e: unknown): { used?: number; budget?: number } {
  if (!e || typeof e !== 'object') return {}
  const o = e as { promptTokens?: number; budget?: number }
  return {
    used: typeof o.promptTokens === 'number' ? o.promptTokens : undefined,
    budget: typeof o.budget === 'number' ? o.budget : undefined,
  }
}

export function preflightToast(host: PluginHost, e: unknown) {
  const code = pipelineErrorCode(e)
  if (code === 'context_exceeded' || code === 'plugin_complete_context_exceeded') {
    const { used, budget } = contextExceededToastParams(e)
    host.ui.notify(host.t(k(host, 'toastContextExceeded'), {
        used: used ?? '?',
        budget: budget ?? '?',
      }), undefined, { level: 'warning' })
    return
  }
  if (
    code === 'context_length_unconfigured' ||
    code === 'plugin_complete_context_length_unconfigured'
  ) {
    host.ui.notify(host.t(k(host, 'toastContextLengthMissing')), undefined, { level: 'warning' })
    return
  }
  if (isLorebookNotFoundError(e)) {
    host.ui.notify(host.t(k(host, 'toastTargetLorebookDeleted')), undefined, { level: 'warning' })
    return
  }
  if (isLorebookEntryMissingError(e)) {
    host.ui.notify(host.t(k(host, 'toastSidecarEntryMissing')), undefined, { level: 'warning' })
    return
  }
  if (code === 'parse_failed') {
    host.ui.notify(host.t(k(host, 'toastParseFailed')), undefined, { level: 'error' })
    return
  }
  const apiCode = lorebookErrorCode(e)
  if (
    apiCode === 'plugin_complete_draft_failed' ||
    apiCode === 'parse_failed'
  ) {
    host.ui.notify(host.t(k(host, 'toastParseFailed')), undefined, { level: 'error' })
    return
  }
  if (apiCode === 'sidecar_prompt_required') {
    host.ui.notify(host.t(k(host, 'toastSummarizeFailed')), undefined, { level: 'error' })
    return
  }
  host.ui.notify(host.t(k(host, 'toastSummarizeFailed')), undefined, { level: 'error' })
}
