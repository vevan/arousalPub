import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBranchRegistryPath } from '../src/chunk-chain.js'

describe('parseBranchRegistryPath', () => {
  it('reads path from branch registry entry', () => {
    assert.equal(
      parseBranchRegistryPath({ path: 'branch1', forkTurnId: 'abc' }),
      'branch1',
    )
    assert.equal(parseBranchRegistryPath({ path: ' branch1/nested ' }), 'branch1/nested')
  })

  it('returns null for invalid entries', () => {
    assert.equal(parseBranchRegistryPath(null), null)
    assert.equal(parseBranchRegistryPath({}), null)
    assert.equal(parseBranchRegistryPath({ path: '' }), null)
    assert.equal(parseBranchRegistryPath({ path: '..' }), null)
  })
})
