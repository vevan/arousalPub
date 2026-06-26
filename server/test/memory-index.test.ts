import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import { filterEmbeddableTurns } from '../src/memory-index.js'

function turn(partial: Partial<TurnRecord> & Pick<TurnRecord, 'turnId'>): TurnRecord {
  return {
    turnOrdinal: 0,
    send: { userText: 'hello' },
    receives: [{ id: 'r1', content: 'reply', model: 'm', createdAt: '' }],
    activeReceiveIndex: 0,
    plugins: [],
    ...partial,
  }
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
