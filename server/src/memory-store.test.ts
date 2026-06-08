import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllowedBranchPathsForActive } from './chunk-path.js'
import { buildMemoryVectorSearchWhereClause } from './memory-store.js'

describe('buildMemoryVectorSearchWhereClause', () => {
  it('branch only', () => {
    assert.equal(
      buildMemoryVectorSearchWhereClause(buildAllowedBranchPathsForActive('branch1'), undefined),
      "branchPath IN ('', 'branch1')",
    )
  })

  it('combines branch and ordinal', () => {
    assert.equal(
      buildMemoryVectorSearchWhereClause(new Set(['']), 42),
      "branchPath = '' AND turnOrdinal < 42",
    )
  })

  it('ordinal only when branch filter omitted', () => {
    assert.equal(
      buildMemoryVectorSearchWhereClause(undefined, 10),
      'turnOrdinal < 10',
    )
  })

  it('undefined when no filters', () => {
    assert.equal(
      buildMemoryVectorSearchWhereClause(undefined, undefined),
      undefined,
    )
  })
})
