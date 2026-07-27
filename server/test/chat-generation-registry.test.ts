import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  __chatGenerationRegistrySizeForTest,
  __resetChatGenerationRegistryForTest,
  cancelChatGeneration,
  CHAT_GENERATION_TTL_MS,
  generateChatGenerationId,
  getChatGeneration,
  registerChatGeneration,
  sweepExpiredChatGenerations,
  unregisterChatGeneration,
} from '../src/chat-generation-registry.js'

describe('chat-generation-registry', () => {
  beforeEach(() => {
    __resetChatGenerationRegistryForTest()
  })

  it('register + cancel aborts matching conversation', () => {
    const abort = new AbortController()
    const gid = registerChatGeneration('conv-a', abort)
    assert.equal(gid.length, 16)
    assert.equal(getChatGeneration(gid)?.conversationId, 'conv-a')
    assert.equal(cancelChatGeneration('conv-other', gid), false)
    assert.equal(abort.signal.aborted, false)
    assert.equal(cancelChatGeneration('conv-a', gid), true)
    assert.equal(abort.signal.aborted, true)
    assert.equal(getChatGeneration(gid)?.userCancelled, true)
  })

  it('unregister removes entry', () => {
    const abort = new AbortController()
    const gid = registerChatGeneration('conv-a', abort, generateChatGenerationId())
    unregisterChatGeneration(gid)
    assert.equal(getChatGeneration(gid), undefined)
    assert.equal(cancelChatGeneration('conv-a', gid), false)
  })

  it('accepts client-provided generation id', () => {
    const abort = new AbortController()
    const gid = 'abcdef0123456789'
    const registered = registerChatGeneration('conv-a', abort, gid)
    assert.equal(registered, gid)
    assert.equal(getChatGeneration(gid)?.conversationId, 'conv-a')
  })

  it('supersede same conversation marks old userCancelled', () => {
    const a1 = new AbortController()
    const a2 = new AbortController()
    const g1 = registerChatGeneration('conv-a', a1)
    const g2 = registerChatGeneration('conv-a', a2)
    assert.notEqual(g1, g2)
    assert.equal(a1.signal.aborted, true)
    assert.equal(getChatGeneration(g1)?.userCancelled, true)
    assert.equal(getChatGeneration(g2)?.userCancelled, false)
  })

  it('sweepExpired removes stale entries', () => {
    const abort = new AbortController()
    const gid = registerChatGeneration('conv-a', abort)
    const entry = getChatGeneration(gid)
    assert.ok(entry)
    entry.createdAt = Date.now() - CHAT_GENERATION_TTL_MS - 1
    const removed = sweepExpiredChatGenerations()
    assert.equal(removed, 1)
    assert.equal(__chatGenerationRegistrySizeForTest(), 0)
    assert.equal(abort.signal.aborted, true)
  })
})
