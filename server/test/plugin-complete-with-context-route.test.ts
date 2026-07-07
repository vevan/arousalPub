import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiErrorCodes } from '../src/api-error-codes.js'

/** 与 index.ts complete-with-context 路由 errorKey 映射保持一致 */
function mapCompleteWithContextErrorKey(code: string): keyof typeof ApiErrorCodes {
  if (code === 'parse_failed' || code === 'plugin_complete_draft_failed') {
    return 'plugin_complete_draft_failed'
  }
  if (code === 'context_exceeded') {
    return 'plugin_complete_context_exceeded'
  }
  if (code === 'context_length_unconfigured') {
    return 'plugin_complete_context_length_unconfigured'
  }
  if (code in ApiErrorCodes) {
    return code as keyof typeof ApiErrorCodes
  }
  return 'plugin_complete_with_context_failed'
}

describe('complete-with-context route error mapping', () => {
  it('maps context_length_unconfigured to plugin_complete_context_length_unconfigured', () => {
    const key = mapCompleteWithContextErrorKey('context_length_unconfigured')
    assert.equal(key, 'plugin_complete_context_length_unconfigured')
    assert.equal(
      ApiErrorCodes[key],
      'plugin_complete_context_length_unconfigured',
    )
  })

  it('maps context_exceeded to plugin_complete_context_exceeded', () => {
    const key = mapCompleteWithContextErrorKey('context_exceeded')
    assert.equal(ApiErrorCodes[key], 'plugin_complete_context_exceeded')
  })
})
