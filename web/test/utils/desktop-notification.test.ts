import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  DESKTOP_NOTIFY_ENABLED_KEY,
  maybeShowDesktopNotification,
  resetDesktopNotificationStateForTests,
} from '../../src/utils/desktop-notification.js'
import type { NotificationRecord } from '../../src/utils/notification-storage.js'

const sampleRecord = (): NotificationRecord => ({
  id: 'n-1',
  createdAt: new Date().toISOString(),
  readAt: null,
  title: 'Rebuild done',
  body: 'Indexed 10 items',
  dedupeKey: 'memory-rebuild:conv-1',
})

describe('desktop-notification', () => {
  let created: Array<{ title: string; opts: NotificationOptions }>

  beforeEach(() => {
    resetDesktopNotificationStateForTests()
    created = []
    globalThis.localStorage = {
      getItem(key: string) {
        return key === DESKTOP_NOTIFY_ENABLED_KEY ? '1' : null
      },
      setItem() {},
      removeItem() {},
      clear() {},
      key() {
        return null
      },
      get length() {
        return 0
      },
    } as Storage

    globalThis.Notification = class MockNotification {
      static permission: NotificationPermission = 'granted'
      constructor(title: string, opts?: NotificationOptions) {
        created.push({ title, opts: opts ?? {} })
      }
      close() {}
      onclick: (() => void) | null = null
    } as unknown as typeof Notification

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        hidden: false,
        addEventListener() {},
        removeEventListener() {},
      },
    })
  })

  afterEach(() => {
    resetDesktopNotificationStateForTests()
  })

  it('does not show when tab is visible (no deferred flush)', () => {
    maybeShowDesktopNotification(sampleRecord())
    assert.equal(created.length, 0)
    Object.defineProperty(globalThis.document, 'hidden', {
      configurable: true,
      value: true,
    })
    maybeShowDesktopNotification(sampleRecord())
    assert.equal(created.length, 1)
  })

  it('shows immediately when tab is already hidden', () => {
    Object.defineProperty(globalThis.document, 'hidden', {
      configurable: true,
      value: true,
    })
    maybeShowDesktopNotification(sampleRecord())
    assert.equal(created.length, 1)
    assert.equal(created[0]?.opts.tag, 'n-1')
    assert.equal(created[0]?.opts.renotify, true)
  })
})
