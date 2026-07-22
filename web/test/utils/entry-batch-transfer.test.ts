import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allocateTrailingOrders,
  isBatchGroupDisabled,
  mergeSelectAllVisible,
  partitionPromptIdsForBatch,
  rebuildEntriesAfterRemoval,
  rebuildEntriesAfterSameLibraryMove,
  toggleIdInList,
} from '../../src/utils/entry-batch-transfer.js'

describe('entry-batch-transfer', () => {
  it('allocateTrailingOrders starts after max', () => {
    assert.deepEqual(allocateTrailingOrders([0, 2, 1], 3), [3, 4, 5])
    assert.deepEqual(allocateTrailingOrders([], 2), [0, 1])
  })

  it('toggleIdInList adds and removes', () => {
    assert.deepEqual(toggleIdInList(['a'], 'b'), ['a', 'b'])
    assert.deepEqual(toggleIdInList(['a', 'b'], 'a'), ['b'])
  })

  it('mergeSelectAllVisible unions without dupes', () => {
    assert.deepEqual(mergeSelectAllVisible(['a'], ['a', 'b', 'c']), [
      'a',
      'b',
      'c',
    ])
  })

  it('isBatchGroupDisabled blocks same group only on move', () => {
    const group = { id: 'g1', name: 'G', count: 1 }
    assert.equal(
      isBatchGroupDisabled('copy', group, {
        currentLibraryId: 'L',
        targetLibraryId: 'L',
        currentGroupId: 'g1',
      }),
      false,
    )
    assert.equal(
      isBatchGroupDisabled('move', group, {
        currentLibraryId: 'L',
        targetLibraryId: 'L',
        currentGroupId: 'g1',
      }),
      true,
    )
    assert.equal(
      isBatchGroupDisabled('move', group, {
        currentLibraryId: 'L',
        targetLibraryId: 'other',
        currentGroupId: 'g1',
      }),
      false,
    )
    assert.equal(
      isBatchGroupDisabled('move', { ...group, disabled: true }, {
        currentLibraryId: 'L',
        targetLibraryId: 'X',
        currentGroupId: null,
      }),
      true,
    )
  })

  it('partitionPromptIdsForBatch skips bindingSlot', () => {
    const entries = [
      { id: 'a' },
      { id: 'b', bindingSlot: 'boundMain' },
      { id: 'c' },
    ]
    const r = partitionPromptIdsForBatch(entries, ['a', 'b', 'c', 'missing'])
    assert.equal(r.skippedSlots, 1)
    assert.deepEqual(
      r.transferable.map((e) => e.id),
      ['a', 'c'],
    )
  })

  it('rebuildEntriesAfterSameLibraryMove reorders source and appends target', () => {
    const entries = [
      { id: 'a', groupId: 'g1', order: 0 },
      { id: 'b', groupId: 'g1', order: 1 },
      { id: 'c', groupId: 'g2', order: 0 },
    ]
    const moved = [entries[0]!, entries[1]!]
    const rebuilt = rebuildEntriesAfterSameLibraryMove(
      entries,
      new Set(['a', 'b']),
      moved,
      'g2',
      (e, order) => ({ ...e, order }),
    )
    const g1 = rebuilt.filter((e) => e.groupId === 'g1')
    const g2 = rebuilt
      .filter((e) => e.groupId === 'g2')
      .sort((x, y) => x.order - y.order)
    assert.equal(g1.length, 0)
    assert.deepEqual(
      g2.map((e) => [e.id, e.order]),
      [
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ],
    )
  })

  it('rebuildEntriesAfterRemoval reindexes remaining groups', () => {
    const entries = [
      { id: 'a', groupId: 'g1', order: 0 },
      { id: 'b', groupId: 'g1', order: 1 },
      { id: 'c', groupId: 'g1', order: 2 },
      { id: 'd', groupId: 'g2', order: 0 },
    ]
    const rebuilt = rebuildEntriesAfterRemoval(
      entries,
      new Set(['a', 'c']),
      (e, order) => ({ ...e, order }),
    )
    assert.deepEqual(
      rebuilt
        .filter((e) => e.groupId === 'g1')
        .map((e) => [e.id, e.order]),
      [['b', 0]],
    )
    assert.deepEqual(
      rebuilt
        .filter((e) => e.groupId === 'g2')
        .map((e) => [e.id, e.order]),
      [['d', 0]],
    )
  })
})
