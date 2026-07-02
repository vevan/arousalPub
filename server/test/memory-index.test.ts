import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import { testTurn } from './fixtures/turn-record.js'
import { filterEmbeddableTurns } from '../src/memory-index.js'

function turn(partial: Partial<TurnRecord> & Pick<TurnRecord, 'turnId'>): TurnRecord {
  const receives =
    partial.receives ?? [{ id: 'r1', content: 'reply', model: 'm', createdAt: '' }]
  return testTurn({
    turnId: partial.turnId,
    turnOrdinal: partial.turnOrdinal ?? 0,
    userText: partial.send?.userText ?? 'hello',
    receives,
    activeReceiveIndex: partial.activeReceiveIndex ?? 0,
    segments: partial.segments,
    activeSegmentIndex: partial.activeSegmentIndex,
    plugins: partial.plugins,
  })
}

describe('filterEmbeddableTurns', () => {
  it('keeps turns with user or assistant text', () => {
    const kept = filterEmbeddableTurns([turn({ turnId: 'a1' })])
    assert.equal(kept.length, 1)
    assert.equal(kept[0]?.turnId, 'a1')
  })

  it('drops turns with empty corpus', () => {
    const empty = turn({
      turnId: 'empty',
      send: { userText: '   ' },
      receives: [],
    })
    assert.equal(filterEmbeddableTurns([empty]).length, 0)
  })
})
