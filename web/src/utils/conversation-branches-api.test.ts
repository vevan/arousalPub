import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { branchTurnRangeParts, collectSubtreeSuffixTurnCount } from './branch-tree-utils.js'
import { branchPathLabel } from './branch-path-label.js'
import type { BranchTreeNodeDto } from './conversation-branches-types.js'

const t = (key: string, params?: Record<string, unknown>) => {
  if (key === 'chat.branches.mainPath') return 'Main path'
  if (key === 'chat.branches.unnamed') return `Branch ${String(params?.path ?? '')}`
  return key
}

function node(path: string, label?: string, turnCount = 0, children: BranchTreeNodeDto[] = []): BranchTreeNodeDto {
  return {
    path,
    label,
    forkTurnId: path ? 'fork' : null,
    forkOrdinal: path ? 1 : null,
    turnCount,
    children,
  }
}

describe('branchPathLabel', () => {
  it('returns main path label for empty path', () => {
    assert.equal(branchPathLabel('', node(''), t), 'Main path')
  })

  it('prefers trimmed node label', () => {
    assert.equal(branchPathLabel('branch1', node('branch1', '  My Branch  '), t), 'My Branch')
  })

  it('falls back to unnamed segment label', () => {
    assert.equal(branchPathLabel('branch1/branch2', node('branch1/branch2'), t), 'Branch branch2')
  })
})

describe('branchTurnRangeParts', () => {
  it('returns from / to / total for branch nodes', () => {
    const branch = node('branch1', undefined, 24)
    branch.forkOrdinal = 36
    branch.mergedTurnCount = 60
    assert.deepEqual(branchTurnRangeParts(branch), {
      from: 36,
      to: 60,
      total: 24,
    })
  })

  it('derives to from forkOrdinal + turnCount when mergedTurnCount missing', () => {
    const branch = node('branch1', undefined, 3)
    branch.forkOrdinal = 10
    assert.deepEqual(branchTurnRangeParts(branch), {
      from: 10,
      to: 13,
      total: 3,
    })
  })

  it('returns main path to and total without from', () => {
    const main = node('', undefined, 60)
    main.mergedTurnCount = 60
    assert.deepEqual(branchTurnRangeParts(main), { to: 60, total: 60 })
  })

  it('shows fork point when branch has no suffix turns yet', () => {
    const branch = node('branch1', undefined, 0)
    branch.forkOrdinal = 36
    branch.mergedTurnCount = 36
    assert.deepEqual(branchTurnRangeParts(branch), {
      from: 36,
      to: 36,
      total: 0,
    })
  })
})

describe('collectSubtreeSuffixTurnCount', () => {
  it('sums node and nested children suffix turn counts', () => {
    const tree = node('branch1', undefined, 2, [
      node('branch1/branch1', undefined, 1),
      node('branch1/branch2', undefined, 3),
    ])
    assert.equal(collectSubtreeSuffixTurnCount(tree), 6)
  })
})
