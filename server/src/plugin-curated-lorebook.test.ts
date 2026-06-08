import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LorebookEntry } from './lorebook-types.js'
import {
  buildContextHistoryBlock,
  buildHistoryBlock,
  buildPreviousSummariesBlock,
  buildSidecarsBlock,
  classifyCuratedEntry,
  computeCuratedEntryOrders,
  parseTurnRangeSuffix,
  pickRecentSummaryEntriesBeforeTurn,
  resolveContextHistoryStart,
  sortCuratedEntriesInGroup,
} from './plugin-curated-lorebook.js'

function entry(
  partial: Partial<LorebookEntry> & Pick<LorebookEntry, 'id' | 'title'>,
): LorebookEntry {
  return {
    groupId: 'g1',
    content: '',
    enabled: true,
    order: 0,
    keys: [],
    constant: false,
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('parseTurnRangeSuffix', () => {
  it('parses trailing from-to suffix', () => {
    assert.deepEqual(parseTurnRangeSuffix('冒险摘要-1-50'), { start: 1, end: 50 })
  })

  it('returns null when suffix missing', () => {
    assert.equal(parseTurnRangeSuffix('plain title'), null)
  })
})

describe('classifyCuratedEntry', () => {
  const sidecarSet = new Set(['sc-1'])

  it('classifies sidecar by entry id set', () => {
    assert.equal(
      classifyCuratedEntry(entry({ id: 'sc-1', title: '角色卡' }), sidecarSet),
      'sidecar',
    )
  })

  it('classifies summary by turn suffix', () => {
    assert.equal(
      classifyCuratedEntry(entry({ id: 'm1', title: '摘要-10-20' }), sidecarSet),
      'summary',
    )
  })

  it('classifies remaining as other', () => {
    assert.equal(
      classifyCuratedEntry(entry({ id: 'x', title: '设定' }), sidecarSet),
      'other',
    )
  })
})

describe('sortCuratedEntriesInGroup', () => {
  const sidecarEntryIds = { cfgA: 'sc-a', cfgB: 'sc-b' }
  const sidecarConfigIds = ['cfgB', 'cfgA']

  it('orders other < sidecar < summary; within kind by rules', () => {
    const sorted = sortCuratedEntriesInGroup(
      [
        entry({ id: 'sum2', title: 'B-20-30', createdAt: '2026-01-03T00:00:00.000Z' }),
        entry({ id: 'oth1', title: '设定', createdAt: '2026-01-02T00:00:00.000Z' }),
        entry({ id: 'sc-a', title: 'Side A' }),
        entry({ id: 'sc-b', title: 'Side B' }),
        entry({ id: 'sum1', title: 'A-1-10', createdAt: '2026-01-04T00:00:00.000Z' }),
      ],
      sidecarEntryIds,
      sidecarConfigIds,
    )
    assert.deepEqual(
      sorted.map((e) => e.id),
      ['oth1', 'sc-b', 'sc-a', 'sum1', 'sum2'],
    )
  })
})

describe('computeCuratedEntryOrders', () => {
  it('assigns per-group order indices', () => {
    const orders = computeCuratedEntryOrders(
      {
        groups: [
          { id: 'g1', name: 'G1', order: 0 },
          { id: 'g2', name: 'G2', order: 1 },
        ],
        entries: [
          entry({ id: 'a', title: 'x-1-2', groupId: 'g1', order: 9 }),
          entry({ id: 'b', title: '设定', groupId: 'g2', order: 3 }),
        ],
      },
      {},
      [],
    )
    assert.equal(orders.get('a'), 0)
    assert.equal(orders.get('b'), 0)
  })
})

describe('buildPreviousSummariesBlock', () => {
  it('returns empty for no entries', () => {
    assert.equal(buildPreviousSummariesBlock([]), '')
  })

  it('wraps entries in previous-summaries block', () => {
    const block = buildPreviousSummariesBlock([
      { title: 'T1', content: 'body' },
    ])
    assert.match(block, /^<previous-summaries readonly>/)
    assert.match(block, /## T1\nbody/)
  })
})

describe('buildSidecarsBlock', () => {
  it('wraps entries in sidecars block', () => {
    const block = buildSidecarsBlock([{ title: 'S', content: 'c' }])
    assert.match(block, /^<sidecars readonly>/)
    assert.match(block, /## S\nc/)
  })
})

describe('buildContextHistoryBlock', () => {
  it('returns empty for blank transcript', () => {
    assert.equal(buildContextHistoryBlock(''), '')
  })

  it('wraps context transcript', () => {
    const block = buildContextHistoryBlock(
      '<user name="{{user}}"><![CDATA[hi]]></user>',
    )
    assert.match(block, /^<context-history readonly>/)
  })
})

describe('buildHistoryBlock', () => {
  it('wraps summary-range transcript', () => {
    const inner = '<user name="{{user}}"><![CDATA[plot]]></user>'
    const block = buildHistoryBlock(inner)
    assert.equal(block, `<history>\n${inner}\n</history>`)
  })
})

describe('pickRecentSummaryEntriesBeforeTurn', () => {
  it('returns last N summaries strictly before fromTurn', () => {
    const sidecarEntryIds = { cfg: 'sc' }
    const sidecarSet = new Set(Object.values(sidecarEntryIds))
    const picked = pickRecentSummaryEntriesBeforeTurn(
      [
        entry({ id: 's1', title: 'A-1-5' }),
        entry({ id: 's2', title: 'B-6-10' }),
        entry({ id: 's3', title: 'C-11-15' }),
        entry({ id: 's4', title: 'D-50-70' }),
        entry({ id: 'sc', title: 'side' }),
      ],
      16,
      sidecarSet,
      2,
      sidecarEntryIds,
      ['cfg'],
    )
    assert.deepEqual(
      picked.map((e) => e.id),
      ['s2', 's3'],
    )
  })
})

describe('resolveContextHistoryStart', () => {
  it('extends backward from fromTurn by N inclusive', () => {
    assert.equal(resolveContextHistoryStart(50, 5), 46)
    assert.equal(resolveContextHistoryStart(0, 8), 0)
    assert.equal(resolveContextHistoryStart(50, 0), 50)
  })
})
