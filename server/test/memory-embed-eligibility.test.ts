import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import { testTurn } from './fixtures/turn-record.js'
import { isTurnEligibleForMemoryEmbed } from '../src/memory-index.js'

function turn(partial: Partial<TurnRecord> & Pick<TurnRecord, 'turnId'>): TurnRecord {
  const receives = partial.receives ?? []
  return testTurn({
    turnId: partial.turnId,
    turnOrdinal: partial.turnOrdinal ?? 0,
    userText: partial.send?.userText ?? '',
    receives,
    activeReceiveIndex: partial.activeReceiveIndex ?? 0,
    segments: partial.segments,
    activeSegmentIndex: partial.activeSegmentIndex,
    plugins: partial.plugins,
  })
}

describe('isTurnEligibleForMemoryEmbed', () => {
  it('rejects empty corpus', () => {
    assert.equal(
      isTurnEligibleForMemoryEmbed(
        turn({
          turnId: 't1',
          send: { userText: '   ' },
          receives: [{ id: 'r1', content: '' }],
        }),
      ),
      false,
    )
  })

  it('accepts user or assistant text', () => {
    assert.equal(
      isTurnEligibleForMemoryEmbed(
        turn({
          turnId: 't2',
          send: { userText: 'hello' },
          receives: [{ id: 'r1', content: '' }],
        }),
      ),
      true,
    )
    assert.equal(
      isTurnEligibleForMemoryEmbed(
        turn({
          turnId: 't3',
          send: { userText: '' },
          receives: [{ id: 'r1', content: 'reply' }],
        }),
      ),
      true,
    )
  })
})
