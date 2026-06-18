import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeChatUpstreamAbortSignals } from './chat-upstream-stream.js'

describe('mergeChatUpstreamAbortSignals', () => {
  it('aborts when client abort fires', () => {
    const client = new AbortController()
    const signal = mergeChatUpstreamAbortSignals(client, 60_000)
    client.abort()
    assert.equal(signal.aborted, true)
  })
})
