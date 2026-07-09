import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationCenterStore } from '../../src/stores/notification-center.js'
import {
  NOTIFICATION_MAX_ITEMS,
  notificationStorageKey,
  readNotificationEnvelope,
  writeNotificationEnvelope,
} from '../../src/utils/notification-storage.js'

const TEST_USER = 'test-user-nc'
const FIXTURE_PLUGIN = 'fixture-plugin-notify'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.get(key) ?? null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
    removeItem(key: string) {
      map.delete(key)
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
  } as Storage
}

describe('useNotificationCenterStore notify semantics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    globalThis.localStorage = createMemoryStorage()
  })

  it('default notify: immediately in list and snackbar queue', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Hello', body: 'World' })
    assert.equal(store.list().length, 1)
    assert.equal(store.snackbarQueue.length, 1)
    assert.equal(store.list()[0]?.id, id)
    store.dismissSnackbar(id, 'close')
    assert.equal(store.list().length, 0)
    assert.equal(store.unreadCount, 0)
  })

  it('timeout dismiss keeps list entry', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Timeout', level: 'info' })
    assert.equal(store.list().length, 1)
    store.dismissSnackbar(id, 'timeout')
    const items = store.list()
    assert.equal(items.length, 1)
    assert.equal(items[0]?.id, id)
    assert.equal(items[0]?.readAt, null)
    assert.equal(store.unreadCount, 1)
  })

  it('snackbar:false writes list without queue', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'Silent', snackbar: false })
    assert.equal(store.list().length, 1)
    assert.equal(store.snackbarQueue.length, 0)
  })

  it('action dismiss removes list entry after user acknowledged via snackbar button', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Action' })
    assert.equal(store.list().length, 1)
    store.dismissSnackbar(id, 'action')
    assert.equal(store.list().length, 0)
  })

  it('dedupeKey merges into a single list item', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({
      title: 'First',
      dedupeKey: 'group-chat:conv:at-unmatched',
    })
    store.notify({
      title: 'Second',
      dedupeKey: 'group-chat:conv:at-unmatched',
    })
    const items = store.list()
    assert.equal(items.length, 1)
    assert.equal(items[0]?.title, 'Second')
    assert.equal(items[0]?.readAt, null)
  })

  it('dedupeKey updates snackbar without duplicating list', () => {
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
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.title, 'Pending B')
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

  it('manual close removes list entry without duplicate on timeout', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const id = store.notify({ title: 'Hello' })
    assert.equal(store.list().length, 1)
    store.dismissSnackbar(id, 'close')
    assert.equal(store.list().length, 0)
    store.dismissSnackbar(id, 'timeout')
    assert.equal(store.list().length, 0)
  })

  it('list filters by level and source', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({
      title: 'Core warning',
      level: 'warning',
      source: { kind: 'core' },
    })
    store.notify({
      title: 'Plugin error',
      level: 'error',
      source: { kind: 'plugin', pluginId: FIXTURE_PLUGIN },
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
    })
    store.notify({
      title: 'Beta',
      body: 'three',
    })
    assert.equal(store.list({ searchQuery: 'two' }).length, 1)
    assert.equal(store.list({ searchQuery: 'two' })[0]?.title, 'Alpha')
  })

  it('markRead all clears unread count', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'A' })
    store.notify({ title: 'B' })
    assert.equal(store.unreadCount, 2)
    store.markRead('all')
    assert.equal(store.unreadCount, 0)
    assert.equal(store.list({ unreadOnly: true }).length, 0)
    assert.equal(store.list().length, 2)
  })

  it('deleteAll clears items and unread count', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'A' })
    store.notify({ title: 'B' })
    store.deleteAll()
    assert.equal(store.list().length, 0)
    assert.equal(store.unreadCount, 0)
  })

  it('clearSession resets in-memory state', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'A' })
    store.clearSession()
    assert.equal(store.userId, null)
    assert.equal(store.list().length, 0)
    assert.equal(store.snackbarQueue.length, 0)
  })

  it('notify without bindUser keeps items in memory only', () => {
    const store = useNotificationCenterStore()
    store.notify({ title: 'Guest' })
    assert.equal(store.list().length, 1)
    assert.equal(localStorage.getItem(notificationStorageKey(TEST_USER)), null)
  })

  it('notify after bindUser writes localStorage envelope', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({ title: 'Saved' })
    const envelope = readNotificationEnvelope(TEST_USER)
    assert.equal(envelope.items.length, 1)
    assert.equal(envelope.items[0]?.title, 'Saved')
  })

  it('caps list at NOTIFICATION_MAX_ITEMS', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    for (let i = 0; i < NOTIFICATION_MAX_ITEMS + 5; i += 1) {
      store.notify({ title: `Item ${i}`, snackbar: false })
    }
    assert.equal(store.list().length, NOTIFICATION_MAX_ITEMS)
  })

  it('records core source for host-style notify', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    store.notify({
      title: 'Saved preset',
      source: { kind: 'core' },
      level: 'success',
    })
    const item = store.list()[0]
    assert.equal(item?.source?.kind, 'core')
    assert.equal(store.unreadCount, 1)
  })

  it('records plugin source and forwards snackbarActions', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const action = { type: 'conversation' as const, conversationId: 'conv-1' }
    store.notify({
      title: 'Export done',
      body: 'Finished',
      level: 'success',
      source: { kind: 'plugin', pluginId: FIXTURE_PLUGIN },
      action,
      snackbarActions: [{ label: 'Open', action }],
    })
    const item = store.list()[0]
    assert.equal(item?.source?.pluginId, FIXTURE_PLUGIN)
    assert.deepEqual(item?.action, action)
    assert.equal(item?.snackbarActions?.length, 1)
    assert.equal(store.snackbarQueue.length, 1)
  })

  it('delete batch removes multiple ids', () => {
    const store = useNotificationCenterStore()
    store.bindUser(TEST_USER)
    const a = store.notify({ title: 'A', snackbar: false })
    const b = store.notify({ title: 'B', snackbar: false })
    store.notify({ title: 'C', snackbar: false })
    store.delete([a, b])
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.title, 'C')
  })

  it('per-user localStorage: logout clears memory, re-login restores that user envelope', () => {
    const USER_A = 'user-a-nc'
    const USER_B = 'user-b-nc'
    const store = useNotificationCenterStore()

    store.bindUser(USER_A)
    store.notify({ title: 'Notice A', snackbar: false })
    store.clearSession()

    store.bindUser(USER_B)
    store.notify({ title: 'Notice B', snackbar: false })
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.title, 'Notice B')
    store.clearSession()

    store.bindUser(USER_A)
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0]?.title, 'Notice A')
    assert.equal(readNotificationEnvelope(USER_B).items[0]?.title, 'Notice B')
  })
})
