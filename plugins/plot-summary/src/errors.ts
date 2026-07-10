import { k } from './settings.js'
import { notifyOutcome } from './notify-outcome.js'
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

export function isParseFailedError(e: unknown): boolean {
  const code = pipelineErrorCode(e)
  return code === 'parse_failed' || code === 'plugin_complete_draft_failed'
}

export function preflightNotify(host: PluginHost, e: unknown, taskLabel?: string) {
  const code = pipelineErrorCode(e)
  if (isParseFailedError(e)) {
    return
  }
  const withTask = (title: string) => {
    const task = taskLabel?.trim()
    return task ? `${task}：${title}` : title
  }
  if (code === 'context_exceeded' || code === 'plugin_complete_context_exceeded') {
    const { used, budget } = contextExceededToastParams(e)
    host.ui.notify(withTask(host.t(k(host, 'notifyContextExceeded'), {
        used: used ?? '?',
        budget: budget ?? '?',
      })), undefined, { level: 'warning' })
    return
  }
  if (
    code === 'context_length_unconfigured' ||
    code === 'plugin_complete_context_length_unconfigured'
  ) {
    host.ui.notify(withTask(host.t(k(host, 'notifyContextLengthMissing'))), undefined, { level: 'warning' })
    return
  }
  if (isLorebookNotFoundError(e)) {
    host.ui.notify(withTask(host.t(k(host, 'notifyTargetLorebookDeleted'))), undefined, { level: 'warning' })
    return
  }
  if (isLorebookEntryMissingError(e)) {
    host.ui.notify(withTask(host.t(k(host, 'notifySidecarEntryMissing'))), undefined, { level: 'warning' })
    return
  }
  const apiCode = lorebookErrorCode(e)
  if (apiCode === 'sidecar_prompt_required') {
    notifyOutcome(host, 'notifySummarizeFailed', 'error')
    return
  }
  host.ui.notify(withTask(host.t(k(host, 'notifySummarizeFailed'))), undefined, { level: 'error' })
}
