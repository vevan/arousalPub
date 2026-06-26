import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { bindChatClientAbort, mergeChatUpstreamAbortSignals } from '../src/chat-upstream-stream.js'

describe('bindChatClientAbort', () => {
  it('aborts when request raw closes', () => {
    const raw = new EventEmitter()
    const request = { raw } as import('fastify').FastifyRequest
    const abort = new AbortController()
    const unbind = bindChatClientAbort(request, abort)
    raw.emit('close')
    assert.equal(abort.signal.aborted, true)
    unbind()
  })
})

describe('mergeChatUpstreamAbortSignals', () => {
  it('aborts when client abort fires', () => {
    const client = new AbortController()
    const signal = mergeChatUpstreamAbortSignals(client, 60_000)
    client.abort()
    assert.equal(signal.aborted, true)
  })
})
