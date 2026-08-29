import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildConversationChatRequestBody } from '@/utils/chat-api'

describe('buildConversationChatRequestBody', () => {
  it('contains only the conversation action, never connection or sampling settings', () => {
    const body = buildConversationChatRequestBody('c1234567', {
      userText: 'hello',
      promptTrigger: 'normal',
      speakerQueue: ['char-1'],
    })

    assert.deepEqual(body, {
      conversationId: 'c1234567',
      userText: 'hello',
      promptTrigger: 'normal',
      speakerQueue: ['char-1'],
    })
    for (const forbidden of [
      'apiPresetId',
      'apiKey',
      'apiKeyId',
      'baseUrl',
      'model',
      'stream',
      'temperature',
      'customParams',
    ]) {
      assert.equal(forbidden in body, false)
    }
  })
})
