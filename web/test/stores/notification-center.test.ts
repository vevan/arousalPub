import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationCenterStore } from '../../src/stores/notification-center.js'

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
})
