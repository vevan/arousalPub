import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isAssistantSegmentLoading,
  isAssistantSwipeFooterVisible,
  isTurnAwaitingAssistantSegment,
  isTurnRegeneratingAssistantSegment,
} from '../../../src/composables/chat-session/turn-segment-match.js'
import type { ChatTurnItem } from '../../../src/types/chat-turn.js'

const baseTurn: ChatTurnItem = {
  user: 'hi',
  receives: [{ id: 'r0', content: 'done' }],
  activeReceiveIndex: 0,
  turnOrdinal: 1,
  segments: [
    {
      id: 'seg0',
      speakerCharacterId: 'char-a',
      receives: [{ id: 'r0', content: 'done' }],
      activeReceiveIndex: 0,
    },
    {
      id: 'seg1',
      speakerCharacterId: 'char-b',
      receives: [],
      activeReceiveIndex: 0,
    },
  ],
  activeSegmentIndex: 1,
}

describe('turn-segment-match pending', () => {
  it('matches segment 0 when pendingSendSegmentIndex is 0', () => {
    assert.equal(isTurnAwaitingAssistantSegment(1, 1, 0, 0), true)
    assert.equal(isTurnAwaitingAssistantSegment(1, 1, 0, 1), false)
  })

  it('matches any segment when segmentIndex is omitted', () => {
    assert.equal(isTurnAwaitingAssistantSegment(1, 1, 1), true)
  })
})

describe('turn-segment-match regenerate', () => {
  it('matches regeneratingSegmentIndex 0', () => {
    assert.equal(isTurnRegeneratingAssistantSegment(1, 1, 0, 0), true)
    assert.equal(isTurnRegeneratingAssistantSegment(1, 1, 0, 1), false)
  })

  it('isAssistantSegmentLoading without segmentIndex matches regenerating turn', () => {
    assert.equal(
      isAssistantSegmentLoading(baseTurn, null, null, 1, 1),
      true,
    )
  })
})

describe('turn-segment-match swipe footer', () => {
  it('allows completed segment swipe while another segment is pending', () => {
    assert.equal(
      isAssistantSwipeFooterVisible({
        segmentLoading: false,
        listIndex: 0,
        lastListIndex: 0,
        receivesLength: 1,
        isEditingThisSegment: false,
      }),
      true,
    )
    assert.equal(
      isAssistantSwipeFooterVisible({
        segmentLoading: true,
        listIndex: 0,
        lastListIndex: 0,
        receivesLength: 0,
        isEditingThisSegment: false,
      }),
      false,
    )
  })
})
