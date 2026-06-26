import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  branchAncestorPaths,
  buildAllowedBranchPathsForActive,
  buildAllowedBranchPathsWhereSql,
  chunkLocationKey,
  chunkStorageRelativePath,
  mainPathChunkLocation,
  normalizeBranchPath,
  normalizeChunkBasename,
  resolveNestedBranchPath,
  splitChunkStoragePath,
} from '../src/chunk-path.js'

describe('normalizeBranchPath', () => {
  it('empty and trims slashes', () => {
    assert.equal(normalizeBranchPath(''), '')
    assert.equal(normalizeBranchPath('branch1/'), 'branch1')
    assert.equal(normalizeBranchPath('/branch1/nested/'), 'branch1/nested')
  })

  it('rejects traversal segments', () => {
    assert.throws(() => normalizeBranchPath('..'), /invalid branchPath/)
    assert.throws(() => normalizeBranchPath('branch1/../x'), /invalid branchPath/)
  })
})

describe('normalizeChunkBasename', () => {
  it('accepts turn chunk names', () => {
    assert.equal(
      normalizeChunkBasename('turn-000000-000099.json'),
      'turn-000000-000099.json',
    )
    assert.equal(
      normalizeChunkBasename('branch1/turn-000100-000199.json'),
      'turn-000100-000199.json',
    )
  })

  it('rejects invalid names', () => {
    assert.throws(() => normalizeChunkBasename('evil.json'), /invalid chunkFileName/)
  })
})

describe('chunkStorageRelativePath', () => {
  it('main path is basename only', () => {
    assert.equal(
      chunkStorageRelativePath('', 'turn-000000-000099.json'),
      'turn-000000-000099.json',
    )
  })

  it('branch path joins segments', () => {
    assert.equal(
      chunkStorageRelativePath('branch1', 'turn-000100-000199.json'),
      'branch1/turn-000100-000199.json',
    )
  })
})

describe('splitChunkStoragePath', () => {
  it('splits nested branch paths', () => {
    assert.deepEqual(splitChunkStoragePath('branch1/turn-000100-000199.json'), {
      branchPath: 'branch1',
      chunkFileName: 'turn-000100-000199.json',
    })
    assert.deepEqual(splitChunkStoragePath('turn-000000-000099.json'), {
      branchPath: '',
      chunkFileName: 'turn-000000-000099.json',
    })
  })
})

describe('chunkLocationKey', () => {
  it('is stable per location', () => {
    assert.equal(
      chunkLocationKey('branch1', 'turn-000100-000199.json'),
      'branch1\0turn-000100-000199.json',
    )
    assert.equal(
      chunkLocationKey('', 'turn-000000-000099.json'),
      '\0turn-000000-000099.json',
    )
  })
})

describe('mainPathChunkLocation', () => {
  it('uses empty branchPath', () => {
    assert.deepEqual(mainPathChunkLocation('turn-000000-000099.json'), {
      branchPath: '',
      chunkFileName: 'turn-000000-000099.json',
    })
  })
})

describe('branchAncestorPaths', () => {
  it('includes main path and ancestors', () => {
    assert.deepEqual(branchAncestorPaths(''), [''])
    assert.deepEqual(branchAncestorPaths('branch1'), ['', 'branch1'])
    assert.deepEqual(branchAncestorPaths('branch1/nested'), [
      '',
      'branch1',
      'branch1/nested',
    ])
  })
})

describe('buildAllowedBranchPathsForActive', () => {
  it('matches ancestor set', () => {
    const allowed = buildAllowedBranchPathsForActive('branch1/nested')
    assert.equal(allowed.has(''), true)
    assert.equal(allowed.has('branch1'), true)
    assert.equal(allowed.has('branch1/nested'), true)
    assert.equal(allowed.has('branch2'), false)
  })
})

describe('buildAllowedBranchPathsWhereSql', () => {
  it('main path only', () => {
    assert.equal(
      buildAllowedBranchPathsWhereSql(new Set([''])),
      "branchPath = ''",
    )
  })

  it('ancestor chain IN clause', () => {
    const sql = buildAllowedBranchPathsWhereSql(
      buildAllowedBranchPathsForActive('branch1/nested'),
    )
    assert.equal(
      sql,
      "branchPath IN ('', 'branch1', 'branch1/nested')",
    )
  })

  it('escapes single quotes in path', () => {
    assert.equal(
      buildAllowedBranchPathsWhereSql(new Set(["a'b"])),
      "branchPath = 'a''b'",
    )
  })

  it('undefined when not filtering', () => {
    assert.equal(buildAllowedBranchPathsWhereSql(undefined), undefined)
    assert.equal(buildAllowedBranchPathsWhereSql(new Set()), undefined)
  })
})

describe('resolveNestedBranchPath', () => {
  it('joins parent and relative path', () => {
    assert.equal(resolveNestedBranchPath('', 'branch1'), 'branch1')
    assert.equal(resolveNestedBranchPath('branch1', 'nested'), 'branch1/nested')
  })
})
