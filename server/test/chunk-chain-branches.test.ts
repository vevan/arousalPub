import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyForkReceiveOverlay,
  parseBranchRegistryForkMessageId,
  parseBranchRegistryPath,
} from '../src/chunk-chain.js'
import type { TurnRecord } from '../src/chat-storage.js'

describe('parseBranchRegistryPath', () => {
  it('reads path from branch registry entry', () => {
    assert.equal(
      parseBranchRegistryPath({ path: 'branch1', forkTurnId: 'abc' }),
      'branch1',
    )
    assert.equal(parseBranchRegistryPath({ path: ' branch1/nested ' }), 'branch1/nested')
  })

  it('returns null for invalid entries', () => {
    assert.equal(parseBranchRegistryPath(null), null)
    assert.equal(parseBranchRegistryPath({}), null)
    assert.equal(parseBranchRegistryPath({ path: '' }), null)
    assert.equal(parseBranchRegistryPath({ path: '..' }), null)
  })
})

describe('parseBranchRegistryForkMessageId', () => {
  it('reads trimmed forkMessageId', () => {
    assert.equal(
      parseBranchRegistryForkMessageId({ forkMessageId: ' ab12cd34 ' }),
      'ab12cd34',
    )
  })

  it('returns null when missing or blank', () => {
    assert.equal(parseBranchRegistryForkMessageId(null), null)
    assert.equal(parseBranchRegistryForkMessageId({}), null)
    assert.equal(parseBranchRegistryForkMessageId({ forkMessageId: '  ' }), null)
  })
})

function turnWithSwipes(params: {
  turnId: string
  activeReceiveIndex: number
  receives: { id: string; content: string }[]
}): TurnRecord {
  return {
    turnId: params.turnId,
    turnOrdinal: 1,
    send: { userText: 'u' },
    plugins: [],
    activeSegmentIndex: 0,
    speakerCharacterId: 'char0001',
    segments: [
      {
        id: 'seg00001',
        speakerCharacterId: 'char0001',
        receives: params.receives.map((r) => ({ id: r.id, content: r.content })),
        activeReceiveIndex: params.activeReceiveIndex,
      },
    ],
  }
}

describe('applyForkReceiveOverlay', () => {
  it('clones fork turn and points activeReceiveIndex at forkMessageId', () => {
    const fork = turnWithSwipes({
      turnId: 'turn0001',
      activeReceiveIndex: 0,
      receives: [
        { id: 'recv0001', content: 'first' },
        { id: 'recv0002', content: 'second' },
      ],
    })
    const earlier = turnWithSwipes({
      turnId: 'turn0000',
      activeReceiveIndex: 0,
      receives: [{ id: 'recv0000', content: 'earlier' }],
    })
    earlier.turnOrdinal = 0

    const merged = applyForkReceiveOverlay(
      [earlier, fork],
      'turn0001',
      'recv0002',
    )
    assert.equal(merged[0], earlier)
    assert.notEqual(merged[1], fork)
    assert.equal(merged[1]!.segments[0]!.activeReceiveIndex, 1)
    assert.equal(merged[1]!.activeSegmentIndex, 0)
    assert.equal(merged[1]!.speakerCharacterId, 'char0001')
    assert.equal(fork.segments[0]!.activeReceiveIndex, 0)
  })

  it('syncs speakerCharacterId when overlay targets another segment', () => {
    const fork: TurnRecord = {
      turnId: 'turn0001',
      turnOrdinal: 1,
      send: { userText: 'u' },
      plugins: [],
      activeSegmentIndex: 0,
      speakerCharacterId: 'char000a',
      segments: [
        {
          id: 'seg0000a',
          speakerCharacterId: 'char000a',
          receives: [{ id: 'recv000a', content: 'a' }],
          activeReceiveIndex: 0,
        },
        {
          id: 'seg0000b',
          speakerCharacterId: 'char000b',
          receives: [
            { id: 'recv000b', content: 'b0' },
            { id: 'recv000c', content: 'b1' },
          ],
          activeReceiveIndex: 0,
        },
      ],
    }
    const merged = applyForkReceiveOverlay([fork], 'turn0001', 'recv000c')
    assert.equal(merged[0]!.activeSegmentIndex, 1)
    assert.equal(merged[0]!.segments[1]!.activeReceiveIndex, 1)
    assert.equal(merged[0]!.speakerCharacterId, 'char000b')
    assert.equal(fork.activeSegmentIndex, 0)
    assert.equal(fork.speakerCharacterId, 'char000a')
  })

  it('no-ops when receive id missing or already active', () => {
    const fork = turnWithSwipes({
      turnId: 'turn0001',
      activeReceiveIndex: 1,
      receives: [
        { id: 'recv0001', content: 'first' },
        { id: 'recv0002', content: 'second' },
      ],
    })
    const same = applyForkReceiveOverlay([fork], 'turn0001', 'recv0002')
    assert.equal(same[0], fork)

    const missing = applyForkReceiveOverlay([fork], 'turn0001', 'nope0000')
    assert.equal(missing[0], fork)
  })
})
