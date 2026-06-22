import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allocateBranchSegmentName,
  BRANCH_LABEL_MAX_LENGTH,
  normalizeBranchLabelInput,
} from './conversation-branches.js'

describe('normalizeBranchLabelInput', () => {
  it('trims and accepts non-empty label', () => {
    const r = normalizeBranchLabelInput('  IF 路线  ')
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.label, 'IF 路线')
  })

  it('empty string clears label', () => {
    const r = normalizeBranchLabelInput('   ')
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.label, null)
  })

  it('rejects too long label', () => {
    const r = normalizeBranchLabelInput('x'.repeat(BRANCH_LABEL_MAX_LENGTH + 1))
    assert.ok('error' in r)
  })

  it('optional omit yields null', () => {
    const r = normalizeBranchLabelInput(undefined, { optional: true })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.label, null)
  })

  it('optional null clears label', () => {
    const r = normalizeBranchLabelInput(null, { optional: true })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.label, null)
  })

  it('optional empty string clears label', () => {
    const r = normalizeBranchLabelInput('', { optional: true })
    assert.ok(!('error' in r))
    if ('error' in r) return
    assert.equal(r.label, null)
  })
})

describe('allocateBranchSegmentName', () => {
  it('returns branch1 when no siblings', () => {
    assert.equal(allocateBranchSegmentName([]), 'branch1')
  })

  it('skips occupied segment names', () => {
    assert.equal(allocateBranchSegmentName(['branch1', 'branch2']), 'branch3')
  })

  it('considers nested path last segment only', () => {
    assert.equal(allocateBranchSegmentName(['branch1/nested']), 'branch1')
  })

  it('returns null when exhausted', () => {
    const used = Array.from({ length: 9999 }, (_, i) => `branch${i + 1}`)
    assert.equal(allocateBranchSegmentName(used), null)
  })
})
