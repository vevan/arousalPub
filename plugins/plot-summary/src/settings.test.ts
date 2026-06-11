import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manualSummarizeDefaultRange } from './settings.js'
import type { MergedSettings } from './types.js'

function baseSettings(overrides: Partial<MergedSettings> = {}): MergedSettings {
  return {
    blockTurns: 15,
    bufferTurns: 5,
    nextBlockStart: 78,
    autoSummarizeEnabled: false,
    sidecars: [],
    manualSummarizeTasks: ['memory'],
    ...overrides,
  } as MergedSettings
}

describe('manualSummarizeDefaultRange', () => {
  it('uses preset when range picker supplies one', () => {
    assert.deepEqual(
      manualSummarizeDefaultRange(baseSettings(), { startTurn: 10, endTurn: 20 }, 100),
      { startTurn: 10, endTurn: 20 },
    )
  })

  it('anchors from current turn minus buffer and block size', () => {
    assert.deepEqual(manualSummarizeDefaultRange(baseSettings(), undefined, 95), {
      startTurn: 75,
      endTurn: 90,
    })
  })

  it('ignores nextBlockStart for default prefill', () => {
    assert.deepEqual(
      manualSummarizeDefaultRange(baseSettings({ nextBlockStart: 91 }), undefined, 95),
      { startTurn: 75, endTurn: 90 },
    )
  })

  it('clamps start at 0 for short conversations', () => {
    assert.deepEqual(manualSummarizeDefaultRange(baseSettings(), undefined, 10), {
      startTurn: 0,
      endTurn: 5,
    })
  })
})
