import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeMacroVarMapsForPersist } from './macro-vars-persist.js'

describe('mergeMacroVarMapsForPersist', () => {
  it('merges only touched keys onto disk snapshot', () => {
    const merged = mergeMacroVarMapsForPersist(
      { a: '1', b: '2' },
      { a: '9', b: 'ignored', c: '3' },
      new Set(['a', 'c']),
    )
    assert.deepEqual(merged, { a: '9', b: '2', c: '3' })
  })

  it('replaces entire map when no touched set', () => {
    const merged = mergeMacroVarMapsForPersist(
      { a: '1' },
      { b: '2' },
      undefined,
    )
    assert.deepEqual(merged, { a: '1', b: '2' })
  })
})
