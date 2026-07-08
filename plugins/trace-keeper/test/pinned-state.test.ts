import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearPinnedView,
  clearPinIfLiveTailAdvanced,
  getPinnedView,
  resetPinnedStateForTest,
  setPinnedView,
  syncActiveConversation,
} from '../src/state.js'

describe('trace-keeper pinned state', () => {
  it('syncActiveConversation clears pin when conversation id changes', () => {
    resetPinnedStateForTest()
    syncActiveConversation('conv-a')
    setPinnedView('conv-a', { turnOrdinal: 2, segmentIndex: 0 })
    assert.ok(getPinnedView('conv-a'))

    assert.equal(syncActiveConversation('conv-a'), false)
    assert.ok(getPinnedView('conv-a'))

    assert.equal(syncActiveConversation('conv-b'), true)
    assert.equal(getPinnedView('conv-a'), null)
    assert.equal(getPinnedView('conv-b'), null)
  })

  it('clearPinIfLiveTailAdvanced clears pin when new turn arrives in same conversation', () => {
    resetPinnedStateForTest()
    syncActiveConversation('conv-a')
    setPinnedView('conv-a', { turnOrdinal: 1, segmentIndex: 0 })

    assert.equal(
      clearPinIfLiveTailAdvanced('conv-a', {
        turnOrdinal: 1,
        segmentIndex: 0,
        fingerprint: 'a:10:1:0',
      }),
      false,
    )
    assert.ok(getPinnedView('conv-a'))

    assert.equal(
      clearPinIfLiveTailAdvanced('conv-a', {
        turnOrdinal: 2,
        segmentIndex: 0,
        fingerprint: 'b:5:1:0',
      }),
      true,
    )
    assert.equal(getPinnedView('conv-a'), null)
  })

  it('clearPinIfLiveTailAdvanced clears pin when new segment receive on same turn', () => {
    resetPinnedStateForTest()
    syncActiveConversation('conv-a')
    setPinnedView('conv-a', { turnOrdinal: 2, segmentIndex: 0 })

    clearPinIfLiveTailAdvanced('conv-a', {
      turnOrdinal: 2,
      segmentIndex: 0,
      fingerprint: 'r0:10:1:0',
    })

    assert.equal(
      clearPinIfLiveTailAdvanced('conv-a', {
        turnOrdinal: 2,
        segmentIndex: 1,
        fingerprint: 'r0:10:1:0|r1:8:1:0',
      }),
      true,
    )
    assert.equal(getPinnedView('conv-a'), null)
  })

  it('does not clear pin when only an older turn is edited', () => {
    resetPinnedStateForTest()
    syncActiveConversation('conv-a')
    setPinnedView('conv-a', { turnOrdinal: 1, segmentIndex: 0 })

    clearPinIfLiveTailAdvanced('conv-a', {
      turnOrdinal: 3,
      segmentIndex: 0,
      fingerprint: 'tail:20:1:0',
    })

    assert.equal(
      clearPinIfLiveTailAdvanced('conv-a', {
        turnOrdinal: 3,
        segmentIndex: 0,
        fingerprint: 'tail:20:1:0',
      }),
      false,
    )
    assert.ok(getPinnedView('conv-a'))
  })

  it('clearPinnedView removes pin for any conversation', () => {
    resetPinnedStateForTest()
    setPinnedView('conv-a', { turnOrdinal: 1, segmentIndex: 0 })
    clearPinnedView()
    assert.equal(getPinnedView('conv-a'), null)
  })
})
