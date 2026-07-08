import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeSeparateTurnCount,
  resolveSeparateTurnCount,
  SEPARATE_TURN_COUNT_DEFAULT,
} from '../src/separate-turn-settings.js'

describe('resolveSeparateTurnCount', () => {
  it('prefers conversation override', () => {
    assert.equal(
      resolveSeparateTurnCount({ separateTurnCount: 3 }, { separateTurnCount: 6 }),
      6,
    )
  })

  it('falls back to user separateTurnCount', () => {
    assert.equal(resolveSeparateTurnCount({ separateTurnCount: 2 }, {}), 2)
  })

  it('defaults when unset', () => {
    assert.equal(resolveSeparateTurnCount({}, {}), SEPARATE_TURN_COUNT_DEFAULT)
  })
})

describe('normalizeSeparateTurnCount', () => {
  it('clamps to 1–8', () => {
    assert.equal(normalizeSeparateTurnCount(0), 1)
    assert.equal(normalizeSeparateTurnCount(99), 8)
  })
})
