import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeAutoSummarizeProgress,
  normalizedNextBlockStart,
} from '../../src/utils/plugin-auto-summarize-progress.js'

describe('normalizedNextBlockStart', () => {
  it('keeps start when no prior summary', () => {
    assert.equal(normalizedNextBlockStart(0, null), 0)
    assert.equal(normalizedNextBlockStart(5, undefined), 5)
  })

  it('never falls behind lastSummarizedEnd + 1', () => {
    assert.equal(normalizedNextBlockStart(78, 90), 91)
    assert.equal(normalizedNextBlockStart(95, 90), 95)
  })
})

describe('computeAutoSummarizeProgress', () => {
  it('shows corrected pending range when pointers drift', () => {
    const view = computeAutoSummarizeProgress(
      {
        autoSummarizeEnabled: true,
        lastSummarizedEnd: 90,
        nextBlockStart: 78,
        blockTurns: 15,
        bufferTurns: 3,
      },
      {},
    )
    assert.equal(view.nextBlockStart, 91)
    assert.equal(view.pendingFromTurn, 91)
    assert.equal(view.pendingToTurn, 105)
    assert.equal(view.nextTriggerTurn, 108)
  })
})
