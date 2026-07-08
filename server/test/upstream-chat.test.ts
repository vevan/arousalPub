import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractAssistantContent,
  looksLikeTruncationNotice,
} from '../src/upstream-chat.js'

describe('looksLikeTruncationNotice', () => {
  it('detects wafer truncation placeholder', () => {
    assert.equal(
      looksLikeTruncationNotice(
        '[Wafer: response was truncated before the model finished its internal reasoning.',
      ),
      true,
    )
  })
})

describe('extractAssistantContent', () => {
  it('reads OpenAI message.content string', () => {
    assert.equal(
      extractAssistantContent({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }),
      'ok',
    )
  })

  it('reads multipart content array', () => {
    assert.equal(
      extractAssistantContent({
        choices: [
          {
            message: {
              content: [{ type: 'text', text: 'hello' }],
            },
          },
        ],
      }),
      'hello',
    )
  })

  it('ignores legacy completion text field', () => {
    assert.equal(
      extractAssistantContent({
        choices: [{ text: 'legacy' }],
      }),
      '',
    )
  })
})
