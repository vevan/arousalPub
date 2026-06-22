import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectSubtreeSuffixTurnCount } from './branch-tree-utils.js'
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

describe('collectSubtreeSuffixTurnCount', () => {
  it('sums node and nested children suffix turn counts', () => {
    const tree = node('branch1', undefined, 2, [
      node('branch1/branch1', undefined, 1),
      node('branch1/branch2', undefined, 3),
    ])
    assert.equal(collectSubtreeSuffixTurnCount(tree), 6)
  })
})
