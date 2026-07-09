import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterNotificationRecords,
  notificationMatchesSearch,
} from '../../src/utils/notification-list-filter.js'
import type { NotificationRecord } from '../../src/utils/notification-storage.js'

const FIXTURE_PLUGIN = 'fixture-plugin-notify'

const sample: NotificationRecord[] = [
  {
    id: '1',
    createdAt: '2026-07-09T00:00:00.000Z',
    readAt: null,
    title: 'Import done',
    body: 'Opened lorebook',
    level: 'success',
    source: { kind: 'core' },
  },
  {
    id: '2',
    createdAt: '2026-07-08T00:00:00.000Z',
    readAt: '2026-07-08T01:00:00.000Z',
    title: 'Summary failed',
    body: 'Context exceeded',
    level: 'error',
    source: { kind: 'plugin', pluginId: FIXTURE_PLUGIN },
  },
]

describe('notification-list-filter', () => {
  it('notificationMatchesSearch matches title and body', () => {
    assert.equal(notificationMatchesSearch(sample[0]!, 'import'), true)
    assert.equal(notificationMatchesSearch(sample[0]!, 'lorebook'), true)
    assert.equal(notificationMatchesSearch(sample[0]!, 'missing'), false)
  })

  it('filterNotificationRecords applies search and pluginId', () => {
    const bySearch = filterNotificationRecords(sample, { searchQuery: 'context' })
    assert.equal(bySearch.length, 1)
    assert.equal(bySearch[0]?.id, '2')

    const byPlugin = filterNotificationRecords(sample, {
      source: { kind: 'plugin', pluginId: FIXTURE_PLUGIN },
    })
    assert.equal(byPlugin.length, 1)

    const unread = filterNotificationRecords(sample, { unreadOnly: true })
    assert.equal(unread.length, 1)
  })

  it('filterNotificationRecords applies limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `n-${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      readAt: null,
      title: `Item ${i}`,
    }))
    const limited = filterNotificationRecords(many, { limit: 50 })
    assert.equal(limited.length, 50)
  })
})
