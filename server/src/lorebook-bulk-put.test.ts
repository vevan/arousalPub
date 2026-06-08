import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertValidLorebooksPayload,
  LOREBOOKS_BULK_PUT_MAX_BOOKS,
  LOREBOOKS_BULK_PUT_MAX_ENTRIES,
} from './lorebook-file.js'
import { tryAcquireLorebooksBulkPutSlot } from './lorebooks-bulk-put-limit.js'

function minimalLorebook(id: string, entryCount = 1) {
  return {
    id,
    name: `book-${id}`,
    groups: [{ id: 'group-pre', name: 'Pre', order: 0 }],
    entries: Array.from({ length: entryCount }, (_, i) => ({
      id: `entry-${id}-${i}`,
      groupId: 'group-pre',
      title: `t${i}`,
      content: 'c',
      enabled: true,
      order: i,
      keys: [],
      constant: false,
      triggerMode: 'keyword' as const,
      priority: 100,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('assertValidLorebooksPayload bulk limits', () => {
  it('rejects too many books', () => {
    const lorebooks = Array.from({ length: LOREBOOKS_BULK_PUT_MAX_BOOKS + 1 }, (_, i) =>
      minimalLorebook(`lb${i}`),
    )
    assert.throws(
      () => assertValidLorebooksPayload({ lorebooks }),
      /整包保存最多/,
    )
  })

  it('rejects too many entries total', () => {
    const lorebooks = [minimalLorebook('big', LOREBOOKS_BULK_PUT_MAX_ENTRIES + 1)]
    assert.throws(
      () => assertValidLorebooksPayload({ lorebooks }),
      /整包保存最多/,
    )
  })
})

describe('tryAcquireLorebooksBulkPutSlot', () => {
  it('rate limits rapid puts per user', () => {
    const user = 'user-rate-test'
    assert.equal(tryAcquireLorebooksBulkPutSlot(user), true)
    assert.equal(tryAcquireLorebooksBulkPutSlot(user), false)
  })
})
