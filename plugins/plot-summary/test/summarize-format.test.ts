import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractSummaryCoreTitle,
  formatEntryTitle,
  parsePlotSummaryEntryTitle,
  resolveMemoIndex,
} from '../src/shared/summarize.js'

describe('formatEntryTitle', () => {
  it('formats new memo title with block-derived index', () => {
    assert.equal(formatEntryTitle('冒险', 0, 15, 15), '[MEMO-1]-冒险-[0-15]')
  })

  it('preserves memo index when reformatting existing title', () => {
    assert.equal(
      formatEntryTitle('[MEMO-3]-旧标题-[0-10]', 0, 15, 15),
      '[MEMO-3]-旧标题-[0-15]',
    )
  })

  it('keeps non-bracket titles when formatting', () => {
    assert.equal(formatEntryTitle('冒险-0-14', 0, 15, 15), '[MEMO-1]-冒险-0-14-[0-15]')
  })
})

describe('parsePlotSummaryEntryTitle', () => {
  it('parses memo bracket title', () => {
    assert.deepEqual(parsePlotSummaryEntryTitle('[MEMO-2]-TITLE-[0-15]'), {
      memoIndex: 2,
      coreTitle: 'TITLE',
      start: 0,
      end: 15,
    })
  })
})

describe('extractSummaryCoreTitle', () => {
  it('returns raw title when not memo bracket format', () => {
    assert.equal(extractSummaryCoreTitle('冒险摘要-1-50'), '冒险摘要-1-50')
  })
})

describe('resolveMemoIndex', () => {
  it('derives index from fromTurn and blockTurns', () => {
    assert.equal(resolveMemoIndex('新标题', 30, 15), 3)
  })
})
