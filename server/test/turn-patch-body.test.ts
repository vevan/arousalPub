import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isActiveReceiveIndexOnlyPatchChange,
  parseTurnPatchBody,
  shouldSkipPersistRegexForTurnPatch,
  turnContentPatchChanged,
} from '../src/turn-patch-body.js'

describe('parseTurnPatchBody', () => {
  it('parses valid patch', () => {
    const r = parseTurnPatchBody({
      turnOrdinal: 3,
      userText: 'hi',
      receives: [{ id: 'r1', content: 'ok' }],
      activeReceiveIndex: 0,
    })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.patch.turnOrdinal, 3)
    assert.equal(r.patch.userText, 'hi')
    assert.equal(r.patch.receives.length, 1)
  })

  it('rejects empty receives', () => {
    const r = parseTurnPatchBody({
      turnOrdinal: 0,
      userText: 'x',
      receives: [],
      activeReceiveIndex: 0,
    })
    assert.equal(r.ok, false)
  })

  it('rejects invalid ordinal', () => {
    const r = parseTurnPatchBody({
      turnOrdinal: -1,
      userText: 'x',
      receives: [{ id: 'a', content: 'b' }],
      activeReceiveIndex: 0,
    })
    assert.equal(r.ok, false)
  })
})

describe('isActiveReceiveIndexOnlyPatchChange', () => {
  const base = {
    turnOrdinal: 2,
    userText: 'u',
    receives: [
      { id: 'a', content: 'one' },
      { id: 'b', content: 'two' },
    ],
    activeReceiveIndex: 0,
  }

  it('detects swipe-only index change', () => {
    assert.equal(
      isActiveReceiveIndexOnlyPatchChange(base, {
        ...base,
        activeReceiveIndex: 1,
      }),
      true,
    )
  })

  it('returns false when content changes', () => {
    assert.equal(
      isActiveReceiveIndexOnlyPatchChange(base, {
        ...base,
        activeReceiveIndex: 1,
        receives: [
          { id: 'a', content: 'one' },
          { id: 'b', content: 'edited' },
        ],
      }),
      false,
    )
  })

  it('returns false when index unchanged', () => {
    assert.equal(
      isActiveReceiveIndexOnlyPatchChange(base, { ...base }),
      false,
    )
    assert.equal(turnContentPatchChanged(base, { ...base }), false)
  })
})

describe('shouldSkipPersistRegexForTurnPatch', () => {
  const base = {
    turnOrdinal: 2,
    userText: 'u',
    receives: [{ id: 'a', content: 'one' }],
    activeReceiveIndex: 0,
  }

  it('skips when body matches disk including index', () => {
    assert.equal(shouldSkipPersistRegexForTurnPatch(base, { ...base }), true)
  })

  it('skips when body matches disk but index differs (swipe)', () => {
    assert.equal(
      shouldSkipPersistRegexForTurnPatch(
        { ...base, activeReceiveIndex: 0 },
        { ...base, activeReceiveIndex: 1, receives: [{ id: 'a', content: 'one' }, { id: 'b', content: 'two' }] },
      ),
      false,
    )
    const twoReceives = {
      ...base,
      receives: [
        { id: 'a', content: 'one' },
        { id: 'b', content: 'two' },
      ],
    }
    assert.equal(
      shouldSkipPersistRegexForTurnPatch(
        { ...twoReceives, activeReceiveIndex: 0 },
        { ...twoReceives, activeReceiveIndex: 1 },
      ),
      true,
    )
  })

  it('does not skip when content differs', () => {
    assert.equal(
      shouldSkipPersistRegexForTurnPatch(base, {
        ...base,
        userText: 'edited',
      }),
      false,
    )
  })
})
