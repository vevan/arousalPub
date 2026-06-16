import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildTrackerSystemPrompt } from './tracker-prompt.js'
import type { TraceBundle } from './constants.js'

const SAMPLE_BUNDLE: TraceBundle = {
  id: 'test',
  label: 'test',
  sampleState: { scene: { location: 'sample' } },
  template: '<div></div>',
  stylesheet: '',
}

describe('buildTrackerSystemPrompt', () => {
  it('uses sample only when no live states', () => {
    const text = buildTrackerSystemPrompt(SAMPLE_BUNDLE, [])
    assert.match(text, /sample structure/)
    assert.match(text, /current live state/)
    assert.doesNotMatch(text, /live state history/)
  })

  it('labels history when multiple live states', () => {
    const text = buildTrackerSystemPrompt(SAMPLE_BUNDLE, [
      { turnOrdinal: 2, state: { scene: { location: 'A' } } },
      { turnOrdinal: 4, state: { scene: { location: 'B' } } },
    ])
    assert.match(text, /live state history/)
    assert.match(text, /turn 2/)
    assert.match(text, /turn 4/)
  })
})
