import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildStreamAuditStats,
  buildUpstreamTimingMs,
  isSseContentDelta,
  resolveTpsTokenCount,
} from './chat-audit-performance.js'

describe('isSseContentDelta', () => {
  it('accepts text or reasoning only', () => {
    assert.equal(isSseContentDelta({ text: 'hi' }), true)
    assert.equal(isSseContentDelta({ reasoning: 'think' }), true)
    assert.equal(isSseContentDelta({ completionTokens: 3 }), false)
    assert.equal(isSseContentDelta(null), false)
  })
})

describe('buildUpstreamTimingMs', () => {
  it('computes TPS from upstream completion tokens', () => {
    const upstreamStartedAt = 1000
    const firstTokenAt = 1500
    const lastTokenAt = 3500
    const out = buildUpstreamTimingMs({
      upstreamStartedAt,
      responseHeadersAt: 1200,
      firstTokenAt,
      lastTokenAt,
      streamEndedAt: 3600,
      completionTokensUpstream: 40,
      assistantContent: 'hello world',
      model: 'gpt-4o',
    })
    assert.equal(out?.toResponseHeaders, 200)
    assert.equal(out?.toFirstToken, 500)
    assert.equal(out?.firstTokenToLastToken, 2000)
    assert.equal(out?.total, 2600)
    assert.equal(out?.tpsTokenSource, 'upstream')
    assert.equal(out?.tpsTokenCount, 40)
    assert.equal(out?.tps, 20)
  })

  it('falls back to estimated tokens when upstream missing', () => {
    const firstTokenAt = 100
    const lastTokenAt = 1100
    const resolved = resolveTpsTokenCount(
      undefined,
      'hello',
      undefined,
      'gpt-4o',
    )
    assert.equal(resolved?.source, 'estimated')
    const out = buildUpstreamTimingMs({
      upstreamStartedAt: 0,
      firstTokenAt,
      lastTokenAt,
      streamEndedAt: 1200,
      assistantContent: 'hello',
      model: 'gpt-4o',
    })
    assert.equal(out?.tpsTokenSource, 'estimated')
    assert.ok((out?.tps ?? 0) > 0)
  })
})

describe('buildStreamAuditStats', () => {
  it('splits content and reasoning estimates when enabled', () => {
    const out = buildStreamAuditStats({
      assistantContent: 'answer',
      assistantReasoning: 'thought',
      completionTokensUpstream: 10,
      model: 'gpt-4o',
      includeTokenEstimates: true,
    })
    assert.equal(out?.contentChars, 6)
    assert.equal(out?.reasoningChars, 7)
    assert.equal(out?.completionTokensUpstream, 10)
    assert.ok((out?.contentTokensEst ?? 0) > 0)
    assert.ok((out?.reasoningTokensEst ?? 0) > 0)
  })
})
