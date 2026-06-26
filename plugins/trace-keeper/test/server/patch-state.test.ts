import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STATE_BYTES } from '../../src/constants.js'
import { normalizePatchState } from '../../src/parse-block.js'

describe('normalizePatchState', () => {
  it('accepts plain object', () => {
    assert.deepEqual(normalizePatchState({ mood: 'calm' }), { mood: 'calm' })
  })

  it('accepts valid json string', () => {
    assert.deepEqual(normalizePatchState('{"x":1}'), { x: 1 })
  })

  it('rejects invalid json string', () => {
    assert.equal(normalizePatchState('{bad}'), null)
  })

  it('rejects array root', () => {
    assert.equal(normalizePatchState([1]), null)
  })

  it('rejects oversized object', () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(MAX_STATE_BYTES) })
    assert.equal(normalizePatchState(huge), null)
  })
})
