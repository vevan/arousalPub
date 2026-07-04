import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildContextHistoryBlock,
  buildHistoryBlock,
  buildPreviousSummariesBlock,
  buildSidecarsBlock,
  resolveContextHistoryStart,
} from '../../src/plot-summary/prepare-context-blocks.js'
import {
  classifyPlotSummaryEntry,
  computePlotSummaryApplyOrderLayout,
  parseMemoIndex,
  parseTurnRangeSuffix,
  pickRecentSummaryEntriesBeforeTurn,
  sortPlotSummaryEntriesInGroup,
} from '../../src/plot-summary/lorebook-sort.js'

describe('parseTurnRangeSuffix', () => {
  it('parses bracket turn range suffix', () => {
    assert.deepEqual(parseTurnRangeSuffix('[MEMO-1]-冒险-[0-15]'), {
      start: 0,
      end: 15,
    })
  })

  it('parses legacy trailing from-to suffix', () => {
    assert.deepEqual(parseTurnRangeSuffix('冒险摘要-1-50'), { start: 1, end: 50 })
  })

  it('returns null when suffix missing', () => {
    assert.equal(parseTurnRangeSuffix('plain title'), null)
  })
})

describe('parseMemoIndex', () => {
  it('reads memo prefix index', () => {
    assert.equal(parseMemoIndex('[MEMO-2]-TITLE-[0-15]'), 2)
  })
})

describe('classifyPlotSummaryEntry', () => {
  const sidecarSet = new Set(['sc-1'])

  it('classifies sidecar by entry id set', () => {
    assert.equal(
      classifyPlotSummaryEntry({ id: 'sc-1', title: '角色卡' }, sidecarSet),
      'sidecar',
    )
  })

  it('classifies summary by bracket turn suffix', () => {
    assert.equal(
      classifyPlotSummaryEntry({ id: 'm1', title: '[MEMO-1]-摘要-[10-20]' }, sidecarSet),
      'summary',
    )
  })

  it('classifies legacy summary by turn suffix', () => {
    assert.equal(
      classifyPlotSummaryEntry({ id: 'm1', title: '摘要-10-20' }, sidecarSet),
      'summary',
    )
  })
})

describe('sortPlotSummaryEntriesInGroup', () => {
  const sidecarEntryIds = { cfgA: 'sc-a', cfgB: 'sc-b' }
  const sidecarConfigIds = ['cfgB', 'cfgA']

  it('orders other < sidecar < summary', () => {
    const sorted = sortPlotSummaryEntriesInGroup(
      [
        {
          id: 'sum2',
          groupId: 'g1',
          title: '[MEMO-2]-B-[20-30]',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 'oth1',
          groupId: 'g1',
          title: '设定',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        { id: 'sc-a', groupId: 'g1', title: 'Side A' },
        { id: 'sc-b', groupId: 'g1', title: 'Side B' },
        {
          id: 'sum1',
          groupId: 'g1',
          title: '[MEMO-1]-A-[1-10]',
          createdAt: '2026-01-04T00:00:00.000Z',
        },
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

describe('computePlotSummaryApplyOrderLayout', () => {
  it('lists every group with full entry id lists', () => {
    const layout = computePlotSummaryApplyOrderLayout(
      {
        groups: [
          { id: 'g1', order: 0 },
          { id: 'g2', order: 1 },
        ],
        entries: [
          { id: 'a', groupId: 'g1', title: '[MEMO-1]-x-[1-2]' },
          { id: 'b', groupId: 'g2', title: '设定' },
        ],
      },
      {},
      [],
    )
    assert.deepEqual(layout.entriesByGroup.g1, ['a'])
    assert.deepEqual(layout.entriesByGroup.g2, ['b'])
    assert.deepEqual(Object.keys(layout.entriesByGroup).sort(), ['g1', 'g2'])
  })
})

describe('prepare-context blocks', () => {
  it('buildPreviousSummariesBlock wraps entries', () => {
    const block = buildPreviousSummariesBlock([{ title: 'T1', content: 'body' }])
    assert.match(block, /^<previous-summaries readonly>/)
  })

  it('buildHistoryBlock wraps transcript', () => {
    const inner = '<user userName="{{user}}">plot</user>'
    assert.equal(buildHistoryBlock(inner), `<history>\n${inner}\n</history>`)
  })

  it('resolveContextHistoryStart extends backward', () => {
    assert.equal(resolveContextHistoryStart(50, 5), 46)
  })
})

describe('pickRecentSummaryEntriesBeforeTurn', () => {
  it('returns last N summaries strictly before fromTurn', () => {
    const sidecarEntryIds = { cfg: 'sc' }
    const sidecarSet = new Set(Object.values(sidecarEntryIds))
    const picked = pickRecentSummaryEntriesBeforeTurn(
      [
        { id: 's1', groupId: 'g1', title: '[MEMO-1]-A-[1-5]' },
        { id: 's2', groupId: 'g1', title: '[MEMO-2]-B-[6-10]' },
        { id: 's3', groupId: 'g1', title: '[MEMO-3]-C-[11-15]' },
        { id: 's4', groupId: 'g1', title: '[MEMO-4]-D-[50-70]' },
        { id: 'sc', groupId: 'g1', title: 'side' },
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
