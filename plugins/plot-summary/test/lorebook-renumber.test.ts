import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planRenumberMemoryMemosByTurn } from '../src/shared/lorebook-sort.js'

describe('planRenumberMemoryMemosByTurn', () => {
  it('renumbers memory by turn range and skips sidecar', () => {
    const plan = planRenumberMemoryMemosByTurn(
      [
        { id: 'm2', groupId: 'g1', title: '[MEMO-9]-后段-[20-29]' },
        { id: 'm1', groupId: 'g1', title: '[MEMO-2]-前段-[0-9]' },
        { id: 'sc', groupId: 'g1', title: '人物关系' },
      ],
      { scCfg: 'sc' },
    )
    assert.equal(plan.lastMemoIndex, 2)
    assert.deepEqual(plan.titlePatches, [
      { id: 'm1', title: '[MEMO-1]-前段-[0-9]' },
      { id: 'm2', title: '[MEMO-2]-后段-[20-29]' },
    ])
    assert.deepEqual(plan.orderedMemoryIds, ['m1', 'm2'])
  })
})
