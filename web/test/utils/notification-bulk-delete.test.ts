import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planNotificationBulkDelete } from '../../src/utils/notification-bulk-delete.js'

describe('planNotificationBulkDelete', () => {
  it('when list truncated, deletes only visible ids', () => {
    const plan = planNotificationBulkDelete({
      displayItemIds: ['a', 'b'],
      filteredItemIds: ['a', 'b', 'c'],
      listTruncated: true,
      hasActiveFilter: false,
    })
    assert.deepEqual(plan, { scope: 'ids', ids: ['a', 'b'] })
  })

  it('when filtered but not truncated, deletes all filtered ids', () => {
    const plan = planNotificationBulkDelete({
      displayItemIds: ['a'],
      filteredItemIds: ['a', 'b'],
      listTruncated: false,
      hasActiveFilter: true,
    })
    assert.deepEqual(plan, { scope: 'ids', ids: ['a', 'b'] })
  })

  it('when not truncated and no filter, deletes all in store', () => {
    const plan = planNotificationBulkDelete({
      displayItemIds: ['a', 'b'],
      filteredItemIds: ['a', 'b'],
      listTruncated: false,
      hasActiveFilter: false,
    })
    assert.equal(plan.scope, 'all')
  })

  it('when truncated with filter, still deletes only visible ids', () => {
    const plan = planNotificationBulkDelete({
      displayItemIds: ['x'],
      filteredItemIds: ['x', 'y', 'z'],
      listTruncated: true,
      hasActiveFilter: true,
    })
    assert.deepEqual(plan, { scope: 'ids', ids: ['x'] })
  })
})
