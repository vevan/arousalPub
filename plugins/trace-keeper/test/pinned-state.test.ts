import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearPinnedView,
  getPinnedView,
  setPinnedView,
  syncActiveConversation,
} from '../src/state.js'

describe('trace-keeper pinned state', () => {
  it('syncActiveConversation clears pin when conversation id changes', () => {
    setPinnedView('conv-a', { turnOrdinal: 2, segmentIndex: 0 })
    assert.ok(getPinnedView('conv-a'))

    assert.equal(syncActiveConversation('conv-a'), false)
    assert.ok(getPinnedView('conv-a'))

    assert.equal(syncActiveConversation('conv-b'), true)
    assert.equal(getPinnedView('conv-a'), null)
    assert.equal(getPinnedView('conv-b'), null)
  })

  it('clearPinnedView removes pin for any conversation', () => {
    setPinnedView('conv-a', { turnOrdinal: 1, segmentIndex: 0 })
    clearPinnedView()
    assert.equal(getPinnedView('conv-a'), null)
  })
})
