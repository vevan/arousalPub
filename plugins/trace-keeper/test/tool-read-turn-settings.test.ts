import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeToolReadTurnCount,
  resolveToolReadTurnCount,
  TOOL_READ_TURN_COUNT_DEFAULT,
} from '../src/tool-read-turn-settings.js'

describe('toolReadTurnCount', () => {
  it('clamps to 1..40', () => {
    assert.equal(normalizeToolReadTurnCount(0), 1)
    assert.equal(normalizeToolReadTurnCount(8), 8)
    assert.equal(normalizeToolReadTurnCount(99), 40)
    assert.equal(normalizeToolReadTurnCount(''), TOOL_READ_TURN_COUNT_DEFAULT)
  })

  it('prefers conversation over user', () => {
    assert.equal(
      resolveToolReadTurnCount({ toolReadTurnCount: 3 }, { toolReadTurnCount: 12 }),
      12,
    )
    assert.equal(resolveToolReadTurnCount({ toolReadTurnCount: 5 }, {}), 5)
    assert.equal(resolveToolReadTurnCount({}, {}), TOOL_READ_TURN_COUNT_DEFAULT)
  })
})
