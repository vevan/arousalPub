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
  it('defaults to 1 when no memoIndex and title is not memo format', () => {
    assert.equal(resolveMemoIndex('新标题', 30, 15), 1)
  })

  it('uses explicit memoIndex over title-embedded MEMO-n', () => {
    assert.equal(resolveMemoIndex('新标题', 30, { memoIndex: 7 }), 7)
    assert.equal(
      resolveMemoIndex('[MEMO-3]-旧-[0-10]', 0, { memoIndex: 9 }),
      9,
    )
    assert.equal(
      formatEntryTitle('冒险', 0, 15, { memoIndex: 4 }),
      '[MEMO-4]-冒险-[0-15]',
    )
  })

  it('preserves existing MEMO-n when memoIndex not provided', () => {
    assert.equal(resolveMemoIndex('[MEMO-3]-旧-[0-10]', 0, 15), 3)
  })
})
