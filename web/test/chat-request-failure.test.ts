import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ChatRequestFailure,
  isChatRequestFailure,
} from '../src/utils/chat-request-failure.js'

describe('ChatRequestFailure', () => {
  it('identifies ChatRequestFailure instances', () => {
    assert.equal(isChatRequestFailure(new ChatRequestFailure('向量索引损坏')), true)
    assert.equal(isChatRequestFailure(new Error('Failed to fetch')), false)
    assert.equal(isChatRequestFailure(new TypeError('network')), false)
    assert.equal(isChatRequestFailure('memory_vector_index_corrupt'), false)
  })

  it('identifies cross-realm Error with name ChatRequestFailure', () => {
    const e = new Error('远期记忆向量索引损坏或不完整，请重建索引')
    e.name = 'ChatRequestFailure'
    assert.equal(isChatRequestFailure(e), true)
  })
})
