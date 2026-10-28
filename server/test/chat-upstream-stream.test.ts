import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it, mock } from 'node:test'
import {
  bindChatClientAbort,
  createChatUpstreamIdleAbort,
} from '../src/chat-upstream-stream.js'

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

describe('createChatUpstreamIdleAbort', () => {
  it('aborts when client abort fires', () => {
    mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    try {
      const client = new AbortController()
      const idle = createChatUpstreamIdleAbort(client, 60_000)
      client.abort()
      assert.equal(idle.signal.aborted, true)
      idle.dispose()
    } finally {
      mock.timers.reset()
    }
  })

  it('aborts after idle without touch', () => {
    mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    try {
      const client = new AbortController()
      const idle = createChatUpstreamIdleAbort(client, 5_000)
      assert.equal(idle.signal.aborted, false)
      mock.timers.tick(5_000)
      assert.equal(idle.signal.aborted, true)
      idle.dispose()
    } finally {
      mock.timers.reset()
    }
  })

  it('touch resets idle window', () => {
    mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    try {
      const client = new AbortController()
      const idle = createChatUpstreamIdleAbort(client, 5_000)
      mock.timers.tick(4_000)
      idle.touch()
      mock.timers.tick(4_000)
      assert.equal(idle.signal.aborted, false)
      mock.timers.tick(1_000)
      assert.equal(idle.signal.aborted, true)
      idle.dispose()
    } finally {
      mock.timers.reset()
    }
  })

  it('dispose stops further idle abort', () => {
    mock.timers.enable({ apis: ['setTimeout'], now: 0 })
    try {
      const client = new AbortController()
      const idle = createChatUpstreamIdleAbort(client, 5_000)
      mock.timers.tick(4_000)
      idle.dispose()
      mock.timers.tick(10_000)
      assert.equal(idle.signal.aborted, false)
      assert.equal(client.signal.aborted, false)
    } finally {
      mock.timers.reset()
    }
  })
})
