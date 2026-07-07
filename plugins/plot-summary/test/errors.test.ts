import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPipelineFatalError,
  pipelineErrorCode,
  preflightToast,
} from '../src/errors.js'
import type { PluginHost } from '../src/types.js'

class MockHostApiError extends Error {
  readonly code: string
  readonly promptTokens?: number
  readonly budget?: number

  constructor(
    code: string,
    opts?: { promptTokens?: number; budget?: number },
  ) {
    super(code)
    this.code = code
    this.promptTokens = opts?.promptTokens
    this.budget = opts?.budget
  }
}

function mockHost(): PluginHost & { toasts: { text: string; color?: string }[] } {
  const toasts: { text: string; color?: string }[] = []
  return {
    toasts,
    pluginKey(key: string) {
      return `plugins.plot-summary.${key}`
    },
    t(key: string, params?: Record<string, unknown>) {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
    ui: {
      toast(text: string, opts?: { color?: string }) {
        toasts.push({ text, color: opts?.color })
      },
      progress() {},
      clearProgress() {},
    },
  } as unknown as PluginHost & { toasts: { text: string; color?: string }[] }
}

describe('plot-summary errors', () => {
  it('pipelineErrorCode reads PluginHostApiError-style code', () => {
    const err = new MockHostApiError('plugin_complete_context_exceeded', {
      promptTokens: 9000,
      budget: 8000,
    })
    assert.equal(pipelineErrorCode(err), 'plugin_complete_context_exceeded')
  })

  it('isPipelineFatalError treats plugin_complete_context_exceeded as fatal', () => {
    assert.equal(
      isPipelineFatalError(
        new MockHostApiError('plugin_complete_context_exceeded'),
      ),
      true,
    )
    assert.equal(isPipelineFatalError(new Error('context_exceeded')), true)
    assert.equal(isPipelineFatalError(new Error('parse_failed')), false)
  })

  it('isPipelineFatalError treats plugin_complete_context_length_unconfigured as fatal', () => {
    assert.equal(
      isPipelineFatalError(
        new MockHostApiError('plugin_complete_context_length_unconfigured'),
      ),
      true,
    )
  })

  it('preflightToast shows context exceeded with token counts from API error', () => {
    const host = mockHost()
    preflightToast(
      host,
      new MockHostApiError('plugin_complete_context_exceeded', {
        promptTokens: 12000,
        budget: 8192,
      }),
    )
    assert.equal(host.toasts.length, 1)
    assert.match(host.toasts[0]?.text ?? '', /12000/)
    assert.match(host.toasts[0]?.text ?? '', /8192/)
    assert.equal(host.toasts[0]?.color, 'warning')
  })

  it('preflightToast shows context length missing for plugin API code', () => {
    const host = mockHost()
    preflightToast(
      host,
      new MockHostApiError('plugin_complete_context_length_unconfigured'),
    )
    assert.equal(host.toasts.length, 1)
    assert.match(host.toasts[0]?.text ?? '', /toastContextLengthMissing|contextLength/)
    assert.equal(host.toasts[0]?.color, 'warning')
  })
})
