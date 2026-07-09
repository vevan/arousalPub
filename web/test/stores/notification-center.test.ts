import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationCenterStore } from '../../src/stores/notification-center.js'
import { writeNotificationEnvelope } from '../../src/utils/notification-storage.js'

const TEST_USER = 'test-user-nc'

describe('useNotificationCenterStore notify semantics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  it('default notify: pending until timeout dismiss, not in list', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Hello', body: 'World' })
    assert.equal(store.list().length, 0)
    assert.equal(store.snackbarQueue.length, 1)
    store.dismissSnackbar(id, 'close')
    assert.equal(store.list().length, 0)
  })

  it('timeout dismiss commits unread notification', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Timeout', level: 'info' })
    store.dismissSnackbar(id, 'timeout')
    const items = store.list()
    assert.equal(items.length, 1)
    assert.equal(items[0]?.id, id)
    assert.equal(items[0]?.readAt, null)
    assert.equal(store.unreadCount, 1)
  })

  it('persist:true writes list immediately', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'Persist', persist: true })
    assert.equal(store.list().length, 1)
    assert.equal(store.unreadCount, 1)
  })

  it('snackbar:false writes list without queue', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'Silent', snackbar: false })
    assert.equal(store.list().length, 1)
    assert.equal(store.snackbarQueue.length, 0)
  })

  it('action dismiss commits like timeout', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Action' })
    store.dismissSnackbar(id, 'action')
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.id, id)
  })

  it('dedupeKey merges into a single list item', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({
      title: 'First',
      dedupeKey: 'group-chat:conv:at-unmatched',
      persist: true,
    })
    store.notify({
      title: 'Second',
      dedupeKey: 'group-chat:conv:at-unmatched',
      persist: true,
    })
    const items = store.list()
    assert.equal(items.length, 1)
    assert.equal(items[0]?.title, 'Second')
    assert.equal(items[0]?.readAt, null)
  })

  it('dedupeKey updates pending snackbar without duplicating list', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({
      title: 'Pending A',
      dedupeKey: 'group-chat:conv:hint',
    })
    store.notify({
      title: 'Pending B',
      dedupeKey: 'group-chat:conv:hint',
    })
    assert.equal(store.list().length, 0)
    assert.equal(store.snackbarQueue.length, 1)
    assert.equal(store.snackbarQueue[0]?.notificationId, id)
    assert.match(store.snackbarQueue[0]?.text ?? '', /Pending B/)
  })

  it('purgeExpired removes expired items when binding user', () => {
    writeNotificationEnvelope(TEST_USER, {
      schemaVersion: 1,
      unreadCount: 1,
      items: [
        {
          id: 'exp-1',
          createdAt: new Date().toISOString(),
          readAt: null,
          title: 'Expired',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    })
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    assert.equal(store.list().length, 0)
    assert.equal(store.unreadCount, 0)
  })

  it('list filters by level and source', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({
      title: 'Core warning',
      level: 'warning',
      source: { kind: 'core' },
      persist: true,
    })
    store.notify({
      title: 'Plugin error',
      level: 'error',
      source: { kind: 'plugin', pluginId: 'plot-summary' },
      persist: true,
    })
    assert.equal(store.list({ level: 'warning' }).length, 1)
    assert.equal(store.list({ source: { kind: 'plugin' } }).length, 1)
    assert.equal(store.list({ unreadOnly: true }).length, 2)
  })

  it('list filters by searchQuery', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({
      title: 'Alpha',
      body: 'one two',
      persist: true,
    })
    store.notify({
      title: 'Beta',
      body: 'three',
      persist: true,
    })
    assert.equal(store.list({ searchQuery: 'two' }).length, 1)
    assert.equal(store.list({ searchQuery: 'two' })[0]?.title, 'Alpha')
  })
})
