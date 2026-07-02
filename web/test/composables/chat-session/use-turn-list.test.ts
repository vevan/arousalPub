import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPendingUserTurnItem,
  collectUsedIdsFromTurns,
  mergeFinalizedPendingTurn,
} from '../../../src/composables/chat-session/turn-pending-record.js'
import { getTurnSegments } from '../../../src/utils/group-chat-turn.js'

describe('turn-pending-record', () => {
  it('buildPendingUserTurnItem creates one empty segment', () => {
    const turn = buildPendingUserTurnItem('hello', 2, collectUsedIdsFromTurns([]))
    const segments = getTurnSegments(turn)
    assert.equal(segments.length, 1)
    assert.equal(segments[0]!.receives.length, 0)
    assert.equal(turn.activeSegmentIndex, 0)
  })

  it('mergeFinalizedPendingTurn preserves pending segment id', () => {
    const pending = buildPendingUserTurnItem('hello', 1, collectUsedIdsFromTurns([]))
    const pendingSegmentId = getTurnSegments(pending)[0]!.id
    const finalized = mergeFinalizedPendingTurn(pending, { id: 'recv-a', content: 'reply' })
    assert.equal(getTurnSegments(finalized)[0]!.id, pendingSegmentId)
    assert.equal(getTurnSegments(finalized)[0]!.receives[0]!.content, 'reply')
  })
})
