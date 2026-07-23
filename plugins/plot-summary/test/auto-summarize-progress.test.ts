import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAutoSummarizePointerResetPatch,
  computeAutoSummarizeProgress,
  normalizedNextBlockStart,
} from '../src/auto-summarize-progress.js'
import { normalizedNextBlockStart as settingsNormalized } from '../src/settings.js'

describe('normalizedNextBlockStart (progress util)', () => {
  it('aligns with settings helper', () => {
    assert.equal(normalizedNextBlockStart(78, 90), settingsNormalized(78, 90))
    assert.equal(normalizedNextBlockStart(0, undefined), 0)
  })
})

describe('buildAutoSummarizePointerResetPatch', () => {
  it('clears turn pointers and optional memo', () => {
    assert.deepEqual(buildAutoSummarizePointerResetPatch(null, null), {
      lastSummarizedEnd: null,
      nextBlockStart: 0,
      lastTriggeredTurnOrdinal: null,
      lastMemoIndex: null,
    })
  })

  it('advances nextBlockStart and sets memo', () => {
    assert.deepEqual(buildAutoSummarizePointerResetPatch(10, 3), {
      lastSummarizedEnd: 10,
      nextBlockStart: 11,
      lastTriggeredTurnOrdinal: null,
      lastMemoIndex: 3,
    })
  })

  it('omits memo key when memo arg omitted', () => {
    const patch = buildAutoSummarizePointerResetPatch(4)
    assert.equal(patch.lastSummarizedEnd, 4)
    assert.equal(patch.nextBlockStart, 5)
    assert.equal('lastMemoIndex' in patch, false)
  })
})

describe('computeAutoSummarizeProgress', () => {
  it('corrects drifted nextBlockStart', () => {
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
