import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConversationMessages } from './conversation-messages-api.js'

describe('loadConversationMessages query modes', () => {
  it('rejects conflicting query params', async () => {
    const result = await loadConversationMessages('conv-test', {
      tail: '10',
      before: '5',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error, 'messages_range_invalid')
  })
})
