import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseSummaryGroupPlacement,
  resolveSummaryTargetGroupId,
} from '../src/shared/summary-group-placement.js'

describe('parseSummaryGroupPlacement', () => {
  it('defaults to last', () => {
    assert.equal(parseSummaryGroupPlacement(undefined), 'last')
    assert.equal(parseSummaryGroupPlacement(''), 'last')
    assert.equal(parseSummaryGroupPlacement('nope'), 'last')
  })

  it('accepts first', () => {
    assert.equal(parseSummaryGroupPlacement('first'), 'first')
  })
})

describe('resolveSummaryTargetGroupId', () => {
  const groups = [
    { id: 'g-mid', order: 5 },
    { id: 'g-first', order: 0 },
    { id: 'g-last', order: 10 },
  ]

  it('returns undefined for empty groups', () => {
    assert.equal(resolveSummaryTargetGroupId([], 'last'), undefined)
  })

  it('picks first / last by order', () => {
    assert.equal(resolveSummaryTargetGroupId(groups, 'first'), 'g-first')
    assert.equal(resolveSummaryTargetGroupId(groups, 'last'), 'g-last')
  })

  it('single group is same for first and last', () => {
    const one = [{ id: 'only', order: 3 }]
    assert.equal(resolveSummaryTargetGroupId(one, 'first'), 'only')
    assert.equal(resolveSummaryTargetGroupId(one, 'last'), 'only')
  })
})
