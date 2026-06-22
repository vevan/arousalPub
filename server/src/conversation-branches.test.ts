import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { allocateBranchSegmentName } from './conversation-branches.js'

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
