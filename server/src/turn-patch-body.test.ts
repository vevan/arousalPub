import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTurnPatchBody } from './turn-patch-body.js'

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
