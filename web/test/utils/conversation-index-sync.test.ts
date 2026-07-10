import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  emitConversationIndexPatched,
  onConversationIndexPatched,
} from '../../src/utils/conversation-index-sync.js'

describe('conversation-index-sync', () => {
  it('notifies listeners for matching conversation', () => {
    const seen: string[] = []
    const stop = onConversationIndexPatched((conversationId, index) => {
      seen.push(`${conversationId}:${String(index.title)}`)
    })
    emitConversationIndexPatched('conv-1', { title: 'Test' })
    stop()
    emitConversationIndexPatched('conv-2', { title: 'Other' })
    assert.deepEqual(seen, ['conv-1:Test'])
  })
})
