import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEmptyComposerInputHistory,
  pinComposerInputHistoryItem,
  pushComposerInputHistoryOnSend,
  trimComposerInputHistoryToLimits,
  unpinComposerInputHistoryItem,
} from './composer-input-history-storage.js'

describe('pushComposerInputHistoryOnSend', () => {
  it('appends new text to recent tail', () => {
    let h = createEmptyComposerInputHistory()
    h = pushComposerInputHistoryOnSend(h, 'first')
    h = pushComposerInputHistoryOnSend(h, 'second')
    assert.deepEqual(h.recent, ['first', 'second'])
  })

  it('moves duplicate recent entry to tail', () => {
    let h = createEmptyComposerInputHistory()
    h = pushComposerInputHistoryOnSend(h, 'a')
    h = pushComposerInputHistoryOnSend(h, 'b')
    h = pushComposerInputHistoryOnSend(h, 'a')
    assert.deepEqual(h.recent, ['b', 'a'])
  })

  it('moves duplicate pinned entry to pinned tail', () => {
    let h = createEmptyComposerInputHistory()
    h = pushComposerInputHistoryOnSend(h, 'a')
    const pinned = pinComposerInputHistoryItem(h, 'a')
    assert.equal(pinned.ok, true)
    if (!pinned.ok) return
    h = pinned.history
    h = pushComposerInputHistoryOnSend(h, 'b')
    const pinB = pinComposerInputHistoryItem(h, 'b')
    assert.equal(pinB.ok, true)
    if (!pinB.ok) return
    h = pinB.history
    h = pushComposerInputHistoryOnSend(h, 'a')
    assert.deepEqual(h.pinned, ['b', 'a'])
    assert.deepEqual(h.recent, [])
  })

  it('trims recent from head when over max', () => {
    let h = createEmptyComposerInputHistory()
    for (let i = 0; i < 32; i += 1) {
      h = pushComposerInputHistoryOnSend(h, `t${i}`, { recentMax: 3 })
    }
    assert.equal(h.recent.length, 3)
    assert.deepEqual(h.recent, ['t29', 't30', 't31'])
  })
})

describe('pinComposerInputHistoryItem', () => {
  it('moves recent item to pinned tail', () => {
    let h = pushComposerInputHistoryOnSend(
      pushComposerInputHistoryOnSend(createEmptyComposerInputHistory(), 'a'),
      'b',
    )
    const r = pinComposerInputHistoryItem(h, 'a')
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual(r.history.pinned, ['a'])
    assert.deepEqual(r.history.recent, ['b'])
  })

  it('rejects when pinned max reached', () => {
    let h = createEmptyComposerInputHistory()
    for (const t of ['p1', 'p2']) {
      h = pushComposerInputHistoryOnSend(h, t)
      const pr = pinComposerInputHistoryItem(h, t, { pinnedMax: 2 })
      assert.equal(pr.ok, true)
      if (!pr.ok) return
      h = pr.history
    }
    h = pushComposerInputHistoryOnSend(h, 'r1')
    const fail = pinComposerInputHistoryItem(h, 'r1', { pinnedMax: 2 })
    assert.equal(fail.ok, false)
    if (fail.ok) return
    assert.equal(fail.reason, 'pinned_max')
  })
})

describe('unpinComposerInputHistoryItem', () => {
  it('moves pinned item to recent tail', () => {
    let h = pushComposerInputHistoryOnSend(createEmptyComposerInputHistory(), 'x')
    const pr = pinComposerInputHistoryItem(h, 'x')
    assert.equal(pr.ok, true)
    if (!pr.ok) return
    h = unpinComposerInputHistoryItem(pr.history, 'x')
    assert.deepEqual(h.pinned, [])
    assert.deepEqual(h.recent, ['x'])
  })
})

describe('trimComposerInputHistoryToLimits', () => {
  it('trims excess from head keeping tail', () => {
    const h = {
      version: 1 as const,
      pinned: ['p1', 'p2', 'p3'],
      recent: ['r1', 'r2', 'r3', 'r4'],
    }
    const trimmed = trimComposerInputHistoryToLimits(h, {
      pinnedMax: 2,
      recentMax: 2,
    })
    assert.deepEqual(trimmed.pinned, ['p2', 'p3'])
    assert.deepEqual(trimmed.recent, ['r3', 'r4'])
  })
})
