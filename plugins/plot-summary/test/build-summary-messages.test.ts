import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSummaryCompleteMessages } from '../src/shared/build-summary-messages.js'

describe('buildSummaryCompleteMessages', () => {
  it('orders reference, history, then instruction at the end', () => {
    assert.deepEqual(
      buildSummaryCompleteMessages(
        '<previous-summaries readonly>\nold\n</previous-summaries>',
        '<history>\nnew\n</history>',
        'Summarize as JSON.',
      ),
      [
        {
          role: 'system',
          content: '<previous-summaries readonly>\nold\n</previous-summaries>',
        },
        { role: 'user', content: '<history>\nnew\n</history>' },
        { role: 'system', content: 'Summarize as JSON.' },
      ],
    )
  })

  it('omits empty parts', () => {
    assert.deepEqual(
      buildSummaryCompleteMessages('', '<history>\nx</history>', 'Go'),
      [
        { role: 'user', content: '<history>\nx</history>' },
        { role: 'system', content: 'Go' },
      ],
    )
  })
})
