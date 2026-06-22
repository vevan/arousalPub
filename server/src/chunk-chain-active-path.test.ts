import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergeActivePathPrefixSegment,
  parseBranchRegistryForkTurnId,
} from './chunk-chain.js'
import type { TurnRecord } from './chat-storage.js'

function turn(ordinal: number, id: string): TurnRecord {
  return {
    turnId: id,
    turnOrdinal: ordinal,
    send: { userText: `u${ordinal}` },
    receives: [{ id: `r${ordinal}`, content: `a${ordinal}` }],
    activeReceiveIndex: 0,
  }
}

describe('parseBranchRegistryForkTurnId', () => {
  it('reads forkTurnId from registry entry', () => {
    assert.equal(
      parseBranchRegistryForkTurnId({ path: 'branch1', forkTurnId: 'abc123' }),
      'abc123',
    )
    assert.equal(parseBranchRegistryForkTurnId({ path: 'b' }), null)
    assert.equal(parseBranchRegistryForkTurnId(null), null)
  })
})

describe('mergeActivePathPrefixSegment', () => {
  it('adds parent turns through fork inclusive', () => {
    const main = [turn(159, 't159'), turn(160, 'fork160')]
    const step = mergeActivePathPrefixSegment({
      accumulated: [],
      parentBranchTurns: main,
      forkTurnId: 'fork160',
    })
    assert.ok(step)
    assert.equal(step.forkOrdinal, 160)
    assert.deepEqual(
      step.merged.map((t) => t.turnOrdinal),
      [159, 160],
    )
  })

  it('appends branch segment without duplicating shared ids', () => {
    const accumulated = [turn(159, 't159'), turn(160, 'fork160')]
    const branch1Only = [
      turn(161, 't161'),
      turn(165, 'fork165'),
      turn(166, 't166'),
    ]
    const step = mergeActivePathPrefixSegment({
      accumulated,
      parentBranchTurns: branch1Only,
      forkTurnId: 'fork165',
    })
    assert.ok(step)
    assert.equal(step.forkOrdinal, 165)
    assert.deepEqual(
      step.merged.map((t) => t.turnOrdinal),
      [159, 160, 161, 165],
    )
  })

  it('returns null when fork turn missing', () => {
    assert.equal(
      mergeActivePathPrefixSegment({
        accumulated: [],
        parentBranchTurns: [turn(0, 'a')],
        forkTurnId: 'missing',
      }),
      null,
    )
  })
})
