import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampToolMaxCallsPerTurn,
  defaultMaxCallsForPhase,
  isToolCallBudgetExhausted,
  resolveToolMaxCallsPerTurn,
} from '../src/agent/agent-tool-budget.js'
import {
  CORE_LORE_SEARCH_TOOL,
  CORE_MEMORY_SEARCH_TOOL,
} from '../src/agent/host-search-tools.js'

describe('agent-tool-budget', () => {
  it('defaults read=1 write=Infinity', () => {
    assert.equal(defaultMaxCallsForPhase('read'), 1)
    assert.equal(defaultMaxCallsForPhase(undefined), 1)
    assert.equal(defaultMaxCallsForPhase('write'), Number.POSITIVE_INFINITY)
  })

  it('core search tools are max 1', () => {
    assert.equal(
      resolveToolMaxCallsPerTurn({ name: CORE_LORE_SEARCH_TOOL, phase: 'read' }),
      1,
    )
    assert.equal(
      resolveToolMaxCallsPerTurn({
        name: CORE_MEMORY_SEARCH_TOOL,
        phase: 'read',
      }),
      1,
    )
  })

  it('manifest maxCallsPerTurn overrides', () => {
    assert.equal(
      resolveToolMaxCallsPerTurn({
        name: 'trace_read',
        phase: 'read',
        manifestMaxCallsPerTurn: 2,
      }),
      2,
    )
    assert.equal(clampToolMaxCallsPerTurn(0), undefined)
    assert.equal(clampToolMaxCallsPerTurn(100), 32)
  })

  it('exhausted after successful calls reach max', () => {
    assert.equal(isToolCallBudgetExhausted(1, 0), false)
    assert.equal(isToolCallBudgetExhausted(1, 1), true)
    assert.equal(isToolCallBudgetExhausted(Number.POSITIVE_INFINITY, 99), false)
  })
})
