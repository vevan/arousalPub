import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { branchPathLabel } from './branch-path-label.js'
import type { BranchTreeNodeDto } from './conversation-branches-types.js'

const t = (key: string, params?: Record<string, unknown>) => {
  if (key === 'chat.branches.mainPath') return 'Main path'
  if (key === 'chat.branches.unnamed') return `Branch ${String(params?.path ?? '')}`
  return key
}

function node(path: string, label?: string): BranchTreeNodeDto {
  return {
    path,
    label,
    forkTurnId: path ? 'fork' : null,
    forkOrdinal: path ? 1 : null,
    turnCount: 0,
    children: [],
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
