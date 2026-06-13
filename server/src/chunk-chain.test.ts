import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chunkFileNameForRange,
  computeBeforeOrdinalReadRange,
  computeHeadTailFromLinks,
  computeTailOrdinalReadRange,
  inferTurnsPerFileFromFileName,
  ordinalRangeForNewChunk,
} from './chunk-chain.js'

describe('chunkFileNameForRange', () => {
  it('formats zero-based range', () => {
    assert.equal(
      chunkFileNameForRange(0, 99),
      'turn-000000-000099.json',
    )
    assert.equal(
      chunkFileNameForRange(100, 199),
      'turn-000100-000199.json',
    )
  })
})

describe('ordinalRangeForNewChunk', () => {
  it('uses turnsPerFile cap', () => {
    assert.deepEqual(ordinalRangeForNewChunk(0, 100), { start: 0, end: 99 })
    assert.deepEqual(ordinalRangeForNewChunk(100, 50), { start: 100, end: 149 })
  })
})

describe('inferTurnsPerFileFromFileName', () => {
  it('parses span from filename', () => {
    assert.equal(
      inferTurnsPerFileFromFileName('turn-000000-000099.json'),
      100,
    )
    assert.equal(inferTurnsPerFileFromFileName('not-a-chunk.json'), null)
  })
})

describe('computeTailOrdinalReadRange', () => {
  it('covers last N ordinals', () => {
    assert.deepEqual(computeTailOrdinalReadRange(99, 16), {
      from: 84,
      to: 99,
      hasMoreBefore: true,
    })
    assert.deepEqual(computeTailOrdinalReadRange(5, 20), {
      from: 0,
      to: 5,
      hasMoreBefore: false,
    })
  })
})

describe('computeBeforeOrdinalReadRange', () => {
  it('loads turns immediately before the anchor', () => {
    assert.deepEqual(computeBeforeOrdinalReadRange(50, 30), {
      from: 20,
      to: 49,
      hasMoreBefore: true,
    })
    assert.deepEqual(computeBeforeOrdinalReadRange(5, 30), {
      from: 0,
      to: 4,
      hasMoreBefore: false,
    })
    assert.deepEqual(computeBeforeOrdinalReadRange(0, 30), {
      from: 0,
      to: -1,
      hasMoreBefore: false,
    })
  })
})

describe('computeHeadTailFromLinks', () => {
  it('finds head/tail on linear chain', () => {
    const graph = new Map([
      ['turn-000000-000099.json', { previous: null, next: 'turn-000100-000199.json' }],
      ['turn-000100-000199.json', { previous: 'turn-000000-000099.json', next: null }],
    ])
    const r = computeHeadTailFromLinks(graph)
    assert.equal(r.broken, false)
    assert.equal(r.head, 'turn-000000-000099.json')
    assert.equal(r.tail, 'turn-000100-000199.json')
  })

  it('single chunk head equals tail', () => {
    const graph = new Map([
      ['turn-000000-000099.json', { previous: null, next: null }],
    ])
    const r = computeHeadTailFromLinks(graph)
    assert.equal(r.broken, false)
    assert.equal(r.head, r.tail)
  })

  it('detects broken chain', () => {
    const graph = new Map([
      ['a.json', { previous: null, next: null }],
      ['b.json', { previous: null, next: null }],
    ])
    const r = computeHeadTailFromLinks(graph)
    assert.equal(r.broken, true)
  })
})
