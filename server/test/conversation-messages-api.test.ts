import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConversationMessages } from '../src/conversation-messages-api.js'

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

  it('tail on empty conversation still returns page (not bare turns)', async () => {
    const result = await loadConversationMessages('conv-missing-for-empty-tail', {
      tail: '30',
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.response.turns, [])
    assert.ok(result.response.page)
    assert.equal(result.response.page.hasMoreBefore, false)
    assert.equal(result.response.page.from, 0)
    assert.equal(result.response.page.to, -1)
  })
})
