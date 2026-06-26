import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Lorebook } from '../src/lorebook-types.js'
import { validateApplyLorebookOrderLayout } from '../src/plugin-lorebook-apply-order.js'

function mockLb(): Lorebook {
  const t = '2026-06-08T00:00:00.000Z'
  return {
    id: 'lb-test',
    name: 'Test',
    groups: [
      { id: 'g1', name: 'G1', order: 0 },
      { id: 'g2', name: 'G2', order: 1 },
    ],
    entries: [
      {
        id: 'e1',
        groupId: 'g1',
        title: 'A',
        content: '',
        enabled: true,
        order: 2,
        keys: [],
        constant: false,
        priority: 0,
        createdAt: t,
        updatedAt: t,
      },
      {
        id: 'e2',
        groupId: 'g1',
        title: 'B',
        content: '',
        enabled: true,
        order: 0,
        keys: [],
        constant: false,
        priority: 0,
        createdAt: t,
        updatedAt: t,
      },
      {
        id: 'e3',
        groupId: 'g2',
        title: 'C',
        content: '',
        enabled: true,
        order: 0,
        keys: [],
        constant: false,
        priority: 0,
        createdAt: t,
        updatedAt: t,
      },
    ],
    createdAt: t,
    updatedAt: t,
  }
}

describe('validateApplyLorebookOrderLayout', () => {
  it('rejects incomplete group entry list', () => {
    const result = validateApplyLorebookOrderLayout(mockLb(), {
      entriesByGroup: { g1: ['e1'] },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'order_incomplete')
  })

  it('rejects unknown entry in group', () => {
    const result = validateApplyLorebookOrderLayout(mockLb(), {
      entriesByGroup: { g1: ['e1', 'e9'] },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'order_entry_group_mismatch')
  })

  it('accepts full layout with every group listed', () => {
    const result = validateApplyLorebookOrderLayout(mockLb(), {
      scope: 'full',
      entriesByGroup: {
        g1: ['e2', 'e1'],
        g2: ['e3'],
      },
    })
    assert.equal(result.ok, true)
  })

  it('requires all groups when scope is full', () => {
    const result = validateApplyLorebookOrderLayout(mockLb(), {
      scope: 'full',
      entriesByGroup: { g1: ['e2', 'e1'] },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'order_incomplete')
  })
})
