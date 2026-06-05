import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from './chat-storage.js'
import {
  memoryTokenBudget,
  trimMemoryItemsByTokenBudget,
} from './memory-token-trim.js'

function turn(id: string, ordinal: number, text: string): TurnRecord {
  return {
    turnId: id,
    turnOrdinal: ordinal,
    send: { userText: text },
    receives: [{ id: `r-${id}`, content: 'ok' }],
    activeReceiveIndex: 0,
    plugins: [],
  }
}

describe('memoryTokenBudget', () => {
  it('caps fraction of context', () => {
    assert.equal(memoryTokenBudget(8192), 1474)
    assert.equal(memoryTokenBudget(4096), 737)
  })
})

describe('trimMemoryItemsByTokenBudget', () => {
  it('drops lowest score items first', () => {
    const items = [
      { turn: turn('a', 1, 'short'), score: 0.9 },
      { turn: turn('b', 2, 'x'.repeat(4000)), score: 0.1 },
    ]
    const r = trimMemoryItemsByTokenBudget(items, 200)
    assert.equal(r.droppedMemoryCount, 1)
    assert.equal(r.memoryTurnIds.length, 1)
    assert.equal(r.memoryTurnIds[0], 'a')
  })
})
