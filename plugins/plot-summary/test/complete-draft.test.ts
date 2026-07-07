import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCompleteDraftContent } from '../dist/server.mjs'

describe('parseCompleteDraftContent sidecar', () => {
  const base = {
    pluginId: 'plot-summary',
    conversationId: 'abcd1234',
    kind: 'sidecar' as const,
    pluginSettings: { sidecarName: '关系' },
  }

  it('accepts content-only json with fixed sidecar title', () => {
    const { draft } = parseCompleteDraftContent(
      base,
      '{"content":"Alice trusts Bob."}',
      null,
    )
    assert.equal(draft.title, '关系')
    assert.match(draft.content, /Alice/)
  })

  it('coerces object content to JSON text', () => {
    const { draft } = parseCompleteDraftContent(
      {
        ...base,
        pluginSettings: { sidecarName: '状态' },
      },
      '{"content":{"mood":"tense","location":"tavern"}}',
      null,
    )
    assert.equal(draft.title, '状态')
    assert.match(draft.content, /tense/)
  })

  it('throws parse_failed for empty payload', () => {
    assert.throws(
      () => parseCompleteDraftContent(base, '{"keywords":[]}', null),
      /parse_failed/,
    )
  })
})
