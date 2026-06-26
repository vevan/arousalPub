import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllowedBranchPathsForActive } from '../src/chunk-path.js'
import {
  buildMemoryVectorSearchWhereClause,
  filterMemorySearchRawRows,
} from '../src/memory-store.js'

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

describe('filterMemorySearchRawRows', () => {
  it('excludes sibling branchPath when active is branch1', () => {
    const raw = [
      {
        turnId: 'main0',
        branchPath: '',
        chunkFileName: 'turn-000000-000099.json',
        turnOrdinal: 0,
        _relevance_score: 1,
      },
      {
        turnId: 'b1',
        branchPath: 'branch1',
        chunkFileName: 'turn-000000-000099.json',
        turnOrdinal: 2,
        _relevance_score: 1,
      },
      {
        turnId: 'b2',
        branchPath: 'branch2',
        chunkFileName: 'turn-000000-000099.json',
        turnOrdinal: 2,
        _relevance_score: 1,
      },
    ]
    const hits = filterMemorySearchRawRows(raw, {
      allowedBranchPaths: buildAllowedBranchPathsForActive('branch1'),
    })
    assert.deepEqual(
      hits.map((h) => h.branchPath).sort(),
      ['', 'branch1'],
    )
    assert.ok(!hits.some((h) => h.turnId === 'b2'))
  })
})
