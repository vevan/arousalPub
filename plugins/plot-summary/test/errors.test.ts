import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isParseFailedError,
  isPipelineFatalError,
  pipelineErrorCode,
  preflightNotify,
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

function mockHost(): PluginHost & { notifies: { title: string; body?: string; level?: string }[] } {
  const notifies: { title: string; body?: string; level?: string }[] = []
  return {
    notifies,
    pluginKey(key: string) {
      return `plugins.plot-summary.${key}`
    },
    t(key: string, params?: Record<string, unknown>) {
      if (params) return `${key}:${JSON.stringify(params)}`
      return key
    },
    ui: {
      notify(title: string, body?: string, opts?: { level?: string }) {
        notifies.push({ title, body, level: opts?.level })
      },
      progress() {},
      clearProgress() {},
    },
  } as unknown as PluginHost & { notifies: { title: string; body?: string; color?: string }[] }
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

  it('preflightNotify shows context exceeded with token counts from API error', () => {
    const host = mockHost()
    preflightNotify(
      host,
      new MockHostApiError('plugin_complete_context_exceeded', {
        promptTokens: 12000,
        budget: 8192,
      }),
    )
    assert.equal(host.notifies.length, 1)
    assert.match(host.notifies[0]?.title ?? '', /12000/)
    assert.match(host.notifies[0]?.title ?? '', /8192/)
    assert.equal(host.notifies[0]?.level, 'warning')
  })

  it('preflightNotify shows context length missing for plugin API code', () => {
    const host = mockHost()
    preflightNotify(
      host,
      new MockHostApiError('plugin_complete_context_length_unconfigured'),
    )
    assert.equal(host.notifies.length, 1)
    assert.match(host.notifies[0]?.title ?? '', /notifyContextLengthMissing|contextLength/)
    assert.equal(host.notifies[0]?.level, 'warning')
  })

  it('isParseFailedError detects parse_failed and plugin_complete_draft_failed', () => {
    assert.equal(isParseFailedError(new MockHostApiError('parse_failed')), true)
    assert.equal(
      isParseFailedError(new MockHostApiError('plugin_complete_draft_failed')),
      true,
    )
    assert.equal(isParseFailedError(new Error('context_exceeded')), false)
  })

  it('preflightNotify skips parse failures (handled at draft boundary)', () => {
    const host = mockHost()
    preflightNotify(host, new MockHostApiError('parse_failed'))
    assert.equal(host.notifies.length, 0)
  })
})
