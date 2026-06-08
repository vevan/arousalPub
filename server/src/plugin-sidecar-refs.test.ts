import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeSidecarConfigIds,
  normalizeSidecarEntryIds,
} from './plugin-sidecar-refs.js'

describe('normalizeSidecarEntryIds', () => {
  it('trims keys and values; skips invalid entries', () => {
    assert.deepEqual(
      normalizeSidecarEntryIds({
        ' cfg ': ' entry-1 ',
        bad: 1,
        '': 'x',
      }),
      { cfg: 'entry-1' },
    )
  })

  it('returns empty for non-objects', () => {
    assert.deepEqual(normalizeSidecarEntryIds(null), {})
    assert.deepEqual(normalizeSidecarEntryIds([]), {})
  })
})

describe('normalizeSidecarConfigIds', () => {
  it('trims and filters string ids', () => {
    assert.deepEqual(
      normalizeSidecarConfigIds([' a ', '', 2, 'b']),
      ['a', 'b'],
    )
  })
})
